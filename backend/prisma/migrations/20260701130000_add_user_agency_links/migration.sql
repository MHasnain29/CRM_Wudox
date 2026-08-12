-- CreateTable: user_agency_links
-- Supports multi-agency linked accounts. groupId clusters 2+ user accounts across agencies.
CREATE TABLE "user_agency_links" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "user_agency_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_agency_links_group_id_user_id_key" ON "user_agency_links"("group_id", "user_id");

-- CreateIndex
CREATE INDEX "user_agency_links_user_id_idx" ON "user_agency_links"("user_id");

-- CreateIndex
CREATE INDEX "user_agency_links_group_id_idx" ON "user_agency_links"("group_id");

-- AddForeignKey
ALTER TABLE "user_agency_links" ADD CONSTRAINT "user_agency_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
