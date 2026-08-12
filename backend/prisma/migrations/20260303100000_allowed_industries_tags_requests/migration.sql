-- CreateEnum
CREATE TYPE "ResourceRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "allowed_industries" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "allowed_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowed_tags" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "allowed_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_requests" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ResourceRequestStatus" NOT NULL DEFAULT 'pending',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_requests" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ResourceRequestStatus" NOT NULL DEFAULT 'pending',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowed_industries_sub_company_id_name_key" ON "allowed_industries"("sub_company_id", "name");

-- CreateIndex
CREATE INDEX "allowed_industries_sub_company_id_idx" ON "allowed_industries"("sub_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "allowed_tags_sub_company_id_tag_key" ON "allowed_tags"("sub_company_id", "tag");

-- CreateIndex
CREATE INDEX "allowed_tags_sub_company_id_idx" ON "allowed_tags"("sub_company_id");

-- CreateIndex
CREATE INDEX "industry_requests_sub_company_id_idx" ON "industry_requests"("sub_company_id");

-- CreateIndex
CREATE INDEX "industry_requests_status_idx" ON "industry_requests"("status");

-- CreateIndex
CREATE INDEX "tag_requests_sub_company_id_idx" ON "tag_requests"("sub_company_id");

-- CreateIndex
CREATE INDEX "tag_requests_status_idx" ON "tag_requests"("status");

-- AddForeignKey
ALTER TABLE "allowed_industries" ADD CONSTRAINT "allowed_industries_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_tags" ADD CONSTRAINT "allowed_tags_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_requests" ADD CONSTRAINT "industry_requests_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_requests" ADD CONSTRAINT "industry_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_requests" ADD CONSTRAINT "industry_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_requests" ADD CONSTRAINT "tag_requests_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_requests" ADD CONSTRAINT "tag_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_requests" ADD CONSTRAINT "tag_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
