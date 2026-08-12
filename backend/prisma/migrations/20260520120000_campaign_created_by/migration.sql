-- AlterTable: add created_by_id to email_campaigns
ALTER TABLE "email_campaigns" ADD COLUMN "created_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
