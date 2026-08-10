-- Second emergency restore for the same Phase 0 mistake as
-- 20260809140000_restore_organization_group_users.sql. A precise audit of
-- every live function body in production (not just this branch's stale
-- local migration files) turned up three more tables from the 27 "dead"
-- tables that are actually still referenced:
--   - usage_events: written by every credit consume/refund function
--     (consume_personal_app_credits, consume_organization_app_credits,
--     consume_organization_portal_credits, and their refund counterparts)
--     and read by get_organization_usage_report. Every AI credit charge
--     anywhere in the product (mobile and portal) has been failing since
--     the Phase 0 drop.
--   - organization_group_admins: read by get_organization_visible_groups,
--     get_organization_visible_user_ids, update_organization_user.
--   - organization_billing_events: written by
--     sync_organization_app_pool_recurring_addons and
--     sync_organization_portal_recurring_addons.
-- Data restored separately from the pre-drop export
-- (scratchpad/dead_table_exports_20260809_105015/).
--
-- organization_billing_events originally had a foreign key to
-- stripe_webhook_events(stripe_event_id). stripe_webhook_events itself
-- has zero live function references (confirmed via the same audit) and
-- stays dropped -- stripe_event_id here is kept as a plain text column
-- with no FK, since the FK was never load-bearing for the insert paths
-- that use this table.

CREATE TABLE IF NOT EXISTS "public"."usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "group_id" "uuid",
    "event_type" "text" NOT NULL,
    "feature_key" "text" NOT NULL,
    "route" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE "public"."usage_events" OWNER TO "postgres";

ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id");

ALTER TABLE "public"."usage_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."usage_events" TO "anon";
GRANT ALL ON TABLE "public"."usage_events" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_events" TO "service_role";


CREATE TABLE IF NOT EXISTS "public"."organization_group_admins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "admin_role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_group_admins_admin_role_check" CHECK (("admin_role" = ANY (ARRAY['group_admin'::"text", 'manager'::"text"])))
);

ALTER TABLE "public"."organization_group_admins" OWNER TO "postgres";

ALTER TABLE ONLY "public"."organization_group_admins"
    ADD CONSTRAINT "organization_group_admins_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_group_admins_group_idx" ON "public"."organization_group_admins" USING "btree" ("group_id");
CREATE INDEX "organization_group_admins_org_idx" ON "public"."organization_group_admins" USING "btree" ("organization_id");
CREATE UNIQUE INDEX "organization_group_admins_unique_idx" ON "public"."organization_group_admins" USING "btree" ("organization_id", "group_id", "user_id", "admin_role");
CREATE INDEX "organization_group_admins_user_idx" ON "public"."organization_group_admins" USING "btree" ("user_id");

ALTER TABLE ONLY "public"."organization_group_admins"
    ADD CONSTRAINT "organization_group_admins_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_group_admins"
    ADD CONSTRAINT "organization_group_admins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_group_admins"
    ADD CONSTRAINT "organization_group_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."organization_group_admins" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."organization_group_admins" TO "anon";
GRANT ALL ON TABLE "public"."organization_group_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_group_admins" TO "service_role";


CREATE TABLE IF NOT EXISTS "public"."organization_billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "actor_user_id" "uuid",
    "stripe_event_id" "text",
    "event_type" "text" NOT NULL,
    "previous_plan_key" "text",
    "new_plan_key" "text",
    "previous_subscription_status" "text",
    "new_subscription_status" "text",
    "previous_paid_seat_count" integer,
    "new_paid_seat_count" integer,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."organization_billing_events" OWNER TO "postgres";

ALTER TABLE ONLY "public"."organization_billing_events"
    ADD CONSTRAINT "organization_billing_events_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_billing_events_org_index" ON "public"."organization_billing_events" USING "btree" ("organization_id", "created_at" DESC);
CREATE INDEX "organization_billing_events_stripe_event_index" ON "public"."organization_billing_events" USING "btree" ("stripe_event_id") WHERE ("stripe_event_id" IS NOT NULL);

ALTER TABLE ONLY "public"."organization_billing_events"
    ADD CONSTRAINT "organization_billing_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."organization_billing_events"
    ADD CONSTRAINT "organization_billing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;

ALTER TABLE "public"."organization_billing_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."organization_billing_events" TO "service_role";
