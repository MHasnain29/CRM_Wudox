-- CreateTable
CREATE TABLE "proposal_type_template_mappings" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "temp_template_id" TEXT,
    "temp_template_name" TEXT,
    "direct_template_id" TEXT,
    "direct_template_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_type_template_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_type_template_mappings_sub_company_id_key" ON "proposal_type_template_mappings"("sub_company_id");

-- AddForeignKey
ALTER TABLE "proposal_type_template_mappings" ADD CONSTRAINT "proposal_type_template_mappings_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
