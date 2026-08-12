-- CreateTable
CREATE TABLE "operations_manager_sub_companies" (
    "user_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_manager_sub_companies_pkey" PRIMARY KEY ("user_id","sub_company_id")
);

-- CreateIndex
CREATE INDEX "operations_manager_sub_companies_sub_company_id_idx" ON "operations_manager_sub_companies"("sub_company_id");

-- AddForeignKey
ALTER TABLE "operations_manager_sub_companies" ADD CONSTRAINT "operations_manager_sub_companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations_manager_sub_companies" ADD CONSTRAINT "operations_manager_sub_companies_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
