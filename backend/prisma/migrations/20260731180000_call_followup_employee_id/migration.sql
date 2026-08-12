-- AlterTable: Call — allow employee-linked calls (client optional)
ALTER TABLE "calls" ALTER COLUMN "client_id" DROP NOT NULL;
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "employee_id" TEXT;
CREATE INDEX IF NOT EXISTS "calls_employee_id_idx" ON "calls"("employee_id");
ALTER TABLE "calls" DROP CONSTRAINT IF EXISTS "calls_employee_id_fkey";
ALTER TABLE "calls" ADD CONSTRAINT "calls_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: FollowUp — allow employee-linked follow-ups (client optional)
ALTER TABLE "follow_ups" ALTER COLUMN "client_id" DROP NOT NULL;
ALTER TABLE "follow_ups" ADD COLUMN IF NOT EXISTS "employee_id" TEXT;
CREATE INDEX IF NOT EXISTS "follow_ups_employee_id_idx" ON "follow_ups"("employee_id");
ALTER TABLE "follow_ups" DROP CONSTRAINT IF EXISTS "follow_ups_employee_id_fkey";
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
