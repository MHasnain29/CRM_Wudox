-- Add human-friendly unique alphanumeric job code
ALTER TABLE "jobs" ADD COLUMN "job_code" TEXT;

-- Backfill existing rows with unique alphanumeric codes (JOB-XXXXXX)
UPDATE "jobs"
SET "job_code" = 'JOB-' || UPPER(SUBSTR(MD5(random()::text || "id"::text), 1, 6))
WHERE "job_code" IS NULL;

-- Enforce uniqueness
CREATE UNIQUE INDEX "jobs_job_code_key" ON "jobs"("job_code");
