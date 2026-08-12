-- CreateTable
CREATE TABLE "call_scripts" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_status" TEXT,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_scripts_sub_company_id_idx" ON "call_scripts"("sub_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_scripts_sub_company_id_name_key" ON "call_scripts"("sub_company_id", "name");

-- AddForeignKey
ALTER TABLE "call_scripts" ADD CONSTRAINT "call_scripts_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
