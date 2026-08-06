begin;

create or replace function
public.get_organization_credit_breakdown(
  p_organization_id uuid
)
returns table (
  credit_pool_type text,
  included_monthly_credits integer,
  recurring_addon_credits integer,
  total_monthly_credits integer,
  used_credits integer,
  remaining_credits integer,
  renewal_date timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if p_organization_id is null then
    raise exception 'Organization ID is required.';
  end if;

  if not exists (
    select 1
    from public.organization_users as organization_user
    where organization_user.organization_id = p_organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
      and (
        organization_user.role in (
          'organization_admin',
          'user_admin',
          'billing_admin',
          'group_manager'
        )
        or organization_user.portal_access_enabled = true
        or organization_user.billing_access_enabled = true
      )
  ) then
    raise exception
      'You do not have access to this organization credit summary.';
  end if;

  return query
  with latest_ledgers as (
    select distinct on (ledger.credit_pool_type)
      ledger.credit_pool_type,
      greatest(
        coalesce(ledger.monthly_allocation, 0),
        0
      )::integer as included_credits,
      greatest(
        coalesce(
          ledger.recurring_addon_allocation,
          0
        ),
        0
      )::integer as addon_credits,
      greatest(
        coalesce(ledger.used_credits, 0),
        0
      )::integer as consumed_credits
    from public.ai_credit_ledger as ledger
    where ledger.organization_id = p_organization_id
      and ledger.user_id is null
      and ledger.credit_pool_type in (
        'portal',
        'app'
      )
    order by
      ledger.credit_pool_type,
      ledger.period_key desc
  )
  select
    latest_ledgers.credit_pool_type,
    latest_ledgers.included_credits,
    latest_ledgers.addon_credits,
    (
      latest_ledgers.included_credits +
      latest_ledgers.addon_credits
    )::integer as total_monthly_credits,
    latest_ledgers.consumed_credits,
    greatest(
      latest_ledgers.included_credits +
      latest_ledgers.addon_credits -
      latest_ledgers.consumed_credits,
      0
    )::integer as remaining_credits,
    organization_record.current_billing_period_end
  from latest_ledgers
  cross join lateral (
    select
      organization.current_billing_period_end
    from public.organizations as organization
    where organization.id = p_organization_id
  ) as organization_record
  order by latest_ledgers.credit_pool_type;
end;
$function$;

revoke all
on function
public.get_organization_credit_breakdown(uuid)
from public, anon;

grant execute
on function
public.get_organization_credit_breakdown(uuid)
to authenticated, service_role;

commit;
