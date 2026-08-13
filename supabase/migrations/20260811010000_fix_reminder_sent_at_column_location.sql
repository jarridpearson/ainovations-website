-- reminder_sent_at needs to track state on decisions that have NOT been
-- checked in on yet (that's when a reminder job needs to know whether it
-- already sent a push). It was placed on decision_calibration_checkins,
-- but that table only has rows AFTER a check-in exists. Moving it.

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

ALTER TABLE public.decision_calibration_checkins
  DROP COLUMN IF EXISTS reminder_sent_at;
