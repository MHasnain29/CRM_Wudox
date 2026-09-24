BEGIN;

-- Stop before changing schema if legacy agency connections share an organization.
-- Consolidate those connections and map their projects to the relevant agencies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "hubstaff_configs" GROUP BY "hubstaff_org_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Hubstaff organization connections must be consolidated before this migration.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "hubstaff_configs" ADD COLUMN     "last_history_reconciled_at" TIMESTAMP(3),
ADD COLUMN     "last_task_sync_at" TIMESTAMP(3),
ADD COLUMN     "org_timezone" TEXT,
ADD COLUMN     "sync_lease_owner" TEXT,
ADD COLUMN     "sync_lease_until" TIMESTAMP(3),
ADD COLUMN     "task_sync_error" TEXT,
ADD COLUMN     "task_sync_status" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "tasks_integration_id" INTEGER,
ADD COLUMN     "tasks_organization_id" TEXT;

-- CreateTable
CREATE TABLE "hubstaff_tasks" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "hubstaff_org_id" INTEGER NOT NULL,
    "task_key" TEXT NOT NULL,
    "hubstaff_task_id" TEXT,
    "global_todo_id" TEXT,
    "project_management_id" TEXT,
    "hubstaff_project_id" INTEGER,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "completed_at" TIMESTAMP(3),
    "completion_observed_at" TIMESTAMP(3),
    "estimate_seconds" INTEGER,
    "assignee_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "due_at" TIMESTAMP(3),
    "provider_updated_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'hubstaff_time',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_json" JSONB,
    "source_url" TEXT,

    CONSTRAINT "hubstaff_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubstaff_task_events" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "hubstaff_org_id" INTEGER NOT NULL,
    "task_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "assignee_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurred_at" TIMESTAMP(3),

    CONSTRAINT "hubstaff_task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubstaff_task_activities" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "hubstaff_org_id" INTEGER NOT NULL,
    "source_activity_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "hubstaff_user_id" INTEGER NOT NULL,
    "user_id" TEXT,
    "date" DATE NOT NULL,
    "hubstaff_project_id" INTEGER NOT NULL DEFAULT 0,
    "task_key" TEXT,
    "hubstaff_task_id" TEXT,
    "global_todo_id" TEXT,
    "tracked_seconds" INTEGER NOT NULL DEFAULT 0,
    "keyboard_seconds" INTEGER NOT NULL DEFAULT 0,
    "mouse_seconds" INTEGER NOT NULL DEFAULT 0,
    "overall_seconds" INTEGER NOT NULL DEFAULT 0,
    "input_tracked_seconds" INTEGER NOT NULL DEFAULT 0,
    "manual_seconds" INTEGER NOT NULL DEFAULT 0,
    "idle_seconds" INTEGER NOT NULL DEFAULT 0,
    "billable_seconds" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubstaff_task_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubstaff_project_mappings" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "hubstaff_project_id" INTEGER NOT NULL,
    "project_name" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "work_profile" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubstaff_project_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubstaff_sync_runs" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "task_status" TEXT NOT NULL DEFAULT 'unknown',
    "activity_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "hubstaff_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hubstaff_tasks_config_id_completed_at_idx" ON "hubstaff_tasks"("config_id", "completed_at");

-- CreateIndex
CREATE INDEX "hubstaff_tasks_config_id_global_todo_id_idx" ON "hubstaff_tasks"("config_id", "global_todo_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_tasks_config_id_task_key_key" ON "hubstaff_tasks"("config_id", "task_key");

-- CreateIndex
CREATE INDEX "hubstaff_task_events_config_id_task_key_observed_at_idx" ON "hubstaff_task_events"("config_id", "task_key", "observed_at");

-- CreateIndex
CREATE INDEX "hubstaff_task_events_config_id_type_observed_at_idx" ON "hubstaff_task_events"("config_id", "type", "observed_at");

-- CreateIndex
CREATE INDEX "hubstaff_task_activities_config_id_date_idx" ON "hubstaff_task_activities"("config_id", "date");

-- CreateIndex
CREATE INDEX "hubstaff_task_activities_user_id_date_idx" ON "hubstaff_task_activities"("user_id", "date");

-- CreateIndex
CREATE INDEX "hubstaff_task_activities_config_id_task_key_idx" ON "hubstaff_task_activities"("config_id", "task_key");

-- CreateIndex
CREATE INDEX "hubstaff_task_activities_sub_company_id_date_idx" ON "hubstaff_task_activities"("sub_company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_task_activities_config_id_source_activity_id_key" ON "hubstaff_task_activities"("config_id", "source_activity_id");

-- CreateIndex
CREATE INDEX "hubstaff_project_mappings_sub_company_id_idx" ON "hubstaff_project_mappings"("sub_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_project_mappings_config_id_hubstaff_project_id_key" ON "hubstaff_project_mappings"("config_id", "hubstaff_project_id");

-- CreateIndex
CREATE INDEX "hubstaff_sync_runs_config_id_started_at_idx" ON "hubstaff_sync_runs"("config_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_configs_hubstaff_org_id_key" ON "hubstaff_configs"("hubstaff_org_id");

-- AddForeignKey
ALTER TABLE "hubstaff_tasks" ADD CONSTRAINT "hubstaff_tasks_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "hubstaff_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_task_events" ADD CONSTRAINT "hubstaff_task_events_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "hubstaff_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_task_activities" ADD CONSTRAINT "hubstaff_task_activities_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "hubstaff_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_project_mappings" ADD CONSTRAINT "hubstaff_project_mappings_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "hubstaff_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_sync_runs" ADD CONSTRAINT "hubstaff_sync_runs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "hubstaff_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
