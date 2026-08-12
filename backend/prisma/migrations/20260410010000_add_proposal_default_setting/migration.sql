-- CreateTable: proposal_default_settings
CREATE TABLE "proposal_default_settings" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "max_files" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_default_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_default_settings_sub_company_id_key" ON "proposal_default_settings"("sub_company_id");

-- AddForeignKey
ALTER TABLE "proposal_default_settings" ADD CONSTRAINT "proposal_default_settings_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
