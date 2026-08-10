-- Corrected dead-table audit (the previous grep-based audit used a
-- backreference pattern that BSD/macOS grep -E silently fails to match,
-- producing false "clean" results all session). A Python re-based re-scan
-- of every .ts/.tsx file in this worktree found 5 more of the original 27
-- "dead" tables that are actually still live-referenced in production
-- edge functions:
--   - organization_checkout_requests: create-organization-signup,
--     create-organization-checkout, stripe-organization-webhook
--   - organization_knowledge_events: prepare/process/delete/ask
--     organization-knowledge-document flow
--   - stripe_billing_prices: manage-organization-billing,
--     stripe-organization-webhook, create-organization-checkout
--   - stripe_webhook_events: stripe-organization-webhook (idempotency)
--   - organization_ai_question_sources: ask-organization-data
--
-- All 5 confirmed absent from production via information_schema.tables
-- before writing this migration. Restoring exact original shape from the
-- pre-drop baseline; data restored separately from
-- scratchpad/dead_table_exports_20260809_105015/<table>.json.

CREATE TABLE IF NOT EXISTS "public"."organization_checkout_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "requested_by_user_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "plan_key" "text" NOT NULL,
    "billing_interval" "text" NOT NULL,
    "seat_quantity" integer NOT NULL,
    "stripe_checkout_session_id" "text",
    "stripe_checkout_url" "text",
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "portal_credit_addon_product_key" "text",
    "app_credit_addon_product_key" "text",
    CONSTRAINT "organization_checkout_requests_billing_interval_check" CHECK (("billing_interval" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "organization_checkout_requests_request_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'created'::"text", 'completed'::"text", 'expired'::"text", 'failed'::"text"]))),
    CONSTRAINT "organization_checkout_requests_seat_quantity_check" CHECK (("seat_quantity" >= 1))
);

ALTER TABLE "public"."organization_checkout_requests" OWNER TO "postgres";

COMMENT ON COLUMN "public"."organization_checkout_requests"."portal_credit_addon_product_key" IS 'Selected active portal AI credit product key. Validated against organization_billing_products by the checkout function.';

COMMENT ON COLUMN "public"."organization_checkout_requests"."app_credit_addon_product_key" IS 'Selected active shared mobile-app AI credit product key. Validated against organization_billing_products by the checkout function.';

ALTER TABLE ONLY "public"."organization_checkout_requests"
    ADD CONSTRAINT "organization_checkout_request_organization_id_requested_by__key" UNIQUE ("organization_id", "requested_by_user_id", "request_id");

ALTER TABLE ONLY "public"."organization_checkout_requests"
    ADD CONSTRAINT "organization_checkout_requests_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_checkout_requests_org_index" ON "public"."organization_checkout_requests" USING "btree" ("organization_id", "created_at" DESC);

CREATE UNIQUE INDEX "organization_checkout_session_unique" ON "public"."organization_checkout_requests" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);

ALTER TABLE ONLY "public"."organization_checkout_requests"
    ADD CONSTRAINT "organization_checkout_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_checkout_requests"
    ADD CONSTRAINT "organization_checkout_requests_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "public"."subscription_plans"("plan_key") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."organization_checkout_requests"
    ADD CONSTRAINT "organization_checkout_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE "public"."organization_checkout_requests" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."organization_checkout_requests" TO "service_role";


CREATE TABLE IF NOT EXISTS "public"."organization_knowledge_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "document_id" "uuid",
    "question_id" "uuid",
    "event_type" "text" NOT NULL,
    "event_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_knowledge_events_metadata_check" CHECK (("jsonb_typeof"("event_metadata") = 'object'::"text")),
    CONSTRAINT "organization_knowledge_events_type_check" CHECK (("event_type" = ANY (ARRAY['knowledge_base_created'::"text", 'knowledge_base_failed'::"text", 'document_upload_prepared'::"text", 'document_uploaded'::"text", 'document_processing_started'::"text", 'document_ready'::"text", 'document_failed'::"text", 'document_deleted'::"text", 'question_started'::"text", 'question_completed'::"text", 'question_failed'::"text", 'question_credit_charged'::"text", 'question_credit_refunded'::"text"])))
);

