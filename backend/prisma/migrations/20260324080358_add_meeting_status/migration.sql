-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'completed');

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled';

-- CreateIndex
CREATE INDEX "meetings_status_idx" ON "meetings"("status");
