begin;

create or replace function public.refund_organization_portal_credits(
  p_organization_id uuid,
  p_user_id uuid,
  p_credit_cost integer,
  p_event_type text,
  p_feature_key text,
  p_route text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  portal_credits_available integer,
  portal_credits_used integer,
  portal_credit_renewal_date timestamp with time zone
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_period_key text;
  v_period_end timestamp with time zone;
  v_ledger_id uuid;
  v_monthly_allocation integer;
  v_addon_allocation integer;
  v_recurring_addon_allocation integer;
  v_one_time_top_up_balance integer;
  v_used_credits integer;
  v_total_credits integer;
  v_updated_used_credits integer;
begin
  if p_organization_id is null then
    raise exception 'Organization ID is required.';
  end if;

  if p_user_id is null then
    raise exception 'User ID is required.';
  end if;

  if p_credit_cost is null or p_credit_cost <= 0 then
    raise exception 'Credit cost must be greater than zero.';
  end if;

  if nullif(trim(coalesce(p_event_type, '')), '') is null then
    raise exception 'Event type is required.';
  end if;

  if nullif(trim(coalesce(p_feature_key, '')), '') is null then
    raise exception 'Feature key is required.';
  end if;

  if nullif(trim(coalesce(p_route, '')), '') is null then
    raise exception 'Route is required.';
  end if;

  if not exists (
    select 1
    from public.organization_users as organization_user
    where organization_user.organization_id = p_organization_id
      and organization_user.user_id = p_user_id
      and organization_user.is_active = true
      and organization_user.role in (
        'organization_admin',
        'user_admin'
      )
  ) then
    raise exception
      'Only an active Organization Admin or User Admin can refund this portal AI credit.';
  end if;

  select
    to_char(
      organization_record.current_billing_period_start,
      'YYYY-MM'
    ),
    organization_record.current_billing_period_end
  into
    v_period_key,
    v_period_end
  from public.organizations as organization_record
  where organization_record.id = p_organization_id;

  if v_period_key is null or v_period_end is null then
    raise exception
      'The organization billing period is not configured.';
  end if;

  select
    credit_ledger.id,
    credit_ledger.monthly_allocation,
    credit_ledger.addon_allocation,
    credit_ledger.recurring_addon_allocation,
    credit_ledger.one_time_top_up_balance,
    credit_ledger.used_credits
  into
    v_ledger_id,
    v_monthly_allocation,
    v_addon_allocation,
    v_recurring_addon_allocation,
    v_one_time_top_up_balance,
    v_used_credits
  from public.ai_credit_ledger as credit_ledger
  where credit_ledger.organization_id = p_organization_id
    and credit_ledger.user_id is null
    and credit_ledger.credit_pool_type = 'portal'
    and credit_ledger.period_key = v_period_key
  for update;

  if v_ledger_id is null then
    raise exception
      'The organization portal-credit pool is not available.';
  end if;

  v_total_credits :=
    coalesce(v_monthly_allocation, 0)
    + coalesce(v_addon_allocation, 0)
    + coalesce(v_recurring_addon_allocation, 0)
    + coalesce(v_one_time_top_up_balance, 0);

  v_updated_used_credits :=
    greatest(
      coalesce(v_used_credits, 0) - p_credit_cost,
      0
    );

  update public.ai_credit_ledger
  set
    used_credits = v_updated_used_credits,
    updated_at = now()
  where id = v_ledger_id;

  insert into public.usage_events (
    user_id,
    organization_id,
    group_id,
    event_type,
    feature_key,
    route,
    metadata
  )
  values (
    p_user_id,
    p_organization_id,
    null,
    trim(p_event_type),
    trim(p_feature_key),
    trim(p_route),
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'credit_pool_type',
        'portal',
        'credits_refunded',
        p_credit_cost,
        'period_key',
        v_period_key
      )
  );

  return query
  select
    greatest(
      v_total_credits - v_updated_used_credits,
      0
    )::integer,
    v_updated_used_credits::integer,
    v_period_end;
end;
$function$;

revoke all
on function public.refund_organization_portal_credits(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  jsonb
)
from public;

grant execute
on function public.refund_organization_portal_credits(
  uuid,
  uuid,
  integer,
  text,
  text,
  text,
  jsonb
)
to service_role;

commit;