ALTER TABLE "public"."organization_knowledge_events" OWNER TO "postgres";

ALTER TABLE ONLY "public"."organization_knowledge_events"
    ADD CONSTRAINT "organization_knowledge_events_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_knowledge_events_document_idx" ON "public"."organization_knowledge_events" USING "btree" ("document_id", "created_at" DESC) WHERE ("document_id" IS NOT NULL);

CREATE INDEX "organization_knowledge_events_organization_idx" ON "public"."organization_knowledge_events" USING "btree" ("organization_id", "created_at" DESC);

CREATE INDEX "organization_knowledge_events_question_idx" ON "public"."organization_knowledge_events" USING "btree" ("question_id", "created_at" DESC) WHERE ("question_id" IS NOT NULL);

ALTER TABLE ONLY "public"."organization_knowledge_events"
    ADD CONSTRAINT "organization_knowledge_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."organization_knowledge_events"
    ADD CONSTRAINT "organization_knowledge_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."organization_knowledge_documents"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."organization_knowledge_events"
    ADD CONSTRAINT "organization_knowledge_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_knowledge_events"
    ADD CONSTRAINT "organization_knowledge_events_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."organization_knowledge_questions"("id") ON DELETE SET NULL;

ALTER TABLE "public"."organization_knowledge_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_knowledge_events_admin_select" ON "public"."organization_knowledge_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_users" "organization_user"
  WHERE (("organization_user"."organization_id" = "organization_knowledge_events"."organization_id") AND ("organization_user"."user_id" = "auth"."uid"()) AND ("organization_user"."is_active" = true) AND ("organization_user"."role" = ANY (ARRAY['organization_admin'::"text", 'user_admin'::"text"]))))));

GRANT ALL ON TABLE "public"."organization_knowledge_events" TO "anon";
GRANT ALL ON TABLE "public"."organization_knowledge_events" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_knowledge_events" TO "service_role";


