-- Add offboarding-in-progress timestamp to users
ALTER TABLE "users" ADD COLUMN "offboarding_started_at" TIMESTAMP(3);

-- Index for fast lookup of in-progress offboarding users
CREATE INDEX "users_offboarding_started_at_idx" ON "users"("offboarding_started_at");
