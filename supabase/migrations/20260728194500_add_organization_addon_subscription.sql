alter table public.organizations
  add column if not exists stripe_addon_subscription_id text;

create unique index if not exists organizations_stripe_addon_subscription_id_key
  on public.organizations (stripe_addon_subscription_id)
  where stripe_addon_subscription_id is not null;

comment on column public.organizations.stripe_addon_subscription_id is
  'Separate monthly Stripe subscription used for recurring organization portal and shared mobile-app AI credit add-ons.';
