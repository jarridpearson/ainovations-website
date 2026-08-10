-- Found via a live browser test right after restoring
-- organization_ai_question_sources (20260810010000): ask-organization-data
-- writes source_type 'portal_view' and 'authorized_scope', but the CHECK
-- constraint restored from the pre-drop baseline only allowed an older,
-- unrelated set of values ('organization', 'user', 'group', 'priority',
-- 'decision', 'trackable', 'trackable_entry', 'decision_analysis',
-- 'usage_summary') that nothing in the current codebase writes. Every
-- insert into this table has been failing this whole time -- silently,
-- since the function only logs the error and still returns the AI answer
-- successfully. Confirmed grep across supabase/functions: 'portal_view' and
-- 'authorized_scope' are the only two values ever written, by
-- ask-organization-data alone; nothing in the portal frontend reads this
-- table (write-only audit trail). Correcting the constraint to match
-- actual usage instead of the stale baseline.

ALTER TABLE "public"."organization_ai_question_sources"
    DROP CONSTRAINT "organization_ai_question_sources_source_type_check";

ALTER TABLE "public"."organization_ai_question_sources"
    ADD CONSTRAINT "organization_ai_question_sources_source_type_check"
    CHECK (("source_type" = ANY (ARRAY['portal_view'::"text", 'authorized_scope'::"text"])));
