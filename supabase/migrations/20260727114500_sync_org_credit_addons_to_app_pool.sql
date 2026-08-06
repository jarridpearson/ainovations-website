begin;

-- These are organization shared APP credit-pool add-ons.
-- They are not portal-AI credits and not personal-user credits.

alter table public.organization_billing_products
  add column if not exists app_pool_credits_per_unit integer
  check (
    app_pool_credits_per_unit is null
    or app_pool_credits_per_unit > 0
  );

alter table public.organization_billing_products
  drop constraint if exists
    organization_billing_products_product_type_check;

alter table public.organization_billing_products
  add constraint organization_billing_products_product_type_check
  check (
    product_type in (
      'organization_plan',
      'user_seat',
      'portal_credit_addon',
      'app_credit_addon'
    )
  );

update public.organization_billing_products
set
  product_key = case product_key
    when 'organization_portal_ai_credits_50_monthly'
      then 'organization_app_pool_ai_credits_50_monthly'
    when 'organization_portal_ai_credits_100_monthly'
      then 'organization_app_pool_ai_credits_100_monthly'
    when 'organization_portal_ai_credits_250_monthly'
      then 'organization_app_pool_ai_credits_250_monthly'
  end,
  product_name = case product_key
    when 'organization_portal_ai_credits_50_monthly'
      then '50 Organization Shared App AI Credits'
    when 'organization_portal_ai_credits_100_monthly'
      then '100 Organization Shared App AI Credits'
    when 'organization_portal_ai_credits_250_monthly'
      then '250 Organization Shared App AI Credits'
  end,
  product_type = 'app_credit_addon',
  app_pool_credits_per_unit = portal_credits_per_unit,
  portal_credits_per_unit = null,
  updated_at = now()
where product_key in (
  'organization_portal_ai_credits_50_monthly',
  'organization_portal_ai_credits_100_monthly',
  'organization_portal_ai_credits_250_monthly'
);

create or replace function public.sync_organization_app_pool_recurring_addons(
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
  select to_char(
    organization_record.current_billing_period_start,
    'YYYY-MM'
  )
  into v_period_key
  from public.organizations as organization_record
  where organization_record.id = p_organization_id;

  if v_period_key is null then
    raise exception
      'The organization billing period is not configured.';
  end if;

  if lower(coalesce(p_subscription_status, '')) in (
    'active',
    'trialing',
    'past_due'
  ) then
    select coalesce(
      sum(
        billing_product.app_pool_credits_per_unit
        * greatest(
            coalesce(
              nullif(item ->> 'quantity', '')::integer,
              0
            ),
            0
          )
      ),
      0
    )::integer
    into v_allocation
    from jsonb_array_elements(
      coalesce(p_items, '[]'::jsonb)
    ) as item
    join public.organization_billing_products
      as billing_product
      on billing_product.stripe_price_id =
        item ->> 'price_id'
    where billing_product.active = true
      and billing_product.product_type =
        'app_credit_addon'
      and billing_product.app_pool_credits_per_unit
        is not null;
  else
    v_allocation := 0;
  end if;

  update public.ai_credit_ledger
  set
    recurring_addon_allocation = v_allocation,
    updated_at = now()
  where organization_id = p_organization_id
    and user_id is null
    and credit_pool_type = 'app'
    and period_key = v_period_key;

  get diagnostics v_updated_rows = row_count;

  if v_updated_rows <> 1 then
    raise exception
      'Expected one organization app-credit pool ledger for organization %, period %, but updated %.',
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
    'organization_app_pool_addons_synchronized',
    jsonb_build_object(
      'credit_pool_type',
      'app',
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
on function public.sync_organization_app_pool_recurring_addons(
  uuid,
  text,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.sync_organization_app_pool_recurring_addons(
  uuid,
  text,
  jsonb
)
to service_role;

commit;
