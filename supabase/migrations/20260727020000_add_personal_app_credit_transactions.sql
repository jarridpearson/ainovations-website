create or replace function public.consume_personal_app_credits(
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
  period_key text,
  already_consumed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_period_key text :=
    to_char(
      timezone('UTC', now()),
      'YYYY-MM'
    );
  v_ledger_id uuid;
  v_effective_tier text;
  v_monthly_allocation integer;
  v_addon_allocation integer;
  v_recurring_addon_allocation integer;
  v_one_time_top_up_balance integer;
  v_used_credits integer;
  v_total_credits integer;
  v_available_credits integer;
  v_updated_used_credits integer;
  v_consumed_count integer := 0;
  v_refunded_count integer := 0;
begin
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

  select
    credit_ledger.id,
    credit_ledger.effective_tier,
    credit_ledger.monthly_allocation,
    credit_ledger.addon_allocation,
    credit_ledger.recurring_addon_allocation,
    credit_ledger.one_time_top_up_balance,
    credit_ledger.used_credits
  into
    v_ledger_id,
    v_effective_tier,
    v_monthly_allocation,
    v_addon_allocation,
    v_recurring_addon_allocation,
    v_one_time_top_up_balance,
    v_used_credits
  from public.ai_credit_ledger as credit_ledger
  where credit_ledger.user_id = p_user_id
    and credit_ledger.organization_id is null
    and credit_ledger.period_key = v_period_key
  order by credit_ledger.updated_at desc nulls last
  limit 1
  for update;

  if v_ledger_id is null then
    raise exception
      'No personal app AI credit ledger was found for the current month.';
  end if;

  if v_effective_tier not in ('starter', 'pro') then
    raise exception
      'Personal app AI credits require Starter or Pro.';
  end if;

  v_total_credits :=
    coalesce(v_monthly_allocation, 0)
    + coalesce(v_addon_allocation, 0)
    + coalesce(v_recurring_addon_allocation, 0)
    + coalesce(v_one_time_top_up_balance, 0);

  select
    count(*) filter (
      where usage_event.metadata ->> 'credit_action' =
        'consumed'
    ),
    count(*) filter (
      where usage_event.metadata ->> 'credit_action' =
        'refunded'
    )
  into
    v_consumed_count,
    v_refunded_count
  from public.usage_events as usage_event
  where usage_event.organization_id is null
    and usage_event.user_id = p_user_id
    and usage_event.feature_key = trim(p_feature_key)
    and usage_event.metadata ->> 'request_id' =
      p_request_id::text
    and usage_event.metadata ->> 'credit_pool_type' =
      'app'
    and usage_event.metadata ->> 'credit_owner' =
      'personal';

  if v_consumed_count > v_refunded_count then
    return query
    select
      greatest(
        v_total_credits - coalesce(v_used_credits, 0),
        0
      )::integer,
      coalesce(v_used_credits, 0)::integer,
      v_period_key,
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
      'Not enough personal app AI credits are available. This action requires % credit(s), but only % remain.',
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
    null,
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
        'credit_owner',
        'personal',
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
    v_period_key,
    false;
end;
$function$;


create or replace function public.refund_personal_app_credits(
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
  period_key text,
  already_refunded boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_period_key text;
  v_ledger_id uuid;
  v_monthly_allocation integer;
  v_addon_allocation integer;
  v_recurring_addon_allocation integer;
  v_one_time_top_up_balance integer;
  v_used_credits integer;
  v_total_credits integer;
  v_updated_used_credits integer;
  v_consumed_count integer := 0;
  v_refunded_count integer := 0;
begin
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

  select
    count(*) filter (
      where usage_event.metadata ->> 'credit_action' =
        'consumed'
    ),
    count(*) filter (
      where usage_event.metadata ->> 'credit_action' =
        'refunded'
    ),
    max(
      usage_event.metadata ->> 'period_key'
    )
  into
    v_consumed_count,
    v_refunded_count,
    v_period_key
  from public.usage_events as usage_event
  where usage_event.organization_id is null
    and usage_event.user_id = p_user_id
    and usage_event.feature_key = trim(p_feature_key)
    and usage_event.metadata ->> 'request_id' =
      p_request_id::text
    and usage_event.metadata ->> 'credit_pool_type' =
      'app'
    and usage_event.metadata ->> 'credit_owner' =
      'personal';

  if v_consumed_count = 0 or v_period_key is null then
    raise exception
      'No matching personal app-credit charge was found.';
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
  where credit_ledger.user_id = p_user_id
    and credit_ledger.organization_id is null
    and credit_ledger.period_key = v_period_key
  order by credit_ledger.updated_at desc nulls last
  limit 1
  for update;

  if v_ledger_id is null then
    raise exception
      'The personal app-credit ledger for the original charge was not found.';
  end if;

  v_total_credits :=
    coalesce(v_monthly_allocation, 0)
    + coalesce(v_addon_allocation, 0)
    + coalesce(v_recurring_addon_allocation, 0)
    + coalesce(v_one_time_top_up_balance, 0);

  if v_consumed_count <= v_refunded_count then
    return query
    select
      greatest(
        v_total_credits - coalesce(v_used_credits, 0),
        0
      )::integer,
      coalesce(v_used_credits, 0)::integer,
      v_period_key,
      true;

    return;
  end if;

  if coalesce(v_used_credits, 0) < p_credit_cost then
    raise exception
      'The personal app-credit ledger does not contain enough used credits to refund.';
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
    null,
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
        'credit_owner',
        'personal',
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
    v_period_key,
    false;
end;
$function$;


revoke all
on function public.consume_personal_app_credits(
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
on function public.refund_personal_app_credits(
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
on function public.consume_personal_app_credits(
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
on function public.refund_personal_app_credits(
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
