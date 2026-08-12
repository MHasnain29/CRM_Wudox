-- CreateTable
CREATE TABLE "idle_time_settings" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "threshold_minutes" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idle_time_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idle_time_settings_sub_company_id_key" ON "idle_time_settings"("sub_company_id");

-- AddForeignKey
ALTER TABLE "idle_time_settings" ADD CONSTRAINT "idle_time_settings_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
