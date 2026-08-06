begin;

-- This migration has no schema effect. It exists to bring the repository
-- back in sync with the production database: sync_organization_portal_recurring_addons
-- was created directly against the remote database with no corresponding
-- migration file ever committed.
--
-- Verified against the linked production project's pg_catalog (not just the
-- function body) to confirm this migration reproduces the live function
-- exactly, matching its sibling sync_organization_app_pool_recurring_addons
-- on every dimension:
--   - argument types:     p_organization_id uuid, p_subscription_status text, p_items jsonb
--   - return type:        integer (int4)
--   - volatility:         VOLATILE (default; not marked IMMUTABLE/STABLE in either function)
--   - strict:             false (neither function is STRICT)
--   - security mode:      SECURITY DEFINER (prosecdef = true)
--   - search_path:        search_path=public (proconfig)
--   - parallel safety:    UNSAFE (default; neither marked PARALLEL SAFE/RESTRICTED)
--   - owner:               postgres
--   - grants:              EXECUTE revoked from public/anon/authenticated,
--                          granted to service_role only (anon/authenticated
--                          confirmed via has_function_privilege = false)
-- The function body below is copied unchanged from the live function.

create or replace function public.sync_organization_portal_recurring_addons(
  p_organization_id uuid,
  p_subscription_status text,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_period_key text;
  v_allocation integer := 0;
  v_updated_rows integer := 0;
begin
  if p_organization_id is null then
    raise exception 'Organization ID is required.';
  end if;

  select
    to_char(
      organization_record.current_billing_period_start,
      'YYYY-MM'
    )
  into
    v_period_key
  from public.organizations as organization_record
  where organization_record.id =
    p_organization_id;

  if v_period_key is null then
    raise exception
      'The organization billing period is not configured.';
  end if;

  if lower(
    coalesce(p_subscription_status, '')
  ) in (
    'active',
    'trialing',
    'past_due'
  ) then
    select
      coalesce(
        sum(
          billing_product.portal_credits_per_unit
          * greatest(
              coalesce(
                nullif(
                  subscription_item ->> 'quantity',
                  ''
                )::integer,
                0
              ),
              0
            )
        ),
        0
      )::integer
    into
      v_allocation
    from jsonb_array_elements(
      coalesce(p_items, '[]'::jsonb)
    ) as subscription_item
    join public.organization_billing_products
      as billing_product
      on billing_product.stripe_price_id =
        subscription_item ->> 'price_id'
    where billing_product.active = true
      and billing_product.product_type =
        'portal_credit_addon'
      and billing_product.portal_credits_per_unit
        is not null;
  else
    v_allocation := 0;
  end if;

  update public.ai_credit_ledger
  set
    recurring_addon_allocation =
      v_allocation,
    updated_at = now()
  where organization_id =
      p_organization_id
    and user_id is null
    and credit_pool_type = 'portal'
    and period_key = v_period_key;

  get diagnostics
    v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception
      'Expected one organization portal-credit ledger for organization %, period %, but updated %.',
      p_organization_id,
      v_period_key,
      v_updated_rows;
  end if;

  insert into public.organization_billing_events (
    organization_id,
    actor_user_id,
    stripe_event_id,
    event_type,
    metadata
  )
  values (
    p_organization_id,
    null,
    null,
    'organization_portal_addons_synchronized',
    jsonb_build_object(
      'credit_pool_type',
      'portal',
      'recurring_addon_allocation',
      v_allocation,
      'subscription_status',
      p_subscription_status,
      'period_key',
      v_period_key
    )
  );

  return v_allocation;
end;
$function$;

revoke all
on function public.sync_organization_portal_recurring_addons(
  uuid,
  text,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.sync_organization_portal_recurring_addons(
  uuid,
  text,
  jsonb
)
to service_role;

commit;
