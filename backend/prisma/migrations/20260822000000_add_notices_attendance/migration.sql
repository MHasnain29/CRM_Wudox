-- CreateEnum
CREATE TYPE "NoticeType" AS ENUM ('info', 'warning', 'holiday', 'urgent');

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "type" "NoticeType" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "check_in_at" TIMESTAMP(3) NOT NULL,
    "check_out_at" TIMESTAMP(3),
    "total_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notices_sub_company_id_idx" ON "notices"("sub_company_id");
CREATE INDEX "notices_expires_at_idx" ON "notices"("expires_at");

-- CreateIndex
CREATE INDEX "attendance_sub_company_id_date_idx" ON "attendance"("sub_company_id", "date");
CREATE UNIQUE INDEX "attendance_user_id_date_key" ON "attendance"("user_id", "date");

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
