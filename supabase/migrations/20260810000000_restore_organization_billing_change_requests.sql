-- Third table wrongly dropped in the Phase 0 cleanup on 20260809110000.
-- Found this time via a real, live 500 error: manage-organization-billing
-- (get_state, update_seats/update_addon change-request recording, and
-- schedule-cancellation removal) all read/write this table directly, at
-- three separate .from("organization_billing_change_requests") call
-- sites. My earlier precise grep audit somehow did not catch this file
-- at the time it ran -- this table's calls were confirmed present in the
-- file when this incident was investigated. Restoring exact original
-- shape + data from the pre-drop export
-- (scratchpad/dead_table_exports_20260809_105015/organization_billing_change_requests.json,
-- 14 rows).

CREATE TABLE IF NOT EXISTS "public"."organization_billing_change_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "requested_by_user_id" "uuid",
    "change_type" "text" NOT NULL,
    "change_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "current_plan_key" "text",
    "requested_plan_key" "text",
    "current_billing_interval" "text",
    "requested_billing_interval" "text",
    "current_seat_quantity" integer,
    "requested_seat_quantity" integer,
    "current_addon_quantity" integer,
    "requested_addon_quantity" integer,
    "effective_at" timestamp with time zone,
    "applied_at" timestamp with time zone,
    "canceled_at" timestamp with time zone,
    "stripe_subscription_id" "text",
    "stripe_subscription_item_id" "text",
    "stripe_schedule_id" "text",
    "stripe_invoice_id" "text",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_billing_change_requests_change_status_check" CHECK (("change_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'scheduled'::"text", 'applied'::"text", 'canceled'::"text", 'failed'::"text"]))),
    CONSTRAINT "organization_billing_change_requests_change_type_check" CHECK (("change_type" = ANY (ARRAY['plan_change'::"text", 'seat_increase'::"text", 'seat_decrease'::"text", 'portal_credit_change'::"text", 'app_credit_change'::"text", 'subscription_cancellation'::"text"])))
);

ALTER TABLE "public"."organization_billing_change_requests" OWNER TO "postgres";

COMMENT ON TABLE "public"."organization_billing_change_requests" IS 'Tracks immediate and scheduled Stripe organization subscription changes, including annual plan and seat changes and recurring AI credit add-ons.';

ALTER TABLE ONLY "public"."organization_billing_change_requests"
    ADD CONSTRAINT "organization_billing_change_requests_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_billing_change_requests_organization_index" ON "public"."organization_billing_change_requests" USING "btree" ("organization_id", "change_status", "effective_at");

ALTER TABLE ONLY "public"."organization_billing_change_requests"
    ADD CONSTRAINT "organization_billing_change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_billing_change_requests"
    ADD CONSTRAINT "organization_billing_change_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."organization_billing_change_requests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."organization_billing_change_requests" TO "service_role";
