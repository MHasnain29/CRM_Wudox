-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('sales_associate', 'sales_executive', 'sales_manager', 'data_entry_specialist', 'database_manager', 'operations_manager', 'it', 'director', 'recruiter', 'sr_recruiter', 'recruitment_manager');

-- CreateEnum
CREATE TYPE "Country" AS ENUM ('Canada', 'Pakistan');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('contacted', 'active', 'lost', 'ex', 'unsubscribed', 'permanently_closed');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('open', 'closed_won', 'closed_lost');

-- CreateEnum
CREATE TYPE "Temperature" AS ENUM ('hot', 'warm', 'cold');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('answered', 'no_answer', 'voicemail', 'busy');

-- CreateEnum
CREATE TYPE "FollowUpOutcome" AS ENUM ('closed_won', 'closed_lost', 'next_follow_up', 'no_response');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('to_do', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "TaskLinkType" AS ENUM ('client', 'lead', 'meeting', 'follow_up');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('draft', 'open', 'closed', 'filled');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('internal', 'external');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'temporary');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('internal', 'external');

-- CreateEnum
CREATE TYPE "EmployeeWorkStatus" AS ENUM ('none', 'active', 'scheduled');

-- CreateEnum
CREATE TYPE "EmployeeApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('photo_id', 'sin', 'proof_of_status', 'other');

-- CreateEnum
CREATE TYPE "EmailFolder" AS ENUM ('inbox', 'sent', 'drafts');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "EmailRecipientStatus" AS ENUM ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('net_7', 'net_15', 'net_30', 'net_45', 'net_60');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');

-- CreateEnum
CREATE TYPE "BookedMeetingStatus" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "LeadRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "FilterViewType" AS ENUM ('clients', 'leads', 'jobs');

-- CreateTable
CREATE TABLE "sub_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mainOrgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "country" "Country" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "country" "Country" NOT NULL,
    "role" "UserRole" NOT NULL,
    "user_type" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "location_id" TEXT,
    "accessible_location_ids" TEXT[],
    "reporting_manager_ids" TEXT[],
    "avatar_url" TEXT,
    "daily_calls_target" INTEGER NOT NULL DEFAULT 0,
    "daily_emails_target" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMP(3),
    "probation_override" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "location" TEXT,
    "address" TEXT,
    "company_size" TEXT,
    "status" "ClientStatus" NOT NULL,
    "last_activity" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phone_extension" TEXT,
    "linkedin" TEXT,
    "website" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_tags" (
    "client_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "client_tags_pkey" PRIMARY KEY ("client_id","tag")
);

-- CreateTable
CREATE TABLE "client_restrictions" (
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "client_restrictions_pkey" PRIMARY KEY ("client_id","user_id")
);

