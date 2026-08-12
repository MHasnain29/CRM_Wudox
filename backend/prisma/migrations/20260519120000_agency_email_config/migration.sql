-- AlterTable: add per-agency email configuration columns to sub_companies
ALTER TABLE "sub_companies"
  ADD COLUMN "email_from_address"      TEXT,
  ADD COLUMN "email_from_name"         TEXT,
  ADD COLUMN "email_send_as_domain"    TEXT,
  ADD COLUMN "email_inbound_domain"    TEXT,
  ADD COLUMN "email_inbound_localpart" TEXT;
