-- Employee Offboarding: new fields + audit log table

-- canActAsAdmin flag on users (Super Admin grants per-user)
ALTER TABLE "users" ADD COLUMN "can_act_as_admin" BOOLEAN NOT NULL DEFAULT false;

-- "Forwarded from" tracking on reassignable items
ALTER TABLE "clients"  ADD COLUMN "forwarded_from_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "leads"    ADD COLUMN "forwarded_from_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "tasks"    ADD COLUMN "forwarded_from_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "meetings" ADD COLUMN "forwarded_from_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;

-- Email forwarding (recipient + source)
ALTER TABLE "emails" ADD COLUMN "forwarded_to_user_id"   TEXT REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "emails" ADD COLUMN "forwarded_from_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL;

-- Indexes for the forwarded queries
CREATE INDEX "emails_forwarded_to_user_id_idx"     ON "emails"("forwarded_to_user_id");
CREATE INDEX "emails_forwarded_from_user_id_idx"   ON "emails"("forwarded_from_user_id");
CREATE INDEX "leads_forwarded_from_user_id_idx"    ON "leads"("forwarded_from_user_id");
CREATE INDEX "tasks_forwarded_from_user_id_idx"    ON "tasks"("forwarded_from_user_id");
CREATE INDEX "meetings_forwarded_from_user_id_idx" ON "meetings"("forwarded_from_user_id");

-- Audit log for every offboarding commit
CREATE TABLE "offboarding_logs" (
    "id"                TEXT NOT NULL,
    "departing_user_id" TEXT NOT NULL,
    "admin_id"          TEXT NOT NULL,
    "sub_company_id"    TEXT NOT NULL,
    "payload"           JSONB NOT NULL,
    "summary"           JSONB NOT NULL,
    "committed_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "offboarding_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offboarding_logs_departing_user_fkey"
        FOREIGN KEY ("departing_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
    CONSTRAINT "offboarding_logs_admin_fkey"
        FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT,
    CONSTRAINT "offboarding_logs_sub_company_fkey"
        FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE
);

CREATE INDEX "offboarding_logs_departing_user_id_idx" ON "offboarding_logs"("departing_user_id");
CREATE INDEX "offboarding_logs_admin_id_idx"          ON "offboarding_logs"("admin_id");
CREATE INDEX "offboarding_logs_sub_company_id_idx"    ON "offboarding_logs"("sub_company_id");
CREATE INDEX "offboarding_logs_committed_at_idx"      ON "offboarding_logs"("committed_at");
