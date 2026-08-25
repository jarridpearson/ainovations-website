-- Billing hardening after adversarial review.
--
--   - Track how much of each call was served from purchased packs, so the
--     degrade ladder (brief/closed) is measured against PLAN usage only.
--     Pack-served minutes must never push a client toward "closed".
--   - One auto-refill attempt per period, claimed atomically so two
--     concurrent call webhooks can never double-charge.
--   - A pack purchase credits at most once per Stripe event.

begin;

alter table public.ringlatch_calls
  add column if not exists purchased_seconds_drawn bigint not null default 0;

alter table public.ringlatch_clients
  add column if not exists refill_attempted_for_period date;

create unique index if not exists ringlatch_minute_purchases_event_key
  on public.ringlatch_minute_purchases (stripe_event_id)
  where stripe_event_id is not null;

-- Total and pack-drawn seconds for the period, in one round trip.
create or replace function public.ringlatch_period_usage(
  target_client_id uuid,
  period_start date
)
returns table (total_seconds bigint, drawn_seconds bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(billable_seconds), 0),
    coalesce(sum(purchased_seconds_drawn), 0)
  from public.ringlatch_calls
  where client_id = target_client_id
    and started_at >= period_start
    and started_at < (period_start + interval '1 month');
$$;

-- Atomic claim: exactly one webhook invocation per period may attempt the
-- auto-refill charge. Returns true only for the winner.
create or replace function public.ringlatch_claim_refill(
  target_client_id uuid,
  period_start date
)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  update public.ringlatch_clients
  set refill_attempted_for_period = period_start,
      updated_at = now()
  where id = target_client_id
    and (refill_attempted_for_period is distinct from period_start)
  returning true;
$$;

commit;
