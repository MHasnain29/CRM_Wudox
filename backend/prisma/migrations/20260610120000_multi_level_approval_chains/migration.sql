-- CreateEnum
CREATE TYPE "ApprovalChainMode" AS ENUM ('bypass', 'fixed_steps', 'full_hierarchy');

-- CreateEnum
CREATE TYPE "ApprovalWorkflowType" AS ENUM ('client_manual_add', 'client_manual_edit', 'client_import', 'lead_request', 'lead_extension', 'lead_reassignment', 'proposal_review', 'proposal_extension');

-- CreateEnum
CREATE TYPE "ApprovalActorMode" AS ENUM ('none', 'forward_only', 'final_only', 'forward_final');

-- AlterTable
ALTER TABLE "pending_client_submissions" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pending_client_submissions" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "pending_client_edits" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pending_client_edits" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "pending_imported_clients" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pending_imported_clients" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "lead_requests" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lead_requests" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "lead_extension_requests" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lead_extension_requests" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "lead_reassignment_requests" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lead_reassignment_requests" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "proposals" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "proposal_extension_requests" ADD COLUMN "current_step_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "proposal_extension_requests" ADD COLUMN "approval_chain" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "agency_approval_policies" (
    "sub_company_id" TEXT NOT NULL,
    "workflows" JSONB NOT NULL,
    "allow_lead_self_assign" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_approval_policies_pkey" PRIMARY KEY ("sub_company_id")
);

-- CreateTable
CREATE TABLE "role_approval_capabilities" (
    "role_id" TEXT NOT NULL,
    "workflow" "ApprovalWorkflowType" NOT NULL,
    "mode" "ApprovalActorMode" NOT NULL,

    CONSTRAINT "role_approval_capabilities_pkey" PRIMARY KEY ("role_id","workflow")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "workflow" "ApprovalWorkflowType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "target_role_key" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_role_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_steps_entity_type_entity_id_idx" ON "approval_steps"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_steps_workflow_created_at_idx" ON "approval_steps"("workflow", "created_at");

-- AddForeignKey
ALTER TABLE "agency_approval_policies" ADD CONSTRAINT "agency_approval_policies_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_approval_capabilities" ADD CONSTRAINT "role_approval_capabilities_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate legacy manager approvals into approval_steps
INSERT INTO "approval_steps" ("id", "workflow", "entity_type", "entity_id", "step_index", "target_role_key", "actor_user_id", "actor_role_key", "action", "created_at")
SELECT
    gen_random_uuid()::text,
    'client_manual_add'::"ApprovalWorkflowType",
    'pending_client_submissions',
    pcs.id,
    0,
    COALESCE(u.role, 'sales_manager'),
    pcs.manager_approved_by_id,
    COALESCE(u.role, 'sales_manager'),
    'forward',
    pcs.manager_approved_at
FROM "pending_client_submissions" pcs
LEFT JOIN "users" u ON u.id = pcs.manager_approved_by_id
WHERE pcs.manager_approved_at IS NOT NULL AND pcs.manager_approved_by_id IS NOT NULL;

UPDATE "pending_client_submissions"
SET "current_step_index" = 1
WHERE manager_approved_at IS NOT NULL;

INSERT INTO "approval_steps" ("id", "workflow", "entity_type", "entity_id", "step_index", "target_role_key", "actor_user_id", "actor_role_key", "action", "created_at")
SELECT
    gen_random_uuid()::text,
    'client_manual_edit'::"ApprovalWorkflowType",
    'pending_client_edits',
    pce.id,
    0,
    COALESCE(u.role, 'sales_manager'),
    pce.manager_approved_by_id,
    COALESCE(u.role, 'sales_manager'),
    'forward',
    pce.manager_approved_at
FROM "pending_client_edits" pce
LEFT JOIN "users" u ON u.id = pce.manager_approved_by_id
WHERE pce.manager_approved_at IS NOT NULL AND pce.manager_approved_by_id IS NOT NULL;

UPDATE "pending_client_edits"
SET "current_step_index" = 1
WHERE manager_approved_at IS NOT NULL;
