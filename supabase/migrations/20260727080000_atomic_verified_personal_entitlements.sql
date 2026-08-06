begin;

create or replace function public.apply_verified_personal_entitlements(
  p_user_id uuid,
  p_effective_tier text,
  p_recurring_addon_allocation integer
)
returns table (
  id uuid,
  period_key text,
  effective_tier text,
  monthly_allocation integer,
  addon_allocation integer,
  recurring_addon_allocation integer,
  one_time_top_up_balance integer,
  used_credits integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  normalized_tier text;
  normalized_recurring_addon integer;
  resolved_monthly_allocation integer;
  current_period_key text;
  existing_used_credits integer;
  existing_addon_allocation integer;
  existing_top_up_balance integer;
  resulting_ledger public.ai_credit_ledger%rowtype;
begin
  if p_user_id is null then
    raise exception 'A user ID is required.';
  end if;

  normalized_tier := lower(trim(coalesce(p_effective_tier, '')));

  if normalized_tier not in ('free', 'starter', 'pro') then
    raise exception 'Invalid verified personal tier.';
  end if;

  normalized_recurring_addon :=
    greatest(coalesce(p_recurring_addon_allocation, 0), 0);

  if normalized_tier = 'free' then
    resolved_monthly_allocation := 20;
    normalized_recurring_addon := 0;
  elsif normalized_tier = 'starter' then
    resolved_monthly_allocation := 100;
  else
    resolved_monthly_allocation := 200;
  end if;

  current_period_key :=
    to_char(timezone('utc', now()), 'YYYY-MM');

  select
    case
      when ledger.period_key = current_period_key
      then greatest(coalesce(ledger.used_credits, 0), 0)
      else 0
    end,
    greatest(coalesce(ledger.addon_allocation, 0), 0),
    case
      when ledger.period_key = current_period_key
      then greatest(
        coalesce(ledger.one_time_top_up_balance, 0),
        0
      )
      else 0
    end
  into
    existing_used_credits,
    existing_addon_allocation,
    existing_top_up_balance
  from public.ai_credit_ledger ledger
  where ledger.user_id = p_user_id
  for update;

  existing_used_credits :=
    coalesce(existing_used_credits, 0);

  existing_addon_allocation :=
    coalesce(existing_addon_allocation, 0);

  existing_top_up_balance :=
    coalesce(existing_top_up_balance, 0);

  insert into public.user_subscription_settings (
    user_id,
    effective_tier,
    recurring_addon_allocation,
    updated_at
  )
  values (
    p_user_id,
    normalized_tier,
    normalized_recurring_addon,
    now()
  )
  on conflict (user_id)
  do update set
    effective_tier = excluded.effective_tier,
    recurring_addon_allocation =
      excluded.recurring_addon_allocation,
    updated_at = now();

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
    p_user_id,
    current_period_key,
    normalized_tier,
    resolved_monthly_allocation,
    existing_addon_allocation,
    normalized_recurring_addon,
    existing_top_up_balance,
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
    one_time_top_up_balance =
      excluded.one_time_top_up_balance,
    used_credits = excluded.used_credits,
    updated_at = now()
  returning *
  into resulting_ledger;

  return query
  select
    resulting_ledger.id,
    resulting_ledger.period_key,
    resulting_ledger.effective_tier,
    resulting_ledger.monthly_allocation,
    resulting_ledger.addon_allocation,
    resulting_ledger.recurring_addon_allocation,
    resulting_ledger.one_time_top_up_balance,
    resulting_ledger.used_credits;
end;
$function$;

revoke all
on function public.apply_verified_personal_entitlements(
  uuid,
  text,
  integer
)
from public, anon, authenticated;

grant execute
on function public.apply_verified_personal_entitlements(
  uuid,
  text,
  integer
)
to service_role;

commit;