-- CreateTable
CREATE TABLE "client_notes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_role" "UserRole" NOT NULL,
    "content" TEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "is_fixed" BOOLEAN NOT NULL DEFAULT false,
    "sub_company_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL,
    "temperature" "Temperature",
    "value" DECIMAL(12,2),
    "last_activity" TIMESTAMP(3),
    "next_follow_up" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "outcome" "CallOutcome" NOT NULL,
    "duration" INTEGER,
    "notes" TEXT,
    "recording_url" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "FollowUpOutcome",
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_comments" (
    "id" TEXT NOT NULL,
    "follow_up_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3) NOT NULL,
    "priority" "TaskPriority" NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "reminder_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_date" TIMESTAMP(3),
    "link_type" "TaskLinkType",
    "link_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "meeting_link" TEXT,
    "agenda" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendees" (
    "id" TEXT NOT NULL,
    "meeting_id" TEXT NOT NULL,
    "user_id" TEXT,
    "contact_id" TEXT,

    CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "template_id" TEXT,
    "job_type" "JobType" NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "department" TEXT,
    "description" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "responsibilities" TEXT NOT NULL,
    "open_positions" INTEGER NOT NULL DEFAULT 1,
    "filled_positions" INTEGER NOT NULL DEFAULT 0,
    "scheduled_positions" INTEGER NOT NULL DEFAULT 0,
    "backup_percentage" INTEGER NOT NULL DEFAULT 70,
    "status" "JobStatus" NOT NULL,
    "employment_type" "EmploymentType" NOT NULL,
    "salary_min" DECIMAL(10,2),
    "salary_max" DECIMAL(10,2),
    "publish_linkedin" BOOLEAN NOT NULL DEFAULT false,
    "publish_indeed" BOOLEAN NOT NULL DEFAULT false,
    "publish_glassdoor" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "applicant_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignments" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "is_backup" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_id" TEXT NOT NULL,

    CONSTRAINT "job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_type" "EmployeeType" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "alternate_phone" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "work_status" "EmployeeWorkStatus",
    "approval_status" "EmployeeApprovalStatus",
    "hire_date" TIMESTAMP(3),
    "termination_date" TIMESTAMP(3),
    "position" TEXT,
    "department" TEXT,
    "hourly_rate" DECIMAL(10,2),
    "added_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_tags" (
    "employee_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "employee_tags_pkey" PRIMARY KEY ("employee_id","tag")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" TEXT,
    "url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" TEXT NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_notes" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "from_user_id" TEXT,
    "from_name" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "folder" "EmailFolder" NOT NULL,
    "client_id" TEXT,
    "lead_id" TEXT,
    "in_reply_to" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_recipients" (
    "id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "client_id" TEXT,
    "contact_id" TEXT,

    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "template_id" TEXT,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "status" "CampaignStatus" NOT NULL,
    "sent_at" TIMESTAMP(3),
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "stats_sent" INTEGER NOT NULL DEFAULT 0,
    "stats_delivered" INTEGER NOT NULL DEFAULT 0,
    "stats_opened" INTEGER NOT NULL DEFAULT 0,
    "stats_clicked" INTEGER NOT NULL DEFAULT 0,
    "stats_bounced" INTEGER NOT NULL DEFAULT 0,
    "stats_failed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "EmailRecipientStatus" NOT NULL,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "location_type" TEXT NOT NULL,
    "agreement_types" TEXT[],
    "temp_pricing_type" TEXT,
    "temp_pricing_value" DECIMAL(10,2),
    "temp_minimum_hours" INTEGER,
    "direct_pricing_type" TEXT,
    "direct_pricing_value" DECIMAL(10,2),
    "payment_terms" "PaymentTerms" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_attachments" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "template_id" TEXT,
    "client_id" TEXT,
    "lead_id" TEXT,
    "content" JSONB,
    "file_url" TEXT,
    "generated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "manager_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "LeadRequestStatus" NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "sub_company_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_request_comments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_request_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_availability" (
    "user_id" TEXT NOT NULL,
    "meeting_duration" INTEGER NOT NULL DEFAULT 30,
    "buffer_time" INTEGER NOT NULL DEFAULT 15,
    "booking_link_slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_availability_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "time_slots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booked_meetings" (
    "id" TEXT NOT NULL,
    "host_user_id" TEXT NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT NOT NULL,
    "guest_company" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "meeting_link" TEXT,
    "notes" TEXT,
    "status" "BookedMeetingStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booked_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_views" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FilterViewType" NOT NULL,
    "user_id" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "filter_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sub_companies_mainOrgId_idx" ON "sub_companies"("mainOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_sub_company_id_idx" ON "users"("sub_company_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_location_id_idx" ON "users"("location_id");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_industry_idx" ON "clients"("industry");

-- CreateIndex
CREATE INDEX "clients_location_idx" ON "clients"("location");

-- CreateIndex
CREATE INDEX "clients_last_activity_idx" ON "clients"("last_activity");

-- CreateIndex
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts"("client_id");

-- CreateIndex
CREATE INDEX "client_contacts_email_idx" ON "client_contacts"("email");

-- CreateIndex
CREATE INDEX "client_contacts_client_id_is_primary_idx" ON "client_contacts"("client_id", "is_primary");

-- CreateIndex
CREATE INDEX "client_tags_tag_idx" ON "client_tags"("tag");

-- CreateIndex
CREATE INDEX "client_restrictions_user_id_idx" ON "client_restrictions"("user_id");

-- CreateIndex
CREATE INDEX "client_notes_client_id_idx" ON "client_notes"("client_id");

-- CreateIndex
CREATE INDEX "client_notes_user_id_idx" ON "client_notes"("user_id");

-- CreateIndex
CREATE INDEX "client_notes_client_id_is_pinned_idx" ON "client_notes"("client_id", "is_pinned");

-- CreateIndex
CREATE INDEX "pipeline_stages_sub_company_id_idx" ON "pipeline_stages"("sub_company_id");

-- CreateIndex
CREATE INDEX "pipeline_stages_order_index_idx" ON "pipeline_stages"("order_index");

-- CreateIndex
CREATE INDEX "leads_client_id_idx" ON "leads"("client_id");

-- CreateIndex
CREATE INDEX "leads_owner_id_idx" ON "leads"("owner_id");

-- CreateIndex
CREATE INDEX "leads_sub_company_id_idx" ON "leads"("sub_company_id");

-- CreateIndex
CREATE INDEX "leads_stage_idx" ON "leads"("stage");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_temperature_idx" ON "leads"("temperature");

-- CreateIndex
CREATE INDEX "leads_next_follow_up_idx" ON "leads"("next_follow_up");

-- CreateIndex
CREATE INDEX "leads_last_activity_idx" ON "leads"("last_activity");

-- CreateIndex
CREATE INDEX "calls_client_id_idx" ON "calls"("client_id");

-- CreateIndex
CREATE INDEX "calls_lead_id_idx" ON "calls"("lead_id");

-- CreateIndex
CREATE INDEX "calls_owner_id_idx" ON "calls"("owner_id");

-- CreateIndex
CREATE INDEX "calls_timestamp_idx" ON "calls"("timestamp");

-- CreateIndex
CREATE INDEX "calls_outcome_idx" ON "calls"("outcome");

-- CreateIndex
CREATE INDEX "follow_ups_client_id_idx" ON "follow_ups"("client_id");

-- CreateIndex
CREATE INDEX "follow_ups_lead_id_idx" ON "follow_ups"("lead_id");

-- CreateIndex
CREATE INDEX "follow_ups_owner_id_idx" ON "follow_ups"("owner_id");

-- CreateIndex
CREATE INDEX "follow_ups_due_date_idx" ON "follow_ups"("due_date");

-- CreateIndex
CREATE INDEX "follow_ups_completed_due_date_idx" ON "follow_ups"("completed", "due_date");

-- CreateIndex
CREATE INDEX "follow_up_comments_follow_up_id_idx" ON "follow_up_comments"("follow_up_id");

-- CreateIndex
CREATE INDEX "tasks_owner_id_idx" ON "tasks"("owner_id");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_due_date_idx" ON "tasks"("due_date");

-- CreateIndex
CREATE INDEX "tasks_link_type_link_id_idx" ON "tasks"("link_type", "link_id");

-- CreateIndex
CREATE INDEX "tasks_sub_company_id_idx" ON "tasks"("sub_company_id");

-- CreateIndex
CREATE INDEX "task_comments_task_id_idx" ON "task_comments"("task_id");

-- CreateIndex
CREATE INDEX "meetings_client_id_idx" ON "meetings"("client_id");

-- CreateIndex
CREATE INDEX "meetings_lead_id_idx" ON "meetings"("lead_id");

-- CreateIndex
CREATE INDEX "meetings_owner_id_idx" ON "meetings"("owner_id");

-- CreateIndex
CREATE INDEX "meetings_start_time_idx" ON "meetings"("start_time");

-- CreateIndex
CREATE INDEX "meetings_start_time_end_time_idx" ON "meetings"("start_time", "end_time");

-- CreateIndex
CREATE INDEX "meeting_attendees_meeting_id_idx" ON "meeting_attendees"("meeting_id");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_job_type_idx" ON "jobs"("job_type");

-- CreateIndex
CREATE INDEX "jobs_location_idx" ON "jobs"("location");

-- CreateIndex
CREATE INDEX "jobs_created_by_id_idx" ON "jobs"("created_by_id");

-- CreateIndex
CREATE INDEX "job_assignments_job_id_idx" ON "job_assignments"("job_id");

-- CreateIndex
CREATE INDEX "job_assignments_employee_id_idx" ON "job_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "job_assignments_is_active_idx" ON "job_assignments"("is_active");

-- CreateIndex
CREATE INDEX "employees_employee_type_idx" ON "employees"("employee_type");

-- CreateIndex
CREATE INDEX "employees_work_status_idx" ON "employees"("work_status");

-- CreateIndex
CREATE INDEX "employees_approval_status_idx" ON "employees"("approval_status");

-- CreateIndex
CREATE INDEX "employees_email_idx" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_idx" ON "employee_documents"("employee_id");

-- CreateIndex
CREATE INDEX "employee_documents_type_idx" ON "employee_documents"("type");

-- CreateIndex
CREATE INDEX "employee_documents_expiry_date_idx" ON "employee_documents"("expiry_date");

-- CreateIndex
CREATE INDEX "employee_notes_employee_id_idx" ON "employee_notes"("employee_id");

-- CreateIndex
CREATE INDEX "emails_from_user_id_idx" ON "emails"("from_user_id");

-- CreateIndex
CREATE INDEX "emails_client_id_idx" ON "emails"("client_id");

-- CreateIndex
CREATE INDEX "emails_lead_id_idx" ON "emails"("lead_id");

-- CreateIndex
CREATE INDEX "emails_folder_idx" ON "emails"("folder");

-- CreateIndex
CREATE INDEX "emails_timestamp_idx" ON "emails"("timestamp");

-- CreateIndex
CREATE INDEX "email_recipients_email_id_idx" ON "email_recipients"("email_id");

-- CreateIndex
CREATE INDEX "email_recipients_email_idx" ON "email_recipients"("email");

-- CreateIndex
CREATE INDEX "email_campaigns_status_idx" ON "email_campaigns"("status");

-- CreateIndex
CREATE INDEX "email_campaigns_scheduled_date_idx" ON "email_campaigns"("scheduled_date");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_campaign_id_idx" ON "email_campaign_recipients"("campaign_id");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_status_idx" ON "email_campaign_recipients"("status");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_type_idx" ON "activity_logs"("type");

-- CreateIndex
CREATE INDEX "activity_logs_timestamp_idx" ON "activity_logs"("timestamp");

-- CreateIndex
CREATE INDEX "activity_logs_sub_company_id_idx" ON "activity_logs"("sub_company_id");

-- CreateIndex
CREATE INDEX "proposals_lead_id_idx" ON "proposals"("lead_id");

-- CreateIndex
CREATE INDEX "proposal_attachments_proposal_id_idx" ON "proposal_attachments"("proposal_id");

-- CreateIndex
CREATE INDEX "documents_client_id_idx" ON "documents"("client_id");

-- CreateIndex
CREATE INDEX "documents_lead_id_idx" ON "documents"("lead_id");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE INDEX "lead_requests_client_id_idx" ON "lead_requests"("client_id");

-- CreateIndex
CREATE INDEX "lead_requests_requested_by_id_idx" ON "lead_requests"("requested_by_id");

-- CreateIndex
CREATE INDEX "lead_requests_manager_id_idx" ON "lead_requests"("manager_id");

-- CreateIndex
CREATE INDEX "lead_requests_status_idx" ON "lead_requests"("status");

-- CreateIndex
CREATE INDEX "lead_requests_sub_company_id_idx" ON "lead_requests"("sub_company_id");

-- CreateIndex
CREATE INDEX "lead_request_comments_request_id_idx" ON "lead_request_comments"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_availability_booking_link_slug_key" ON "user_availability"("booking_link_slug");

-- CreateIndex
CREATE INDEX "user_availability_booking_link_slug_idx" ON "user_availability"("booking_link_slug");

-- CreateIndex
CREATE INDEX "time_slots_user_id_idx" ON "time_slots"("user_id");

-- CreateIndex
CREATE INDEX "time_slots_user_id_day_of_week_idx" ON "time_slots"("user_id", "day_of_week");

-- CreateIndex
CREATE INDEX "booked_meetings_host_user_id_idx" ON "booked_meetings"("host_user_id");

-- CreateIndex
CREATE INDEX "booked_meetings_start_time_idx" ON "booked_meetings"("start_time");

-- CreateIndex
CREATE INDEX "booked_meetings_status_idx" ON "booked_meetings"("status");

-- CreateIndex
CREATE INDEX "filter_views_user_id_idx" ON "filter_views"("user_id");

-- CreateIndex
CREATE INDEX "filter_views_user_id_type_idx" ON "filter_views"("user_id", "type");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tags" ADD CONSTRAINT "client_tags_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_restrictions" ADD CONSTRAINT "client_restrictions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_restrictions" ADD CONSTRAINT "client_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_comments" ADD CONSTRAINT "follow_up_comments_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "follow_ups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_tags" ADD CONSTRAINT "employee_tags_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_notes" ADD CONSTRAINT "employee_notes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_attachments" ADD CONSTRAINT "proposal_attachments_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_request_comments" ADD CONSTRAINT "lead_request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "lead_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_availability" ADD CONSTRAINT "user_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_availability"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booked_meetings" ADD CONSTRAINT "booked_meetings_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "user_availability"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_views" ADD CONSTRAINT "filter_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
