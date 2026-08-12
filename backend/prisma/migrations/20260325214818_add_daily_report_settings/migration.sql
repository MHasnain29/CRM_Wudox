-- CreateTable
CREATE TABLE "daily_report_settings" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "send_hour" INTEGER NOT NULL DEFAULT 18,
    "send_minute" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "shift_hours" INTEGER NOT NULL DEFAULT 8,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_report_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_settings_sub_company_id_key" ON "daily_report_settings"("sub_company_id");

-- AddForeignKey
ALTER TABLE "daily_report_settings" ADD CONSTRAINT "daily_report_settings_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
