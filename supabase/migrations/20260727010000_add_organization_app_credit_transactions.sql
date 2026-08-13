create or replace function public.consume_organization_app_credits(
  p_organization_id uuid,
  p_user_id uuid,
  p_credit_cost integer,
  p_request_id uuid,
  p_event_type text,
  p_feature_key text,
  p_route text,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  app_credits_available integer,
  app_credits_used integer,
  app_credit_renewal_date timestamp with time zone,
  already_consumed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_available_credits integer;
  v_updated_used_credits integer;
  v_existing_charge boolean := false;
begin
  if p_organization_id is null then
    raise exception 'Organization ID is required.';
  end if;

  if p_user_id is null then
    raise exception 'User ID is required.';
  end if;

  if p_request_id is null then
    raise exception 'Request ID is required.';
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
    join public.organizations as organization_record
      on organization_record.id =
        organization_user.organization_id
    where organization_user.organization_id =
        p_organization_id
      and organization_user.user_id = p_user_id
      and organization_user.is_active = true
      and organization_user.is_billable = true
      and organization_record.subscription_status = 'active'
      and organization_record.current_plan_key in (
        'organization_starter',
        'organization_pro'
      )
  ) then
    raise exception
      'The user does not have active organization app access.';
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
  where credit_ledger.organization_id =
      p_organization_id
    and credit_ledger.user_id is null
    and credit_ledger.credit_pool_type = 'app'
    and credit_ledger.period_key = v_period_key
  for update;

  if v_ledger_id is null then
    raise exception
      'The organization app-credit pool is not available.';
  end if;

  v_total_credits :=
    coalesce(v_monthly_allocation, 0)
    + coalesce(v_addon_allocation, 0)
    + coalesce(v_recurring_addon_allocation, 0)
    + coalesce(v_one_time_top_up_balance, 0);

  select exists (
    select 1
    from public.usage_events as usage_event
    where usage_event.organization_id =
        p_organization_id
      and usage_event.user_id = p_user_id
      and usage_event.feature_key =
        trim(p_feature_key)
      and usage_event.metadata ->> 'request_id' =
        p_request_id::text
      and usage_event.metadata ->> 'credit_action' =
        'consumed'
      and usage_event.metadata ->> 'credit_pool_type' =
        'app'
  )
  into v_existing_charge;

  if v_existing_charge then
    return query
    select
      greatest(
        v_total_credits - coalesce(v_used_credits, 0),
        0
      )::integer,
      coalesce(v_used_credits, 0)::integer,
      v_period_end,
      true;

    return;
  end if;

  v_available_credits :=
    greatest(
      v_total_credits - coalesce(v_used_credits, 0),
      0
    );

  if v_available_credits < p_credit_cost then
    raise exception
      'Not enough organization app AI credits are available. This action requires % credit(s), but only % remain.',
      p_credit_cost,
      v_available_credits;
  end if;

  v_updated_used_credits :=
    coalesce(v_used_credits, 0) + p_credit_cost;

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
        'request_id',
        p_request_id,
        'credit_action',
        'consumed',
        'credit_pool_type',
        'app',
        'credits_used',
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
    v_period_end,
    false;
end;
$function$;


create or replace function public.refund_organization_app_credits(
  p_organization_id uuid,
  p_user_id uuid,
  p_credit_cost integer,
  p_request_id uuid,
  p_event_type text,
  p_feature_key text,
  p_route text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  app_credits_available integer,
  app_credits_used integer,
  app_credit_renewal_date timestamp with time zone,
  already_refunded boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_charge_exists boolean := false;
  v_refund_exists boolean := false;
begin
  if p_organization_id is null then
    raise exception 'Organization ID is required.';
  end if;

  if p_user_id is null then
    raise exception 'User ID is required.';
  end if;

  if p_request_id is null then
    raise exception 'Request ID is required.';
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

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Refund reason is required.';
  end if;

  if not exists (
    select 1
    from public.organization_users as organization_user
    where organization_user.organization_id =
        p_organization_id
      and organization_user.user_id = p_user_id
      and organization_user.is_active = true
  ) then
    raise exception
      'The user is not an active organization member.';
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
  where credit_ledger.organization_id =
      p_organization_id
    and credit_ledger.user_id is null
    and credit_ledger.credit_pool_type = 'app'
    and credit_ledger.period_key = v_period_key
  for update;

  if v_ledger_id is null then
    raise exception
      'The organization app-credit pool is not available.';
  end if;

  v_total_credits :=
    coalesce(v_monthly_allocation, 0)
    + coalesce(v_addon_allocation, 0)
    + coalesce(v_recurring_addon_allocation, 0)
    + coalesce(v_one_time_top_up_balance, 0);

  select exists (
    select 1
    from public.usage_events as usage_event
    where usage_event.organization_id =
        p_organization_id
      and usage_event.user_id = p_user_id
      and usage_event.feature_key =
        trim(p_feature_key)
      and usage_event.metadata ->> 'request_id' =
        p_request_id::text
      and usage_event.metadata ->> 'credit_action' =
        'consumed'
      and usage_event.metadata ->> 'credit_pool_type' =
        'app'
  )
  into v_charge_exists;

  if not v_charge_exists then
    raise exception
      'No matching organization app-credit charge was found.';
  end if;

  select exists (
    select 1
    from public.usage_events as usage_event
    where usage_event.organization_id =
        p_organization_id
      and usage_event.user_id = p_user_id
      and usage_event.feature_key =
        trim(p_feature_key)
      and usage_event.metadata ->> 'request_id' =
        p_request_id::text
      and usage_event.metadata ->> 'credit_action' =
        'refunded'
      and usage_event.metadata ->> 'credit_pool_type' =
        'app'
  )
  into v_refund_exists;

  if v_refund_exists then
    return query
    select
      greatest(
        v_total_credits - coalesce(v_used_credits, 0),
        0
      )::integer,
      coalesce(v_used_credits, 0)::integer,
      v_period_end,
      true;

    return;
  end if;

  if coalesce(v_used_credits, 0) < p_credit_cost then
    raise exception
      'The organization app-credit ledger does not contain enough used credits to refund.';
  end if;

  v_updated_used_credits :=
    coalesce(v_used_credits, 0) - p_credit_cost;

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
        'request_id',
        p_request_id,
        'credit_action',
        'refunded',
        'credit_pool_type',
        'app',
        'credits_refunded',
        p_credit_cost,
        'period_key',
        v_period_key,
        'reason',
        trim(p_reason)
      )
  );

  return query
  select
    greatest(
      v_total_credits - v_updated_used_credits,
      0
    )::integer,
    v_updated_used_credits::integer,
    v_period_end,
    false;
end;
$function$;


revoke all
on function public.consume_organization_app_credits(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  jsonb
)
from public;

revoke all
on function public.refund_organization_app_credits(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
)
from public;

grant execute
on function public.consume_organization_app_credits(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  jsonb
)
to service_role;

grant execute
on function public.refund_organization_app_credits(
  uuid,
  uuid,
  integer,
  uuid,
  text,
  text,
  text,
  text,
  jsonb
)
to service_role;
