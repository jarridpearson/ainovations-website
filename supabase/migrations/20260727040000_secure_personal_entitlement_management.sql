begin;

create or replace function public.sync_personal_app_entitlements(
  p_user_id uuid default auth.uid()
)
returns table (
  ledger_id uuid,
  effective_tier text,
  monthly_allocation integer,
  addon_allocation integer,
  recurring_addon_allocation integer,
  used_credits integer,
  available_credits integer,
  period_key text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  requesting_user_id uuid;
  target_user_id uuid;
  current_period_key text;
  resolved_tier text;
  resolved_monthly_allocation integer;
  resolved_recurring_addon integer;
  existing_used_credits integer;
  existing_addon_allocation integer;
  resulting_ledger public.ai_credit_ledger%rowtype;
begin
  requesting_user_id := auth.uid();
  target_user_id := coalesce(p_user_id, requesting_user_id);

  if requesting_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if target_user_id <> requesting_user_id then
    raise exception 'Users may only synchronize their own entitlements.';
  end if;

  current_period_key := to_char(
    timezone('utc', now()),
    'YYYY-MM'
  );

  select
    case
      when lower(trim(coalesce(settings.effective_tier, 'free'))) in (
        'free',
        'starter',
        'pro'
      )
      then lower(trim(coalesce(settings.effective_tier, 'free')))
      else 'free'
    end,
    greatest(
      coalesce(settings.recurring_addon_allocation, 0),
      0
    )
  into
    resolved_tier,
    resolved_recurring_addon
  from public.user_subscription_settings settings
  where settings.user_id = target_user_id;

  if resolved_tier is null then
    resolved_tier := 'free';
    resolved_recurring_addon := 0;

    insert into public.user_subscription_settings (
      user_id,
      effective_tier,
      recurring_addon_allocation,
      updated_at
    )
    values (
      target_user_id,
      resolved_tier,
      resolved_recurring_addon,
      now()
    )
    on conflict (user_id) do nothing;
  end if;

  if resolved_tier = 'free' then
    resolved_monthly_allocation := 20;
    resolved_recurring_addon := 0;
  elsif resolved_tier = 'starter' then
    resolved_monthly_allocation := 200;
  else
    resolved_monthly_allocation := 200;
  end if;

  select
    case
      when ledger.period_key = current_period_key
      then greatest(coalesce(ledger.used_credits, 0), 0)
      else 0
    end,
    greatest(coalesce(ledger.addon_allocation, 0), 0)
  into
    existing_used_credits,
    existing_addon_allocation
  from public.ai_credit_ledger ledger
  where ledger.user_id = target_user_id
  for update;

  existing_used_credits := coalesce(existing_used_credits, 0);
  existing_addon_allocation := coalesce(existing_addon_allocation, 0);

  insert into public.ai_credit_ledger (
    user_id,
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
    target_user_id,
    current_period_key,
    resolved_tier,
    resolved_monthly_allocation,
    existing_addon_allocation,
    resolved_recurring_addon,
    0,
    existing_used_credits,
    now()
  )
  on conflict (user_id)
  do update set
    period_key = excluded.period_key,
    effective_tier = excluded.effective_tier,
    monthly_allocation = excluded.monthly_allocation,
    addon_allocation = excluded.addon_allocation,
    recurring_addon_allocation =
      excluded.recurring_addon_allocation,
    one_time_top_up_balance = 0,
    used_credits = excluded.used_credits,
    updated_at = now()
  returning *
  into resulting_ledger;

  return query
  select
    resulting_ledger.id,
    resulting_ledger.effective_tier,
    resulting_ledger.monthly_allocation,
    resulting_ledger.addon_allocation,
    resulting_ledger.recurring_addon_allocation,
    resulting_ledger.used_credits,
    greatest(
      resulting_ledger.monthly_allocation +
      resulting_ledger.addon_allocation +
      resulting_ledger.recurring_addon_allocation +
      resulting_ledger.one_time_top_up_balance -
      resulting_ledger.used_credits,
      0
    ),
    resulting_ledger.period_key;
end;
$function$;

create or replace function public.master_admin_set_personal_app_tier(
  p_tier text
)
returns table (
  ledger_id uuid,
  effective_tier text,
  monthly_allocation integer,
  addon_allocation integer,
  recurring_addon_allocation integer,
  used_credits integer,
  available_credits integer,
  period_key text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  requesting_user_id uuid;
  normalized_tier text;
  monthly_allocation_value integer;
  recurring_addon_value integer;
  current_period_key text;
  existing_used_credits integer;
  existing_addon_allocation integer;
  resulting_ledger public.ai_credit_ledger%rowtype;
begin
  requesting_user_id := auth.uid();

  if requesting_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.master_admin_users admin_user
    where admin_user.user_id = requesting_user_id
      and admin_user.role = 'master_admin'
  ) then
    raise exception 'Master admin access is required.';
  end if;

  normalized_tier := lower(trim(coalesce(p_tier, '')));

  if normalized_tier not in ('free', 'starter', 'pro') then
    raise exception 'Invalid personal app tier.';
  end if;

  if normalized_tier = 'free' then
    monthly_allocation_value := 20;
    recurring_addon_value := 0;
  elsif normalized_tier = 'starter' then
    monthly_allocation_value := 200;
  else
    monthly_allocation_value := 200;
  end if;

  select greatest(
    coalesce(settings.recurring_addon_allocation, 0),
    0
  )
  into recurring_addon_value
  from public.user_subscription_settings settings
  where settings.user_id = requesting_user_id;

  recurring_addon_value := coalesce(
    recurring_addon_value,
    0
  );

  if normalized_tier = 'free' then
    recurring_addon_value := 0;
  end if;

  insert into public.user_subscription_settings (
    user_id,
    effective_tier,
    recurring_addon_allocation,
    updated_at
  )
  values (
    requesting_user_id,
    normalized_tier,
    recurring_addon_value,
    now()
  )
  on conflict (user_id)
  do update set
    effective_tier = excluded.effective_tier,
    recurring_addon_allocation =
      excluded.recurring_addon_allocation,
    updated_at = now();

  current_period_key := to_char(
    timezone('utc', now()),
    'YYYY-MM'
  );

  select
    case
      when ledger.period_key = current_period_key
      then greatest(coalesce(ledger.used_credits, 0), 0)
      else 0
    end,
    greatest(coalesce(ledger.addon_allocation, 0), 0)
  into
    existing_used_credits,
    existing_addon_allocation
  from public.ai_credit_ledger ledger
  where ledger.user_id = requesting_user_id
  for update;

  existing_used_credits := coalesce(existing_used_credits, 0);
  existing_addon_allocation := coalesce(existing_addon_allocation, 0);

  insert into public.ai_credit_ledger (
    user_id,
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
    requesting_user_id,
    current_period_key,
    normalized_tier,
    monthly_allocation_value,
    existing_addon_allocation,
    recurring_addon_value,
    0,
    existing_used_credits,
    now()
  )
  on conflict (user_id)
  do update set
    period_key = excluded.period_key,
    effective_tier = excluded.effective_tier,
    monthly_allocation = excluded.monthly_allocation,
    addon_allocation = excluded.addon_allocation,
    recurring_addon_allocation =
      excluded.recurring_addon_allocation,
    one_time_top_up_balance = 0,
    used_credits = excluded.used_credits,
    updated_at = now()
  returning *
  into resulting_ledger;

  return query
  select
    resulting_ledger.id,
    resulting_ledger.effective_tier,
    resulting_ledger.monthly_allocation,
    resulting_ledger.addon_allocation,
    resulting_ledger.recurring_addon_allocation,
    resulting_ledger.used_credits,
    greatest(
      resulting_ledger.monthly_allocation +
      resulting_ledger.addon_allocation +
      resulting_ledger.recurring_addon_allocation +
      resulting_ledger.one_time_top_up_balance -
      resulting_ledger.used_credits,
      0
    ),
    resulting_ledger.period_key;
end;
$function$;

revoke all
on function public.sync_personal_app_entitlements(uuid)
from public;

grant execute
on function public.sync_personal_app_entitlements(uuid)
to authenticated;

revoke all
on function public.master_admin_set_personal_app_tier(text)
from public;

grant execute
on function public.master_admin_set_personal_app_tier(text)
to authenticated;

commit;
