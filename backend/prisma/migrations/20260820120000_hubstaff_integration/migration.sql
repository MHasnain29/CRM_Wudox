-- CreateTable
CREATE TABLE "hubstaff_configs" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "hubstaff_org_id" INTEGER NOT NULL,
    "org_name" TEXT,
    "refresh_token" TEXT NOT NULL,
    "access_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "connected_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubstaff_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubstaff_user_links" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "hubstaff_user_id" INTEGER NOT NULL,
    "hubstaff_name" TEXT,
    "hubstaff_email" TEXT,
    "user_id" TEXT,
    "auto_matched" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubstaff_user_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubstaff_daily_activities" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "hubstaff_user_id" INTEGER NOT NULL,
    "user_id" TEXT,
    "date" DATE NOT NULL,
    "hubstaff_project_id" INTEGER NOT NULL DEFAULT 0,
    "project_name" TEXT,
    "tracked_seconds" INTEGER NOT NULL DEFAULT 0,
    "keyboard_seconds" INTEGER NOT NULL DEFAULT 0,
    "mouse_seconds" INTEGER NOT NULL DEFAULT 0,
    "overall_seconds" INTEGER NOT NULL DEFAULT 0,
    "input_tracked_seconds" INTEGER NOT NULL DEFAULT 0,
    "manual_seconds" INTEGER NOT NULL DEFAULT 0,
    "idle_seconds" INTEGER NOT NULL DEFAULT 0,
    "billable_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubstaff_daily_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_configs_sub_company_id_key" ON "hubstaff_configs"("sub_company_id");

-- CreateIndex
CREATE INDEX "hubstaff_user_links_sub_company_id_idx" ON "hubstaff_user_links"("sub_company_id");

-- CreateIndex
CREATE INDEX "hubstaff_user_links_user_id_idx" ON "hubstaff_user_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_user_links_config_id_hubstaff_user_id_key" ON "hubstaff_user_links"("config_id", "hubstaff_user_id");

-- CreateIndex
CREATE INDEX "hubstaff_daily_activities_sub_company_id_date_idx" ON "hubstaff_daily_activities"("sub_company_id", "date");

-- CreateIndex
CREATE INDEX "hubstaff_daily_activities_user_id_date_idx" ON "hubstaff_daily_activities"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "hubstaff_daily_activities_sub_company_id_hubstaff_user_id_d_key" ON "hubstaff_daily_activities"("sub_company_id", "hubstaff_user_id", "date", "hubstaff_project_id");

-- AddForeignKey
ALTER TABLE "hubstaff_configs" ADD CONSTRAINT "hubstaff_configs_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_user_links" ADD CONSTRAINT "hubstaff_user_links_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "hubstaff_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_user_links" ADD CONSTRAINT "hubstaff_user_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubstaff_daily_activities" ADD CONSTRAINT "hubstaff_daily_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

