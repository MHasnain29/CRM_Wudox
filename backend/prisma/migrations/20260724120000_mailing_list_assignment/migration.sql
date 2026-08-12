-- Mailing list assignment (multi-assignee) + archiving

ALTER TABLE "mailing_lists" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mailing_lists" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "mailing_list_assignments" (
  "id"             TEXT NOT NULL,
  "list_id"        TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "assigned_by_id" TEXT NOT NULL,
  "assigned_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailing_list_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mailing_list_assignments_list_id_user_id_key" ON "mailing_list_assignments"("list_id", "user_id");
CREATE INDEX IF NOT EXISTS "mailing_list_assignments_list_id_idx" ON "mailing_list_assignments"("list_id");
CREATE INDEX IF NOT EXISTS "mailing_list_assignments_user_id_idx" ON "mailing_list_assignments"("user_id");

DO $$ BEGIN
  ALTER TABLE "mailing_list_assignments" ADD CONSTRAINT "mailing_list_assignments_list_id_fkey"
    FOREIGN KEY ("list_id") REFERENCES "mailing_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mailing_list_assignments" ADD CONSTRAINT "mailing_list_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mailing_list_assignments" ADD CONSTRAINT "mailing_list_assignments_assigned_by_id_fkey"
    FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
