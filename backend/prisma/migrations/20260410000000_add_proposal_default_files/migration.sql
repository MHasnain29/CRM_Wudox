-- CreateTable: proposal_default_files
CREATE TABLE "proposal_default_files" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_default_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_default_files_sub_company_id_idx" ON "proposal_default_files"("sub_company_id");

-- AddForeignKey
ALTER TABLE "proposal_default_files" ADD CONSTRAINT "proposal_default_files_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
