begin;

-- ============================================================
-- RINGLATCH
-- AI phone receptionist for Central and Northern NY service
-- businesses. One agent template, one JSON profile per client.
--
-- Every table here is written exclusively by the service role
-- (the ringlatch-call-webhook edge function). RLS is enabled
-- with no permissive policies, so nothing is reachable with an
-- anon or authenticated key. The client dashboard in v2 adds
-- read policies against a future ringlatch_client_users table.
-- ============================================================

create table public.ringlatch_clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  business_name text not null,

  -- The full validated ClientProfile. Everything the agent knows
  -- about this business lives here; there is no per-client code.
  profile jsonb not null,

  coverage_mode text not null default 'missed_call',
  plan_key text not null default 'standard',
  status text not null default 'onboarding',

  -- Denormalized for fast inbound lookup on the hot webhook path.
  ringlatch_number text not null,
  owner_cell text not null,

  -- Billing guardrails. There is no overage: past included_minutes the agent
  -- drops to brief mode, and past 1.5x it stops answering. See limits.ts.
  included_minutes integer not null default 150,
  cap_alert_sent_for_period date,

  retell_agent_id text,
  stripe_subscription_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  cancelled_at timestamptz,

  constraint ringlatch_clients_slug_unique unique (slug),
  constraint ringlatch_clients_number_unique unique (ringlatch_number),

  constraint ringlatch_clients_coverage_mode_check
    check (coverage_mode in ('missed_call', 'full_answering')),

  constraint ringlatch_clients_plan_key_check
    check (plan_key in ('standard', 'busy')),

  constraint ringlatch_clients_status_check
    check (status in ('onboarding', 'active', 'paused', 'cancelled')),

  constraint ringlatch_clients_included_minutes_check
    check (included_minutes > 0)
);

create table public.ringlatch_calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.ringlatch_clients(id)
    on delete cascade,

  -- Retell's call id. Webhooks retry, so this is the idempotency key.
  provider_call_id text not null,

  from_number text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null default 0,

  -- Screened spam never counts against the client's included minutes.
  billable_seconds integer not null default 0,

  outcome text not null,
  urgency_level text not null default 'routine',
  urgency_matched text[] not null default '{}',

  spam_screened boolean not null default false,
  spam_reason text,

  transfer_attempted boolean not null default false,
  transfer_connected boolean not null default false,

  text_back_sent boolean not null default false,
  owner_sms_sent boolean not null default false,
  owner_email_sent boolean not null default false,

  transcript text,
  transcript_url text,
  recording_url text,

  created_at timestamptz not null default now(),

  constraint ringlatch_calls_provider_call_id_unique unique (provider_call_id),

  constraint ringlatch_calls_outcome_check
    check (
      outcome in (
        'lead_captured',
        'caller_hung_up',
        'spam_screened',
        'transferred'
      )
    ),

  constraint ringlatch_calls_urgency_level_check
    check (urgency_level in ('routine', 'priority')),

  constraint ringlatch_calls_duration_check
    check (duration_seconds >= 0 and billable_seconds >= 0),

  constraint ringlatch_calls_billable_within_duration_check
    check (billable_seconds <= duration_seconds)
);

create table public.ringlatch_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.ringlatch_clients(id)
    on delete cascade,
  call_id uuid not null
    references public.ringlatch_calls(id)
    on delete cascade,

  caller_name text,
  callback_number text,
  town text,
  address text,
  job_description text,
  urgency_note text,

  -- Owner-facing follow-up state, drives the monthly caught-leads report.
  status text not null default 'new',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ringlatch_leads_call_unique unique (call_id),

  constraint ringlatch_leads_status_check
    check (status in ('new', 'contacted', 'won', 'lost', 'spam'))
);

-- Delivery attempts for every outbound SMS and email, so a client asking
-- "did he ever get my text?" is answerable without provider dashboards.
create table public.ringlatch_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.ringlatch_clients(id)
    on delete cascade,
  call_id uuid
    references public.ringlatch_calls(id)
    on delete cascade,

  channel text not null,
  purpose text not null,
  recipient text not null,
  body text,

  status text not null default 'queued',
  provider_message_id text,
  error_message text,

  created_at timestamptz not null default now(),
  delivered_at timestamptz,

  constraint ringlatch_notifications_channel_check
    check (channel in ('sms', 'email')),

  constraint ringlatch_notifications_purpose_check
    check (
      purpose in (
        'owner_alert',
        'owner_summary',
        'caller_text_back',
        'cap_warning'
      )
    ),

  constraint ringlatch_notifications_status_check
    check (status in ('queued', 'sent', 'failed'))
);

create index ringlatch_calls_client_started_idx
  on public.ringlatch_calls (client_id, started_at desc);

create index ringlatch_calls_urgency_idx
  on public.ringlatch_calls (client_id, urgency_level)
  where urgency_level = 'priority';

create index ringlatch_leads_client_status_idx
  on public.ringlatch_leads (client_id, status, created_at desc);

create index ringlatch_notifications_call_idx
  on public.ringlatch_notifications (call_id);

-- ============================================================
-- Minute usage, for the 80% cap alert and overage billing.
-- ============================================================

create or replace function public.ringlatch_period_minutes(
  target_client_id uuid,
  period_start date
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    ceil(sum(billable_seconds)::numeric / 60)::integer,
    0
  )
  from public.ringlatch_calls
  where client_id = target_client_id
    and started_at >= period_start
    and started_at < (period_start + interval '1 month');
$$;

alter table public.ringlatch_clients enable row level security;
alter table public.ringlatch_calls enable row level security;
alter table public.ringlatch_leads enable row level security;
alter table public.ringlatch_notifications enable row level security;

commit;
