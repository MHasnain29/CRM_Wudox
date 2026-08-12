-- CreateTable
CREATE TABLE "allowed_job_titles" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "allowed_job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_title_requests" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ResourceRequestStatus" NOT NULL DEFAULT 'pending',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_title_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowed_job_titles_sub_company_id_name_key" ON "allowed_job_titles"("sub_company_id", "name");

-- CreateIndex
CREATE INDEX "allowed_job_titles_sub_company_id_idx" ON "allowed_job_titles"("sub_company_id");

-- CreateIndex
CREATE INDEX "job_title_requests_sub_company_id_idx" ON "job_title_requests"("sub_company_id");

-- CreateIndex
CREATE INDEX "job_title_requests_status_idx" ON "job_title_requests"("status");

-- AddForeignKey
ALTER TABLE "allowed_job_titles" ADD CONSTRAINT "allowed_job_titles_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_title_requests" ADD CONSTRAINT "job_title_requests_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_title_requests" ADD CONSTRAINT "job_title_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_title_requests" ADD CONSTRAINT "job_title_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
