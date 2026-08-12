-- CreateEnum
CREATE TYPE "ActiveClientStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "PlacementEndReason" AS ENUM ('work_complete', 'not_performing', 'other');

-- CreateTable
CREATE TABLE "active_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "status" "ActiveClientStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "sub_company_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "active_clients_pkey" PRIMARY KEY ("id")
);

-- AlterTable jobs
ALTER TABLE "jobs" ADD COLUMN "sub_company_id" TEXT,
ADD COLUMN "active_client_id" TEXT,
ADD COLUMN "screening_criteria" JSONB,
ADD COLUMN "shift_schedule" JSONB;

-- AlterTable employee_assignments
ALTER TABLE "employee_assignments" ADD COLUMN "active_client_id" TEXT,
ADD COLUMN "ended_at" TIMESTAMP(3),
ADD COLUMN "end_reason" "PlacementEndReason",
ADD COLUMN "end_notes" TEXT,
ADD COLUMN "rating" INTEGER;

-- AlterTable employees
ALTER TABLE "employees" ADD COLUMN "onboarding_pandadoc_id" TEXT,
ADD COLUMN "onboarding_pandadoc_status" TEXT,
ADD COLUMN "onboarding_pandadoc_updated_at" TIMESTAMP(3);

-- AlterTable proposal_type_template_mappings
ALTER TABLE "proposal_type_template_mappings" ADD COLUMN "employee_onboarding_template_id" TEXT,
ADD COLUMN "employee_onboarding_template_name" TEXT;

-- CreateIndex
CREATE INDEX "active_clients_sub_company_id_idx" ON "active_clients"("sub_company_id");
CREATE INDEX "active_clients_sub_company_id_status_idx" ON "active_clients"("sub_company_id", "status");
CREATE INDEX "active_clients_name_idx" ON "active_clients"("name");

CREATE INDEX "jobs_sub_company_id_idx" ON "jobs"("sub_company_id");
CREATE INDEX "jobs_active_client_id_idx" ON "jobs"("active_client_id");

CREATE INDEX "employee_assignments_active_client_id_idx" ON "employee_assignments"("active_client_id");
CREATE INDEX "employees_onboarding_pandadoc_id_idx" ON "employees"("onboarding_pandadoc_id");

-- AddForeignKey
ALTER TABLE "active_clients" ADD CONSTRAINT "active_clients_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "active_clients" ADD CONSTRAINT "active_clients_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_active_client_id_fkey" FOREIGN KEY ("active_client_id") REFERENCES "active_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_active_client_id_fkey" FOREIGN KEY ("active_client_id") REFERENCES "active_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
