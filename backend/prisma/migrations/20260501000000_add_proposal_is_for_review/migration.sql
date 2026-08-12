-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "is_for_review" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "proposals" ADD COLUMN "review_email_sent_at" TIMESTAMP(3);
