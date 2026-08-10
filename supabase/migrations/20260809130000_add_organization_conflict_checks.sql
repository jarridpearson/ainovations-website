-- Phase 1 (Conflict Detection): results table for portal-triggered
-- organization conflict checks. Two modes:
--   'batch' -- each person in side_a checked against only their own
--             active priorities (1 credit/person, side_b always empty).
--   'deep'  -- side_a compared against side_b (or against itself when
--             side_b is empty) across people (1 credit/person, charged
--             on real headcount on both sides, summed).
-- Mirrors organization_ai_questions: service-role writes only, single
-- authorized-read RLS policy for the portal.

CREATE TABLE IF NOT EXISTS "public"."organization_conflict_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "organization_id" "uuid" NOT NULL REFERENCES "public"."organizations"("id"),
    "requested_by_user_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "mode" "text" NOT NULL,
    "side_a_user_ids" "uuid"[] NOT NULL DEFAULT '{}',
    "side_b_user_ids" "uuid"[] NOT NULL DEFAULT '{}',
    "status" "text" NOT NULL DEFAULT 'pending',
    "credit_status" "text",
    "credits_used" integer,
    "result_json" "jsonb",
    "error_message" "text",
    "model_used" "text",
    "prompt_tokens" integer,
    "completion_tokens" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "organization_conflict_checks_mode_check"
      CHECK (("mode" = ANY (ARRAY['batch'::"text", 'deep'::"text"]))),
    CONSTRAINT "organization_conflict_checks_status_check"
      CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "organization_conflict_checks_org_requester_request_unique"
      UNIQUE ("organization_id", "requested_by_user_id", "request_id")
);

ALTER TABLE "public"."organization_conflict_checks" OWNER TO "postgres";

ALTER TABLE "public"."organization_conflict_checks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their authorized organization conflict checks"
  ON "public"."organization_conflict_checks"
  FOR SELECT
  USING (
    (( SELECT auth.uid()) IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM "public"."organization_users" organization_user
      WHERE organization_user.organization_id = organization_conflict_checks.organization_id
        AND organization_user.user_id = ( SELECT auth.uid())
        AND organization_user.is_active = true
        AND (
          COALESCE(organization_user.portal_access_enabled, false) = true
          OR COALESCE(organization_user.billing_access_enabled, false) = true
        )
    )
    AND (
      requested_by_user_id = ( SELECT auth.uid())
      OR EXISTS (
        SELECT 1
        FROM "public"."organization_users" organization_user
        WHERE organization_user.organization_id = organization_conflict_checks.organization_id
          AND organization_user.user_id = ( SELECT auth.uid())
          AND organization_user.is_active = true
          AND organization_user.role = ANY (ARRAY['organization_admin'::"text", 'user_admin'::"text", 'view_only'::"text"])
      )
    )
  );
