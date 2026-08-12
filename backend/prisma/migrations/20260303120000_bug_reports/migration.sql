-- CreateEnum
CREATE TYPE "BugReportStatus" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "bug_reports" (
    "id" TEXT NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "screenshot_url" TEXT,
    "status" "BugReportStatus" NOT NULL DEFAULT 'open',
    "resolution_remarks" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bug_report_recipients" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bug_report_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bug_report_recipients_email_key" ON "bug_report_recipients"("email");

-- CreateIndex
CREATE INDEX "bug_reports_sub_company_id_idx" ON "bug_reports"("sub_company_id");

-- CreateIndex
CREATE INDEX "bug_reports_status_idx" ON "bug_reports"("status");

-- CreateIndex
CREATE INDEX "bug_reports_submitted_by_id_idx" ON "bug_reports"("submitted_by_id");

-- CreateIndex
CREATE INDEX "bug_reports_created_at_idx" ON "bug_reports"("created_at");

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
