-- Emergency restore: organization_group_users was incorrectly dropped as
-- part of the Phase 0 dead-table cleanup (20260809110000). It is NOT dead
-- -- get_organization_user_directory and several other live functions
-- (visible in the production schema, not present in this branch's local
-- migration history) join against it directly. Dropping it broke the
-- organization user directory for every real organization: Users, Groups,
-- Reports, Analyze Company Data, AI Usage, and Decision Intelligence all
-- depend on it. Restoring the exact original shape from the baseline
-- migration. Data is restored separately from the pre-drop export
-- (scratchpad/dead_table_exports_20260809_105015/organization_group_users.json).

CREATE TABLE IF NOT EXISTS "public"."organization_group_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."organization_group_users" OWNER TO "postgres";

ALTER TABLE ONLY "public"."organization_group_users"
    ADD CONSTRAINT "organization_group_users_pkey" PRIMARY KEY ("id");

CREATE INDEX "organization_group_users_group_idx" ON "public"."organization_group_users" USING "btree" ("group_id");
CREATE INDEX "organization_group_users_org_idx" ON "public"."organization_group_users" USING "btree" ("organization_id");
CREATE UNIQUE INDEX "organization_group_users_unique_idx" ON "public"."organization_group_users" USING "btree" ("organization_id", "group_id", "user_id");
CREATE INDEX "organization_group_users_user_idx" ON "public"."organization_group_users" USING "btree" ("user_id");

ALTER TABLE ONLY "public"."organization_group_users"
    ADD CONSTRAINT "organization_group_users_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."organization_groups"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_group_users"
    ADD CONSTRAINT "organization_group_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."organization_group_users"
    ADD CONSTRAINT "organization_group_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."organization_group_users" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."organization_group_users" TO "anon";
GRANT ALL ON TABLE "public"."organization_group_users" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_group_users" TO "service_role";
