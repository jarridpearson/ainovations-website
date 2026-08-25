-- Minute packs: purchased overage minutes with rollover.
--
-- Plan minutes reset monthly and are consumed FIRST. Purchased minutes are a
-- persistent balance (they roll over) consumed only after plan minutes are
-- gone. Auto-refill, when a client opts in, buys one pack automatically the
-- moment the combined balance runs out.

begin;

alter table public.ringlatch_clients
  add column if not exists purchased_seconds bigint not null default 0,
  add column if not exists auto_refill boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists cap_alert_stage text;

comment on column public.ringlatch_clients.purchased_seconds is
  'Persistent rollover balance from minute packs. Drawn only after plan minutes.';
comment on column public.ringlatch_clients.cap_alert_stage is
  'Highest usage alert already sent this period: warn|purchased|empty|closed.';

create table if not exists public.ringlatch_minute_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.ringlatch_clients (id),
  seconds bigint not null,
  amount_cents integer not null,
  source text not null check (source in ('purchase', 'auto_refill', 'grant')),
  stripe_payment_intent text,
  stripe_event_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.ringlatch_billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- Atomic drawdown. Floors at zero: the final overshoot of one call (bounded by
-- the 300s per-call cap, about 48 cents of vendor cost) is absorbed rather than
-- tracked as debt. Returns the balance after the draw.
create or replace function public.ringlatch_draw_purchased_seconds(
  target_client_id uuid,
  draw_seconds bigint
)
returns bigint
language sql
volatile
security definer
set search_path = public
as $$
  update public.ringlatch_clients
  set purchased_seconds = greatest(0, purchased_seconds - draw_seconds),
      updated_at = now()
  where id = target_client_id
  returning purchased_seconds;
$$;

create or replace function public.ringlatch_add_purchased_seconds(
  target_client_id uuid,
  add_seconds bigint
)
returns bigint
language sql
volatile
security definer
set search_path = public
as $$
  update public.ringlatch_clients
  set purchased_seconds = purchased_seconds + add_seconds,
      updated_at = now()
  where id = target_client_id
  returning purchased_seconds;
$$;

-- Seconds used this period, for drawdown math (the minutes RPC rounds up).
create or replace function public.ringlatch_period_seconds(
  target_client_id uuid,
  period_start date
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(billable_seconds), 0)
  from public.ringlatch_calls
  where client_id = target_client_id
    and started_at >= period_start
    and started_at < (period_start + interval '1 month');
$$;

alter table public.ringlatch_minute_purchases enable row level security;
alter table public.ringlatch_billing_events enable row level security;

commit;
