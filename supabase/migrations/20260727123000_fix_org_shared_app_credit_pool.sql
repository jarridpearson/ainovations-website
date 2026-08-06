begin;

create or replace function public.sync_organization_shared_app_credit_pool(
  p_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_plan_credits_per_seat integer := 0;
  v_paid_seat_count integer := 0;
  v_monthly_allocation integer := 0;
  v_period_key text;
  v_period_end timestamp with time zone;
  v_effective_tier text;
begin
  select
    greatest(
      coalesce(plan.included_user_ai_credits_monthly, 0),
      0
    ),
    greatest(
      coalesce(organization_record.paid_seat_count, 0),
      0
    ),
    case
      when organization_record.current_billing_period_start is null
        then null
      else to_char(
        organization_record.current_billing_period_start,
        'YYYY-MM'
      )
    end,
    organization_record.current_billing_period_end,
    case
      when organization_record.current_plan_key =
        'organization_pro'
        then 'pro'
      when organization_record.current_plan_key =
        'organization_starter'
        then 'starter'
      else 'free'
    end
  into
    v_plan_credits_per_seat,
    v_paid_seat_count,
    v_period_key,
    v_period_end,
    v_effective_tier
  from public.organizations as organization_record
  left join public.subscription_plans as plan
    on plan.plan_key =
      organization_record.current_plan_key
  where organization_record.id = p_organization_id;

  if not found then
    raise exception 'Organization % was not found.',
      p_organization_id;
  end if;

  if v_period_key is null or v_period_end is null then
    return 0;
  end if;

  v_monthly_allocation :=
    v_plan_credits_per_seat * v_paid_seat_count;

  update public.ai_credit_ledger
  set
    effective_tier = v_effective_tier,
    monthly_allocation = v_monthly_allocation,
    updated_at = now()
  where organization_id = p_organization_id
    and user_id is null
    and credit_pool_type = 'app'
    and period_key = v_period_key;

  if not found then
    insert into public.ai_credit_ledger (
      organization_id,
      user_id,
      credit_pool_type,
      period_key,
      effective_tier,
      monthly_allocation,
      addon_allocation,
      recurring_addon_allocation,
      one_time_top_up_balance,
      used_credits,
      updated_at
    )
    values (
      p_organization_id,
      null,
      'app',
      v_period_key,
      v_effective_tier,
      v_monthly_allocation,
      0,
      0,
      0,
      0,
      now()
    );
  end if;

  return v_monthly_allocation;
end;
$function$;

revoke all
on function public.sync_organization_shared_app_credit_pool(uuid)
from public, anon, authenticated;

grant execute
on function public.sync_organization_shared_app_credit_pool(uuid)
to service_role;

create or replace function public.refresh_organization_shared_app_credit_pool()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sync_organization_shared_app_credit_pool(new.id);
  return new;
end;
$function$;

drop trigger if exists
  organizations_refresh_shared_app_credit_pool
on public.organizations;

create trigger organizations_refresh_shared_app_credit_pool
after insert or update of
  current_plan_key,
  paid_seat_count,
  subscription_status,
  current_billing_period_start,
  current_billing_period_end
on public.organizations
for each row
execute function
  public.refresh_organization_shared_app_credit_pool();

do $$
declare
  organization_record record;
begin
  for organization_record in
    select id
    from public.organizations
    where subscription_status = 'active'
      and current_plan_key in (
        'organization_starter',
        'organization_pro'
      )
  loop
    perform public.sync_organization_shared_app_credit_pool(
      organization_record.id
    );
  end loop;
end
$$;

create or replace function public.get_effective_app_credit_summary()
returns table (
  credit_source text,
  organization_id uuid,
  organization_name text,
  effective_tier text,
  monthly_allocation integer,
  addon_allocation integer,
  recurring_addon_allocation integer,
  one_time_top_up_balance integer,
  used_credits integer,
  total_credits integer,
  available_credits integer,
  renewal_date timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_organization_name text;
  v_period_key text;
  v_renewal_date timestamp with time zone;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select
    organization_record.id,
    organization_record.name,
    to_char(
      organization_record.current_billing_period_start,
      'YYYY-MM'
    ),
    organization_record.current_billing_period_end
  into
    v_organization_id,
    v_organization_name,
    v_period_key,
    v_renewal_date
  from public.organization_users as membership
  join public.organizations as organization_record
    on organization_record.id =
      membership.organization_id
  where membership.user_id = v_user_id
    and membership.is_active = true
    and membership.is_billable = true
    and organization_record.subscription_status = 'active'
    and organization_record.current_plan_key in (
      'organization_starter',
      'organization_pro'
    )
  limit 1;

  if v_organization_id is not null then
    perform public.sync_organization_shared_app_credit_pool(
      v_organization_id
    );

    return query
    select
      'organization'::text,
      v_organization_id,
      v_organization_name,
      ledger.effective_tier,
      coalesce(ledger.monthly_allocation, 0)::integer,
      coalesce(ledger.addon_allocation, 0)::integer,
      coalesce(
        ledger.recurring_addon_allocation,
        0
      )::integer,
      coalesce(
        ledger.one_time_top_up_balance,
        0
      )::integer,
      coalesce(ledger.used_credits, 0)::integer,
      (
        coalesce(ledger.monthly_allocation, 0)
        + coalesce(ledger.addon_allocation, 0)
        + coalesce(
          ledger.recurring_addon_allocation,
          0
        )
        + coalesce(
          ledger.one_time_top_up_balance,
          0
        )
      )::integer,
      greatest(
        coalesce(ledger.monthly_allocation, 0)
        + coalesce(ledger.addon_allocation, 0)
        + coalesce(
          ledger.recurring_addon_allocation,
          0
        )
        + coalesce(
          ledger.one_time_top_up_balance,
          0
        )
        - coalesce(ledger.used_credits, 0),
        0
      )::integer,
      v_renewal_date
    from public.ai_credit_ledger as ledger
    where ledger.organization_id =
        v_organization_id
      and ledger.user_id is null
      and ledger.credit_pool_type = 'app'
      and ledger.period_key = v_period_key
    limit 1;

    return;
  end if;

  return query
  select
    'personal'::text,
    null::uuid,
    null::text,
    ledger.effective_tier,
    coalesce(ledger.monthly_allocation, 0)::integer,
    coalesce(ledger.addon_allocation, 0)::integer,
    coalesce(
      ledger.recurring_addon_allocation,
      0
    )::integer,
    coalesce(
      ledger.one_time_top_up_balance,
      0
    )::integer,
    coalesce(ledger.used_credits, 0)::integer,
    (
      coalesce(ledger.monthly_allocation, 0)
      + coalesce(ledger.addon_allocation, 0)
      + coalesce(
        ledger.recurring_addon_allocation,
        0
      )
      + coalesce(
        ledger.one_time_top_up_balance,
        0
      )
    )::integer,
    greatest(
      coalesce(ledger.monthly_allocation, 0)
      + coalesce(ledger.addon_allocation, 0)
      + coalesce(
        ledger.recurring_addon_allocation,
        0
      )
      + coalesce(
        ledger.one_time_top_up_balance,
        0
      )
      - coalesce(ledger.used_credits, 0),
      0
    )::integer,
    null::timestamp with time zone
  from public.ai_credit_ledger as ledger
  where ledger.user_id = v_user_id
    and ledger.organization_id is null
    and ledger.credit_pool_type = 'app'
  order by ledger.period_key desc
  limit 1;
end;
$function$;

revoke all
on function public.get_effective_app_credit_summary()
from public, anon;

grant execute
on function public.get_effective_app_credit_summary()
to authenticated, service_role;

commit;
