-- AlterTable: add nullable createdById to mailing_lists
ALTER TABLE "mailing_lists" ADD COLUMN "created_by_id" TEXT;

-- CreateIndex
CREATE INDEX "mailing_lists_created_by_id_idx" ON "mailing_lists"("created_by_id");

-- AddForeignKey
ALTER TABLE "mailing_lists" ADD CONSTRAINT "mailing_lists_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
