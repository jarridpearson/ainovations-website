-- Signups move into our database and checkout becomes server-created, so the
-- hard rules can be enforced BEFORE money moves:
--
--   - One forwarded business number = one account. Ever. Enforced here and
--     checked at checkout; a second signup for the same number is blocked at
--     the form, told to add the business to the existing account instead.
--   - One account = one subscription. An existing subscriber cannot reach
--     checkout again.
--   - Multiple businesses live INSIDE one account (the agent asks callers
--     which business they need) — never as duplicate accounts.

begin;

alter table public.ringlatch_clients
  add column if not exists forwarding_number text;

comment on column public.ringlatch_clients.forwarding_number is
  'The business line the client forwards from. One number, one account, ever.';

create unique index if not exists ringlatch_clients_forwarding_key
  on public.ringlatch_clients (forwarding_number)
  where forwarding_number is not null;

create table if not exists public.ringlatch_signups (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  business_type text not null,
  contact_name text not null,
  owner_cell text not null,
  email text not null,
  forwarding_number text not null,
  plan_key text not null check (plan_key in ('standard', 'busy')),
  notes text,
  sms_consent boolean not null default false,
  consent_text text,
  consent_ip text,
  consent_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'provisioned', 'abandoned')),
  stripe_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Money moved: the number is locked. Pending rows do not lock (an abandoned
-- checkout must never squat a number); the checkout function supersedes them.
create unique index if not exists ringlatch_signups_forwarding_paid_key
  on public.ringlatch_signups (forwarding_number)
  where status in ('paid', 'provisioned');

alter table public.ringlatch_signups enable row level security;

commit;
