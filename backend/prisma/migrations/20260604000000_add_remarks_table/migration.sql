-- CreateTable
CREATE TABLE "remarks" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_role" VARCHAR(64) NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "visibility" VARCHAR(16) NOT NULL,
    "scope" VARCHAR(16),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remarks_client_id_created_at_idx" ON "remarks"("client_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "remarks_author_id_idx" ON "remarks"("author_id");

-- CreateIndex
CREATE INDEX "remarks_visibility_scope_sub_company_id_idx" ON "remarks"("visibility", "scope", "sub_company_id");

-- AddForeignKey
ALTER TABLE "remarks" ADD CONSTRAINT "remarks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remarks" ADD CONSTRAINT "remarks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remarks" ADD CONSTRAINT "remarks_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
