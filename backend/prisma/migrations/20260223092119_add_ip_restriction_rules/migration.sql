-- CreateTable
CREATE TABLE "ip_restriction_rules" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "country" "Country",
    "allowed_ips" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_restriction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ip_restriction_rules_role_idx" ON "ip_restriction_rules"("role");

-- CreateIndex
CREATE INDEX "ip_restriction_rules_country_idx" ON "ip_restriction_rules"("country");

-- CreateIndex
CREATE UNIQUE INDEX "ip_restriction_rules_role_country_key" ON "ip_restriction_rules"("role", "country");
