-- Job license requirement: jobs can require one or more valid employee licenses
ALTER TABLE "jobs" ADD COLUMN "license_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN "required_license_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
