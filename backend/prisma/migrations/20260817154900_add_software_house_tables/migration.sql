-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'on_hold', 'done');

-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('member', 'lead');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterEnum
ALTER TYPE "ProposalDocumentCategory" ADD VALUE 'generated_for_review';

-- DropForeignKey
ALTER TABLE "calls" DROP CONSTRAINT "calls_client_id_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_forwarded_from_user_id_fkey";

-- DropForeignKey
ALTER TABLE "emails" DROP CONSTRAINT "emails_forwarded_from_user_id_fkey";

-- DropForeignKey
ALTER TABLE "emails" DROP CONSTRAINT "emails_forwarded_to_user_id_fkey";

-- DropForeignKey
ALTER TABLE "follow_ups" DROP CONSTRAINT "follow_ups_client_id_fkey";

-- DropForeignKey
ALTER TABLE "follow_ups" DROP CONSTRAINT "follow_ups_forwarded_from_user_id_fkey";

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_forwarded_from_user_id_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_forwarded_from_user_id_fkey";

-- DropForeignKey
ALTER TABLE "offboarding_logs" DROP CONSTRAINT "offboarding_logs_admin_fkey";

-- DropForeignKey
ALTER TABLE "offboarding_logs" DROP CONSTRAINT "offboarding_logs_departing_user_fkey";

-- DropForeignKey
ALTER TABLE "offboarding_logs" DROP CONSTRAINT "offboarding_logs_sub_company_fkey";

-- DropForeignKey
ALTER TABLE "signing_authorities" DROP CONSTRAINT "signing_authorities_sub_company_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_forwarded_from_user_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_sub_company_id_fkey";

-- DropIndex
DROP INDEX "emails_forwarded_from_user_id_idx";

-- DropIndex
DROP INDEX "emails_forwarded_to_user_id_idx";

-- DropIndex
DROP INDEX "idx_follow_ups_forwarded_from";

-- DropIndex
DROP INDEX "leads_forwarded_from_user_id_idx";

-- DropIndex
DROP INDEX "meetings_forwarded_from_user_id_idx";

-- DropIndex
DROP INDEX "phone_numbers_e164_idx";

-- DropIndex
DROP INDEX "remarks_shared_with_idx";

-- DropIndex
DROP INDEX "tasks_forwarded_from_user_id_idx";

-- AlterTable
ALTER TABLE "offboarding_logs" ALTER COLUMN "committed_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "org_approval_policies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "signing_authorities" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "project_id" TEXT;

-- AlterTable
ALTER TABLE "user_agency_links" ALTER COLUMN "color" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "owner_id" TEXT NOT NULL,
    "sub_company_id" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ProjectMemberRole" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days_per_year" INTEGER NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "max_carry_over" INTEGER NOT NULL DEFAULT 0,
    "sub_company_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "carried_over" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "approver_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_sub_company_id_idx" ON "projects"("sub_company_id");

-- CreateIndex
CREATE INDEX "projects_owner_id_idx" ON "projects"("owner_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- CreateIndex
CREATE INDEX "milestones_due_date_idx" ON "milestones"("due_date");

-- CreateIndex
CREATE INDEX "leave_types_sub_company_id_idx" ON "leave_types"("sub_company_id");

-- CreateIndex
CREATE INDEX "leave_balances_user_id_idx" ON "leave_balances"("user_id");

-- CreateIndex
CREATE INDEX "leave_balances_leave_type_id_idx" ON "leave_balances"("leave_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_user_id_leave_type_id_year_key" ON "leave_balances"("user_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_idx" ON "leave_requests"("user_id");

-- CreateIndex
CREATE INDEX "leave_requests_leave_type_id_idx" ON "leave_requests"("leave_type_id");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "leave_requests_start_date_end_date_idx" ON "leave_requests"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "tasks_project_id_idx" ON "tasks"("project_id");

-- RenameForeignKey
ALTER TABLE "client_note_field_defs" RENAME CONSTRAINT "client_note_field_defs_created_by_fk" TO "client_note_field_defs_created_by_id_fkey";

-- RenameForeignKey
ALTER TABLE "client_note_field_defs" RENAME CONSTRAINT "client_note_field_defs_sub_fk" TO "client_note_field_defs_sub_company_id_fkey";

-- RenameForeignKey
ALTER TABLE "client_note_field_values" RENAME CONSTRAINT "client_note_field_values_client_fk" TO "client_note_field_values_client_id_fkey";

-- RenameForeignKey
ALTER TABLE "client_note_field_values" RENAME CONSTRAINT "client_note_field_values_field_def_fk" TO "client_note_field_values_field_def_id_fkey";

-- RenameForeignKey
ALTER TABLE "client_note_field_values" RENAME CONSTRAINT "client_note_field_values_sub_fk" TO "client_note_field_values_sub_company_id_fkey";

-- RenameForeignKey
ALTER TABLE "client_note_field_values" RENAME CONSTRAINT "client_note_field_values_updated_by_fk" TO "client_note_field_values_updated_by_id_fkey";

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_forwarded_from_user_id_fkey" FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_forwarded_from_user_id_fkey" FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_forwarded_from_user_id_fkey" FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_forwarded_from_user_id_fkey" FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_forwarded_from_user_id_fkey" FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_forwarded_to_user_id_fkey" FOREIGN KEY ("forwarded_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_forwarded_from_user_id_fkey" FOREIGN KEY ("forwarded_from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_logs" ADD CONSTRAINT "offboarding_logs_departing_user_id_fkey" FOREIGN KEY ("departing_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_logs" ADD CONSTRAINT "offboarding_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offboarding_logs" ADD CONSTRAINT "offboarding_logs_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_authorities" ADD CONSTRAINT "signing_authorities_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "client_note_field_defs_active_order_idx" RENAME TO "client_note_field_defs_is_active_sort_order_idx";

-- RenameIndex
ALTER INDEX "client_note_field_defs_sub_key" RENAME TO "client_note_field_defs_sub_company_id_key_key";

-- RenameIndex
ALTER INDEX "client_note_field_defs_visibility_sub_idx" RENAME TO "client_note_field_defs_visibility_sub_company_id_idx";

-- RenameIndex
ALTER INDEX "client_note_field_values_client_idx" RENAME TO "client_note_field_values_client_id_idx";

-- RenameIndex
ALTER INDEX "client_note_field_values_field_def_idx" RENAME TO "client_note_field_values_field_def_id_idx";

-- RenameIndex
ALTER INDEX "client_note_field_values_unique" RENAME TO "client_note_field_values_client_id_field_def_id_sub_company_key";

-- RenameIndex
ALTER INDEX "client_notes_visibility_sub_idx" RENAME TO "client_notes_visibility_sub_company_id_idx";

-- RenameIndex
ALTER INDEX "import_mapping_templates_sub_company_id_entity_type_header_fing" RENAME TO "import_mapping_templates_sub_company_id_entity_type_header__key";
