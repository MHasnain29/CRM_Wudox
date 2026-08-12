-- CreateTable
CREATE TABLE "pending_imported_clients" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "imported_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "location" TEXT,
    "address" TEXT,
    "company_size" TEXT,
    "tags" TEXT[],
    "contact_name" TEXT,
    "contact_title" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_imported_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_imported_clients_sub_company_id_idx" ON "pending_imported_clients"("sub_company_id");

-- AddForeignKey
ALTER TABLE "pending_imported_clients" ADD CONSTRAINT "pending_imported_clients_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_imported_clients" ADD CONSTRAINT "pending_imported_clients_imported_by_id_fkey" FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
