-- One Stripe identity maps to at most one client, same as one Ringlatch
-- number maps to at most one client (enforced since the first migration).
-- Without these, a shared stripe_customer_id could credit one account's
-- pack to another, or charge one card for another account's refill.
--
-- Deliberately NOT constrained: owner_cell. One owner legitimately runs two
-- businesses as two accounts with two numbers.

begin;

create unique index if not exists ringlatch_clients_stripe_customer_key
  on public.ringlatch_clients (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists ringlatch_clients_stripe_subscription_key
  on public.ringlatch_clients (stripe_subscription_id)
  where stripe_subscription_id is not null;

commit;
