-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "pandadoc_id" TEXT;
ALTER TABLE "proposals" ADD COLUMN "pandadoc_status" TEXT;
ALTER TABLE "proposals" ADD COLUMN "pandadoc_updated_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "proposals_pandadoc_id_idx" ON "proposals"("pandadoc_id");
