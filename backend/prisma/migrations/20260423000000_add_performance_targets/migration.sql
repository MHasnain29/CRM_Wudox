-- CreateTable
CREATE TABLE "performance_targets" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "user_id" TEXT,
    "emails_target" INTEGER NOT NULL DEFAULT 0,
    "calls_target" INTEGER NOT NULL DEFAULT 0,
    "tasks_target" INTEGER NOT NULL DEFAULT 0,
    "follow_ups_target" INTEGER NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "performance_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_targets_sub_company_id_idx" ON "performance_targets"("sub_company_id");

-- CreateIndex
CREATE INDEX "performance_targets_sub_company_id_user_id_idx" ON "performance_targets"("sub_company_id", "user_id");

-- CreateIndex
CREATE INDEX "performance_targets_sub_company_id_user_id_effective_from_idx" ON "performance_targets"("sub_company_id", "user_id", "effective_from");

-- AddForeignKey
ALTER TABLE "performance_targets" ADD CONSTRAINT "performance_targets_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_targets" ADD CONSTRAINT "performance_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_targets" ADD CONSTRAINT "performance_targets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
