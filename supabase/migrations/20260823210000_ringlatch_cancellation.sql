-- Cancellation teardown support.
--
-- When a subscription ends, the account fully unwinds with no human involved:
-- the number is released, so the row can no longer hold it (NOT NULL drops),
-- and the forwarded number frees up so the same business can sign up again
-- later (unique indexes stop covering cancelled rows).

begin;

alter table public.ringlatch_clients
  alter column ringlatch_number drop not null;

alter table public.ringlatch_signups
  drop constraint if exists ringlatch_signups_status_check;

alter table public.ringlatch_signups
  add constraint ringlatch_signups_status_check check (
    status in (
      'pending',
      'paid',
      'provisioning',
      'provisioned',
      'failed',
      'abandoned',
      'cancelled'
    )
  );

drop index if exists ringlatch_signups_forwarding_paid_key;

create unique index if not exists ringlatch_signups_forwarding_paid_key
  on public.ringlatch_signups (forwarding_number)
  where status in ('paid', 'provisioning', 'provisioned', 'failed');

commit;
