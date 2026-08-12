-- Client Notes: add visibility + sharedWith (mirrors the Remark model).
-- Backfills existing rows: is_public=true → 'public', else → 'only_me'.
-- v1.0.8 — enables "shared with selected users" alongside public / only_me.

ALTER TABLE "client_notes"
  ADD COLUMN "visibility" VARCHAR(16) NOT NULL DEFAULT 'only_me',
  ADD COLUMN "shared_with" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "client_notes" SET "visibility" = 'public'   WHERE "is_public" = true;
UPDATE "client_notes" SET "visibility" = 'only_me'  WHERE "is_public" = false;

CREATE INDEX "client_notes_visibility_sub_idx" ON "client_notes" ("visibility", "sub_company_id");
