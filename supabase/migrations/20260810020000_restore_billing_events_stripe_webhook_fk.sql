-- Follow-up to 20260810010000. organization_billing_events.stripe_event_id
-- was left FK-less when that table was restored on 20260809141500 (the
-- referenced stripe_webhook_events table didn't exist yet). Now that
-- stripe_webhook_events exists again with its full pre-drop data restored,
-- add the original FK back.

ALTER TABLE ONLY "public"."organization_billing_events"
    ADD CONSTRAINT "organization_billing_events_stripe_event_id_fkey" FOREIGN KEY ("stripe_event_id") REFERENCES "public"."stripe_webhook_events"("stripe_event_id") ON DELETE SET NULL;