CREATE TABLE IF NOT EXISTS "public"."stripe_billing_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_key" "text" NOT NULL,
    "component_key" "text" NOT NULL,
    "billing_interval" "text" NOT NULL,
    "stripe_product_id" "text",
    "stripe_price_id" "text" NOT NULL,
    "unit_amount_cents" integer,
    "credits_per_unit" integer,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "billing_product_key" "text",
    CONSTRAINT "stripe_billing_prices_billing_interval_check" CHECK (("billing_interval" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "stripe_billing_prices_component_key_check" CHECK (("component_key" = ANY (ARRAY['portal_base'::"text", 'user_seat'::"text", 'portal_credit_addon'::"text", 'user_credit_addon'::"text"]))),
    CONSTRAINT "stripe_billing_prices_credits_per_unit_check" CHECK ((("credits_per_unit" IS NULL) OR ("credits_per_unit" > 0))),
    CONSTRAINT "stripe_billing_prices_unit_amount_cents_check" CHECK ((("unit_amount_cents" IS NULL) OR ("unit_amount_cents" >= 0)))
);

ALTER TABLE "public"."stripe_billing_prices" OWNER TO "postgres";

ALTER TABLE ONLY "public"."stripe_billing_prices"
    ADD CONSTRAINT "stripe_billing_prices_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."stripe_billing_prices"
    ADD CONSTRAINT "stripe_billing_prices_stripe_price_id_key" UNIQUE ("stripe_price_id");

CREATE UNIQUE INDEX "stripe_billing_prices_base_component_unique" ON "public"."stripe_billing_prices" USING "btree" ("plan_key", "component_key", "billing_interval") WHERE ("component_key" = ANY (ARRAY['portal_base'::"text", 'user_seat'::"text"]));

CREATE INDEX "stripe_billing_prices_lookup_index" ON "public"."stripe_billing_prices" USING "btree" ("plan_key", "billing_interval", "component_key", "active");

CREATE UNIQUE INDEX "stripe_billing_prices_product_key_interval_unique" ON "public"."stripe_billing_prices" USING "btree" ("billing_product_key", "billing_interval") WHERE ("billing_product_key" IS NOT NULL);

ALTER TABLE ONLY "public"."stripe_billing_prices"
    ADD CONSTRAINT "stripe_billing_prices_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "public"."subscription_plans"("plan_key") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "public"."stripe_billing_prices" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."stripe_billing_prices" TO "service_role";


CREATE TABLE IF NOT EXISTS "public"."stripe_webhook_events" (
    "stripe_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "stripe_api_version" "text",
    "livemode" boolean,
    "stripe_created_at" timestamp with time zone,
    "payload" "jsonb" NOT NULL,
    "processing_status" "text" DEFAULT 'received'::"text" NOT NULL,
    "processing_attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stripe_webhook_events_processing_attempts_check" CHECK (("processing_attempts" >= 0)),
    CONSTRAINT "stripe_webhook_events_processing_status_check" CHECK (("processing_status" = ANY (ARRAY['received'::"text", 'processing'::"text", 'processed'::"text", 'ignored'::"text", 'failed'::"text"])))
);

ALTER TABLE "public"."stripe_webhook_events" OWNER TO "postgres";

ALTER TABLE ONLY "public"."stripe_webhook_events"
    ADD CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("stripe_event_id");

CREATE INDEX "stripe_webhook_events_status_index" ON "public"."stripe_webhook_events" USING "btree" ("processing_status", "received_at");

CREATE INDEX "stripe_webhook_events_type_index" ON "public"."stripe_webhook_events" USING "btree" ("event_type", "received_at" DESC);

ALTER TABLE "public"."stripe_webhook_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."stripe_webhook_events" TO "service_role";

-- organization_billing_events.stripe_event_id was left as a plain text
-- column (no FK) when that table was restored on 20260809141500, since
-- stripe_webhook_events did not exist yet at that time. The original FK
-- is added back in a separate follow-up migration, after
-- stripe_webhook_events' pre-drop data is restored (adding it here, before
-- data restore, fails: organization_billing_events already has rows
-- pointing at stripe_event_ids that don't exist until that data is back).


CREATE TABLE IF NOT EXISTS "public"."organization_ai_question_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_record_id" "uuid",
    "source_label" "text" NOT NULL,
    "source_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_ai_question_sources_source_type_check" CHECK (("source_type" = ANY (ARRAY['organization'::"text", 'user'::"text", 'group'::"text", 'priority'::"text", 'decision'::"text", 'trackable'::"text", 'trackable_entry'::"text", 'decision_analysis'::"text", 'usage_summary'::"text"])))
);

ALTER TABLE "public"."organization_ai_question_sources" OWNER TO "postgres";

ALTER TABLE ONLY "public"."organization_ai_question_sources"
    ADD CONSTRAINT "organization_ai_question_sources_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_ai_question_sources_organization_idx" ON "public"."organization_ai_question_sources" USING "btree" ("organization_id");

CREATE INDEX "organization_ai_question_sources_question_idx" ON "public"."organization_ai_question_sources" USING "btree" ("question_id");

ALTER TABLE ONLY "public"."organization_ai_question_sources"
    ADD CONSTRAINT "organization_ai_question_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_ai_question_sources"
    ADD CONSTRAINT "organization_ai_question_sources_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."organization_ai_questions"("id") ON DELETE CASCADE;

CREATE POLICY "Users can view authorized organization AI question sources" ON "public"."organization_ai_question_sources" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."organization_ai_questions" "question"
  WHERE (("question"."id" = "organization_ai_question_sources"."question_id") AND ("question"."organization_id" = "organization_ai_question_sources"."organization_id") AND (("question"."asked_by_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."organization_users" "organization_user"
          WHERE (("organization_user"."organization_id" = "question"."organization_id") AND ("organization_user"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("organization_user"."is_active" = true) AND ("organization_user"."role" = ANY (ARRAY['organization_admin'::"text", 'user_admin'::"text", 'view_only'::"text"])))))))))));

ALTER TABLE "public"."organization_ai_question_sources" ENABLE ROW LEVEL SECURITY;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organization_ai_question_sources" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organization_ai_question_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_ai_question_sources" TO "service_role";
