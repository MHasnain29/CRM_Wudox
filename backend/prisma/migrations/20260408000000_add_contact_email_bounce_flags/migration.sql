-- AlterTable: add email bounce/invalid tracking fields to client_contacts
ALTER TABLE "client_contacts" ADD COLUMN "email_bounced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_contacts" ADD COLUMN "email_invalid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_contacts" ADD COLUMN "email_bounced_at" TIMESTAMP(3);
ALTER TABLE "client_contacts" ADD COLUMN "email_bounced_reason" TEXT;
