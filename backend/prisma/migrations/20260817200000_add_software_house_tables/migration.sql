-- Software House pivot: projects, milestones, leave tables, tasks.project_id

-- Enums
DO $$ BEGIN
  CREATE TYPE "ProjectStatus" AS ENUM ('active', 'on_hold', 'done');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ProjectMemberRole" AS ENUM ('member', 'lead');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Projects table
CREATE TABLE IF NOT EXISTS "projects" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'active',
  "owner_id" TEXT NOT NULL,
  "sub_company_id" TEXT,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "projects_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "projects_sub_company_id_idx" ON "projects" ("sub_company_id");
CREATE INDEX IF NOT EXISTS "projects_owner_id_idx" ON "projects" ("owner_id");
CREATE INDEX IF NOT EXISTS "projects_status_idx" ON "projects" ("status");

-- Project members table
CREATE TABLE IF NOT EXISTS "project_members" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "ProjectMemberRole" NOT NULL DEFAULT 'member',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_members_project_id_user_id_key" UNIQUE ("project_id", "user_id"),
  CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "project_members_user_id_idx" ON "project_members" ("user_id");

-- Milestones table
CREATE TABLE IF NOT EXISTS "milestones" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "project_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "milestones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "milestones_project_id_idx" ON "milestones" ("project_id");
CREATE INDEX IF NOT EXISTS "milestones_due_date_idx" ON "milestones" ("due_date");

-- Leave types table
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "days_per_year" INTEGER NOT NULL,
  "paid" BOOLEAN NOT NULL DEFAULT true,
  "max_carry_over" INTEGER NOT NULL DEFAULT 0,
  "sub_company_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "leave_types_sub_company_id_idx" ON "leave_types" ("sub_company_id");

-- Leave balances table
CREATE TABLE IF NOT EXISTS "leave_balances" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "leave_type_id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "entitled" INTEGER NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "carried_over" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_balances_user_id_leave_type_id_year_key" UNIQUE ("user_id", "leave_type_id", "year"),
  CONSTRAINT "leave_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "leave_balances_user_id_idx" ON "leave_balances" ("user_id");
CREATE INDEX IF NOT EXISTS "leave_balances_leave_type_id_idx" ON "leave_balances" ("leave_type_id");

-- Leave requests table
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
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
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "leave_requests_user_id_idx" ON "leave_requests" ("user_id");
CREATE INDEX IF NOT EXISTS "leave_requests_leave_type_id_idx" ON "leave_requests" ("leave_type_id");
CREATE INDEX IF NOT EXISTS "leave_requests_status_idx" ON "leave_requests" ("status");
CREATE INDEX IF NOT EXISTS "leave_requests_start_date_end_date_idx" ON "leave_requests" ("start_date", "end_date");

-- Add project_id column to tasks
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" ("project_id");
