begin;

-- ============================================================
-- INCLUDED ORGANIZATION PORTAL AI CREDITS
-- ============================================================

update public.subscription_plans
set included_admin_ai_credits_monthly = 100
where plan_key = 'organization_starter';

update public.subscription_plans
set included_admin_ai_credits_monthly = 300
where plan_key = 'organization_pro';

-- ============================================================
-- SUPPORT MULTIPLE PRODUCTS OF THE SAME COMPONENT TYPE
-- ============================================================

alter table public.stripe_billing_prices
  add column if not exists billing_product_key text;

alter table public.stripe_billing_prices
  drop constraint if exists
    stripe_billing_prices_plan_key_component_key_billing_interval_key;

create unique index if not exists
  stripe_billing_prices_product_key_interval_unique
on public.stripe_billing_prices (
  billing_product_key,
  billing_interval
)
where billing_product_key is not null;

-- Existing plan and seat mappings remain uniquely identified.
create unique index if not exists
  stripe_billing_prices_base_component_unique
on public.stripe_billing_prices (
  plan_key,
  component_key,
  billing_interval
)
where component_key in ('portal_base', 'user_seat');

-- ============================================================
-- SERVER-CONTROLLED BILLING PRODUCT CATALOG
-- Stripe IDs will be attached after the products are created.
-- ============================================================

create table if not exists public.organization_billing_products (
  product_key text primary key,
  product_name text not null,
  product_type text not null
    check (
      product_type in (
        'organization_plan',
        'user_seat',
        'portal_credit_addon'
      )
    ),
  billing_interval text not null
    check (billing_interval in ('monthly', 'annual')),
  unit_amount_cents integer not null
    check (unit_amount_cents >= 0),
  portal_credits_per_unit integer
    check (
      portal_credits_per_unit is null
      or portal_credits_per_unit > 0
    ),
  stripe_product_id text,
  stripe_price_id text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists
  organization_billing_products_stripe_price_unique
on public.organization_billing_products (stripe_price_id)
where stripe_price_id is not null;

create unique index if not exists
  organization_billing_products_stripe_product_unique
on public.organization_billing_products (stripe_product_id)
where stripe_product_id is not null;

alter table public.organization_billing_products
  enable row level security;

revoke all
on table public.organization_billing_products
from public, anon, authenticated;

grant all
on table public.organization_billing_products
to service_role;

insert into public.organization_billing_products (
  product_key,
  product_name,
  product_type,
  billing_interval,
  unit_amount_cents,
  portal_credits_per_unit,
  active
)
values
  (
    'organization_portal_ai_credits_50_monthly',
    '50 Organization Portal AI Credits',
    'portal_credit_addon',
    'monthly',
    299,
    50,
    true
  ),
  (
    'organization_portal_ai_credits_100_monthly',
    '100 Organization Portal AI Credits',
    'portal_credit_addon',
    'monthly',
    499,
    100,
    true
  ),
  (
    'organization_portal_ai_credits_250_monthly',
    '250 Organization Portal AI Credits',
    'portal_credit_addon',
    'monthly',
    1299,
    250,
    true
  )
on conflict (product_key)
do update set
  product_name = excluded.product_name,
  product_type = excluded.product_type,
  billing_interval = excluded.billing_interval,
  unit_amount_cents = excluded.unit_amount_cents,
  portal_credits_per_unit = excluded.portal_credits_per_unit,
  active = excluded.active,
  updated_at = now();

commit;
