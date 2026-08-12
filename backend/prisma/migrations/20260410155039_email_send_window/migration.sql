/*
  Warnings:

  - A unique constraint covering the columns `[dedupe_key]` on the table `outbound_email_queue` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "user_activity_sessions" DROP CONSTRAINT "user_activity_sessions_sub_company_id_fkey";

-- AlterTable
ALTER TABLE "email_campaigns" ALTER COLUMN "sub_company_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "email_send_window_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "mailing_lists" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outbound_email_queue" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "email_signatures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_signatures_user_id_idx" ON "email_signatures"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_email_queue_dedupe_key_key" ON "outbound_email_queue"("dedupe_key");

-- AddForeignKey
ALTER TABLE "email_signatures" ADD CONSTRAINT "email_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "outbound_email_queue_status_next_eligible_idx" RENAME TO "outbound_email_queue_status_next_eligible_at_idx";

-- RenameIndex
ALTER INDEX "outbound_email_queue_sub_company_status_idx" RENAME TO "outbound_email_queue_sub_company_id_status_idx";
