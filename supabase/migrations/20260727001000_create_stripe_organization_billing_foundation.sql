begin;

-- ============================================================
-- STRIPE IDENTIFIERS ON ORGANIZATIONS
-- ============================================================

alter table public.organizations
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_item_id text,
  add column if not exists stripe_primary_price_id text,
  add column if not exists stripe_latest_invoice_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_cancel_at_period_end boolean not null default false,
  add column if not exists stripe_billing_synced_at timestamp with time zone,
  add column if not exists stripe_billing_error text;

create unique index if not exists organizations_stripe_customer_id_unique
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_id_unique
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists organizations_subscription_status_index
  on public.organizations (subscription_status);

-- ============================================================
-- STRIPE PRICE MAPPING
-- One plan can contain a portal base price and a per-seat price.
-- Credit add-ons can be added later without changing the schema.
-- ============================================================

create table if not exists public.stripe_billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null
    references public.subscription_plans (plan_key)
    on update cascade
    on delete restrict,
  component_key text not null
    check (
      component_key in (
        'portal_base',
        'user_seat',
        'portal_credit_addon',
        'user_credit_addon'
      )
    ),
  billing_interval text not null
    check (billing_interval in ('monthly', 'annual')),
  stripe_product_id text,
  stripe_price_id text not null,
  unit_amount_cents integer
    check (unit_amount_cents is null or unit_amount_cents >= 0),
  credits_per_unit integer
    check (credits_per_unit is null or credits_per_unit > 0),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (plan_key, component_key, billing_interval),
  unique (stripe_price_id)
);

create index if not exists stripe_billing_prices_lookup_index
  on public.stripe_billing_prices (
    plan_key,
    billing_interval,
    component_key,
    active
  );

alter table public.stripe_billing_prices enable row level security;

revoke all on table public.stripe_billing_prices from public;
revoke all on table public.stripe_billing_prices from anon;
revoke all on table public.stripe_billing_prices from authenticated;

grant all on table public.stripe_billing_prices to service_role;

-- ============================================================
-- CHECKOUT REQUESTS
-- Prevents repeated clicks or network retries from creating
-- multiple Checkout Sessions.
-- ============================================================

create table if not exists public.organization_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id)
    on delete cascade,
  requested_by_user_id uuid not null
    references auth.users (id)
    on delete restrict,
  request_id uuid not null,
  plan_key text not null
    references public.subscription_plans (plan_key)
    on update cascade
    on delete restrict,
  billing_interval text not null
    check (billing_interval in ('monthly', 'annual')),
  seat_quantity integer not null
    check (seat_quantity >= 1),
  stripe_checkout_session_id text,
  stripe_checkout_url text,
  request_status text not null default 'pending'
    check (
      request_status in (
        'pending',
        'created',
        'completed',
        'expired',
        'failed'
      )
    ),
  error_message text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, requested_by_user_id, request_id)
);

create index if not exists organization_checkout_requests_org_index
  on public.organization_checkout_requests (
    organization_id,
    created_at desc
  );

create unique index if not exists organization_checkout_session_unique
  on public.organization_checkout_requests (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.organization_checkout_requests enable row level security;

revoke all on table public.organization_checkout_requests from public;
revoke all on table public.organization_checkout_requests from anon;
revoke all on table public.organization_checkout_requests from authenticated;

grant all on table public.organization_checkout_requests to service_role;

-- ============================================================
-- WEBHOOK EVENT INBOX
-- Stripe event ID is the idempotency boundary.
-- The same event can safely be delivered more than once.
-- ============================================================

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_api_version text,
  livemode boolean,
  stripe_created_at timestamp with time zone,
  payload jsonb not null,
  processing_status text not null default 'received'
    check (
      processing_status in (
        'received',
        'processing',
        'processed',
        'ignored',
        'failed'
      )
    ),
  processing_attempts integer not null default 0
    check (processing_attempts >= 0),
  last_error text,
  received_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

create index if not exists stripe_webhook_events_status_index
  on public.stripe_webhook_events (
    processing_status,
    received_at
  );

create index if not exists stripe_webhook_events_type_index
  on public.stripe_webhook_events (
    event_type,
    received_at desc
  );

alter table public.stripe_webhook_events enable row level security;

revoke all on table public.stripe_webhook_events from public;
revoke all on table public.stripe_webhook_events from anon;
revoke all on table public.stripe_webhook_events from authenticated;

grant all on table public.stripe_webhook_events to service_role;

-- ============================================================
-- ORGANIZATION BILLING AUDIT LOG
-- Records entitlement changes separately from Stripe's raw event.
-- ============================================================

create table if not exists public.organization_billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid
    references public.organizations (id)
    on delete set null,
  actor_user_id uuid
    references auth.users (id)
    on delete set null,
  stripe_event_id text
    references public.stripe_webhook_events (stripe_event_id)
    on delete set null,
  event_type text not null,
  previous_plan_key text,
  new_plan_key text,
  previous_subscription_status text,
  new_subscription_status text,
  previous_paid_seat_count integer,
  new_paid_seat_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists organization_billing_events_org_index
  on public.organization_billing_events (
    organization_id,
    created_at desc
  );

create index if not exists organization_billing_events_stripe_event_index
  on public.organization_billing_events (stripe_event_id)
  where stripe_event_id is not null;

alter table public.organization_billing_events enable row level security;

revoke all on table public.organization_billing_events from public;
revoke all on table public.organization_billing_events from anon;
revoke all on table public.organization_billing_events from authenticated;

grant all on table public.organization_billing_events to service_role;

commit;
