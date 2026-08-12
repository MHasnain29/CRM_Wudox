-- CreateTable: mailing_lists
CREATE TABLE "mailing_lists" (
  "id"             TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailing_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mailing_list_clients
CREATE TABLE "mailing_list_clients" (
  "id"         TEXT NOT NULL,
  "list_id"    TEXT NOT NULL,
  "client_id"  TEXT NOT NULL,
  "added_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailing_list_clients_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one client per list
CREATE UNIQUE INDEX "mailing_list_clients_list_id_client_id_key" ON "mailing_list_clients"("list_id", "client_id");

-- Indexes
CREATE INDEX "mailing_lists_sub_company_id_idx" ON "mailing_lists"("sub_company_id");
CREATE INDEX "mailing_list_clients_list_id_idx" ON "mailing_list_clients"("list_id");
CREATE INDEX "mailing_list_clients_client_id_idx" ON "mailing_list_clients"("client_id");

-- FK: mailing_lists → sub_companies
ALTER TABLE "mailing_lists"
  ADD CONSTRAINT "mailing_lists_sub_company_id_fkey"
  FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK: mailing_list_clients → mailing_lists
ALTER TABLE "mailing_list_clients"
  ADD CONSTRAINT "mailing_list_clients_list_id_fkey"
  FOREIGN KEY ("list_id") REFERENCES "mailing_lists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: mailing_list_clients → clients
ALTER TABLE "mailing_list_clients"
  ADD CONSTRAINT "mailing_list_clients_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
