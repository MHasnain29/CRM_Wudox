-- CreateTable
CREATE TABLE "agency_notification_rules" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title_template" TEXT,
    "body_template" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "user_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("user_id","event_key")
);

-- CreateIndex
CREATE INDEX "agency_notification_rules_sub_company_id_idx" ON "agency_notification_rules"("sub_company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_notification_rules_sub_company_id_event_key_key" ON "agency_notification_rules"("sub_company_id", "event_key");

-- CreateIndex
CREATE INDEX "user_notification_preferences_user_id_idx" ON "user_notification_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "agency_notification_rules" ADD CONSTRAINT "agency_notification_rules_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
