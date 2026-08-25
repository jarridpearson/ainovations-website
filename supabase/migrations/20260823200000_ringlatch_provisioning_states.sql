-- Auto-provisioning states. 'provisioning' is the atomic claim (exactly one
-- webhook invocation provisions a paid signup, even on Stripe retries);
-- 'failed' is the exception path that pages ops with the exact failed step.

begin;

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
      'abandoned'
    )
  );

-- A number is locked from the moment money moved through every later state.
drop index if exists ringlatch_signups_forwarding_paid_key;

create unique index if not exists ringlatch_signups_forwarding_paid_key
  on public.ringlatch_signups (forwarding_number)
  where status in ('paid', 'provisioning', 'provisioned', 'failed');

commit;
