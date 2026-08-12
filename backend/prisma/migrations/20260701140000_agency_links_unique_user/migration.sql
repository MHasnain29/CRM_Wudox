-- Enforce that each user belongs to at most one link group (prevents race-condition duplicate groups)
-- Drops the now-redundant userId index (covered by the unique constraint)
DROP INDEX IF EXISTS "user_agency_links_user_id_idx";
CREATE UNIQUE INDEX "user_agency_links_user_id_key" ON "user_agency_links"("user_id");
