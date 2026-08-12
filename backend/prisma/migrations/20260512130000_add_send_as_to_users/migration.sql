-- Add per-user sender identity columns.
-- send_as_email: optional override; null → use users.email
-- send_as_disabled: per-user kill-switch to fall back to universal sender
ALTER TABLE "users"
  ADD COLUMN "send_as_email" TEXT,
  ADD COLUMN "send_as_disabled" BOOLEAN NOT NULL DEFAULT false;
