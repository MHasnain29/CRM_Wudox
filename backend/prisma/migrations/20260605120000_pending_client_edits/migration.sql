-- CreateTable
CREATE TABLE "pending_client_edits" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "location" TEXT,
    "address" TEXT,
    "company_size" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "location_address" JSONB,
    "submitter_role" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manager_approved_at" TIMESTAMP(3),
    "manager_approved_by_id" TEXT,

    CONSTRAINT "pending_client_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_client_edits_client_id_sub_company_id_key" ON "pending_client_edits"("client_id", "sub_company_id");

-- CreateIndex
CREATE INDEX "pending_client_edits_sub_company_id_idx" ON "pending_client_edits"("sub_company_id");

-- CreateIndex
CREATE INDEX "pending_client_edits_submitted_at_idx" ON "pending_client_edits"("submitted_at");

-- CreateIndex
CREATE INDEX "pending_client_edits_manager_approved_by_id_idx" ON "pending_client_edits"("manager_approved_by_id");

-- AddForeignKey
ALTER TABLE "pending_client_edits" ADD CONSTRAINT "pending_client_edits_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_client_edits" ADD CONSTRAINT "pending_client_edits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_client_edits" ADD CONSTRAINT "pending_client_edits_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_client_edits" ADD CONSTRAINT "pending_client_edits_manager_approved_by_id_fkey" FOREIGN KEY ("manager_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
