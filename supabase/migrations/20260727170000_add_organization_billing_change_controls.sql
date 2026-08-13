alter table public.organization_users
  add column if not exists app_access_activated_at timestamp with time zone;

update public.organization_users
set app_access_activated_at = now()
where is_active = true
  and is_billable = true
  and app_access_activated_at is null;

create or replace function public.set_organization_user_app_access_activated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active = true
     and new.is_billable = true
     and (
       old.is_active is distinct from true
       or old.is_billable is distinct from true
       or old.app_access_activated_at is null
     )
  then
    new.app_access_activated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists organization_users_set_app_access_activated_at
on public.organization_users;

create trigger organization_users_set_app_access_activated_at
before update of is_active, is_billable
on public.organization_users
for each row
execute function public.set_organization_user_app_access_activated_at();

create table if not exists public.organization_billing_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,
  requested_by_user_id uuid
    references auth.users(id)
    on delete set null,

  change_type text not null
    check (
      change_type in (
        'plan_change',
        'seat_increase',
        'seat_decrease',
        'portal_credit_change',
        'app_credit_change',
        'subscription_cancellation'
      )
    ),

  change_status text not null default 'pending'
    check (
      change_status in (
        'pending',
        'processing',
        'scheduled',
        'applied',
        'canceled',
        'failed'
      )
    ),

  current_plan_key text,
  requested_plan_key text,
  current_billing_interval text,
  requested_billing_interval text,

  current_seat_quantity integer,
  requested_seat_quantity integer,

  current_addon_quantity integer,
  requested_addon_quantity integer,

  effective_at timestamp with time zone,
  applied_at timestamp with time zone,
  canceled_at timestamp with time zone,

  stripe_subscription_id text,
  stripe_subscription_item_id text,
  stripe_schedule_id text,
  stripe_invoice_id text,

  error_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists
  organization_billing_change_requests_organization_index
on public.organization_billing_change_requests (
  organization_id,
  change_status,
  effective_at
);

alter table public.organization_billing_change_requests
  enable row level security;

revoke all
on table public.organization_billing_change_requests
from public, anon, authenticated;

grant all
on table public.organization_billing_change_requests
to service_role;

alter table public.organizations
  add column if not exists pending_plan_key text,
  add column if not exists pending_billing_interval text,
  add column if not exists pending_paid_seat_count integer,
  add column if not exists pending_plan_effective_at timestamp with time zone,
  add column if not exists pending_seat_effective_at timestamp with time zone,
  add column if not exists pending_subscription_cancel_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_pending_plan_key_check'
  ) then
    alter table public.organizations
      add constraint organizations_pending_plan_key_check
      check (
        pending_plan_key is null
        or pending_plan_key in (
          'organization_starter',
          'organization_pro'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_pending_billing_interval_check'
  ) then
    alter table public.organizations
      add constraint organizations_pending_billing_interval_check
      check (
        pending_billing_interval is null
        or pending_billing_interval in ('monthly', 'annual')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_pending_paid_seat_count_check'
  ) then
    alter table public.organizations
      add constraint organizations_pending_paid_seat_count_check
      check (
        pending_paid_seat_count is null
        or pending_paid_seat_count >= 1
      );
  end if;
end;
$$;

create or replace function public.apply_organization_seat_reduction(
  p_organization_id uuid,
  p_target_seat_count integer
)
returns table (
  deactivated_user_count integer,
  remaining_billable_user_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_billable_count integer := 0;
  v_users_to_disable integer := 0;
  v_deactivated_count integer := 0;
begin
  if p_organization_id is null then
    raise exception 'Organization ID is required.';
  end if;

  if p_target_seat_count is null or p_target_seat_count < 1 then
    raise exception 'Target seat count must be at least 1.';
  end if;

  select count(*)::integer
  into v_current_billable_count
  from public.organization_users
  where organization_id = p_organization_id
    and is_active = true
    and is_billable = true;

  v_users_to_disable :=
    greatest(v_current_billable_count - p_target_seat_count, 0);

  if v_users_to_disable > 0 then
    with users_to_disable as (
      select organization_user.id
      from public.organization_users organization_user
      where organization_user.organization_id = p_organization_id
        and organization_user.is_active = true
        and organization_user.is_billable = true
      order by
        organization_user.app_access_activated_at desc nulls last,
        organization_user.id desc
      limit v_users_to_disable
    )
    update public.organization_users organization_user
    set
      is_billable = false,
      primary_group_id = null
    where organization_user.id in (
      select users_to_disable.id
      from users_to_disable
    );

    get diagnostics v_deactivated_count = row_count;
  end if;

  update public.organizations
  set
    paid_seat_count = p_target_seat_count,
    pending_paid_seat_count = null,
    pending_seat_effective_at = null
  where id = p_organization_id;

  return query
  select
    v_deactivated_count,
    greatest(v_current_billable_count - v_deactivated_count, 0);
end;
$$;

revoke all
on function public.apply_organization_seat_reduction(uuid, integer)
from public, anon, authenticated;

grant execute
on function public.apply_organization_seat_reduction(uuid, integer)
to service_role;

comment on column public.organization_users.app_access_activated_at is
  'The most recent date this account received active Everward app access. Used to determine which accounts lose app access first when an annual prepaid seat reduction becomes effective.';

comment on table public.organization_billing_change_requests is
  'Tracks immediate and scheduled Stripe organization subscription changes, including annual plan and seat changes and recurring AI credit add-ons.';

comment on function public.apply_organization_seat_reduction(uuid, integer) is
  'Applies a scheduled organization app-seat reduction. The most recently activated app accounts lose app access first.';
