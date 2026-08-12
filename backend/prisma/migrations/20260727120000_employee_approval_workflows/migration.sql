-- AlterEnum ApprovalWorkflowType
ALTER TYPE "ApprovalWorkflowType" ADD VALUE 'employee_add';
ALTER TYPE "ApprovalWorkflowType" ADD VALUE 'employee_assignment';

-- AlterEnum DocumentType
ALTER TYPE "DocumentType" ADD VALUE 'agreement';

-- CreateEnum
CREATE TYPE "EmployeeAssignmentTargetType" AS ENUM ('client', 'job');

-- CreateEnum
CREATE TYPE "EmployeeAssignmentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable employees: approval chain fields
ALTER TABLE "employees" ADD COLUMN "submitter_role" TEXT;
ALTER TABLE "employees" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- CreateTable employee_assignments
CREATE TABLE "employee_assignments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "target_type" "EmployeeAssignmentTargetType" NOT NULL,
    "client_id" TEXT,
    "job_id" TEXT,
    "status" "EmployeeAssignmentStatus" NOT NULL DEFAULT 'pending',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "submitted_by_id" TEXT NOT NULL,
    "submitter_role" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "approval_chain" JSONB NOT NULL DEFAULT '[]',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_assignments_employee_id_idx" ON "employee_assignments"("employee_id");
CREATE INDEX "employee_assignments_status_idx" ON "employee_assignments"("status");
CREATE INDEX "employee_assignments_client_id_idx" ON "employee_assignments"("client_id");
CREATE INDEX "employee_assignments_job_id_idx" ON "employee_assignments"("job_id");
CREATE INDEX "employee_assignments_is_active_idx" ON "employee_assignments"("is_active");

-- AddForeignKey
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_assignments" ADD CONSTRAINT "employee_assignments_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
