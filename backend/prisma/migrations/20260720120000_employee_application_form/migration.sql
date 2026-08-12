-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "AvailabilityType" AS ENUM ('full_time', 'part_time');

-- CreateEnum
CREATE TYPE "ResidencyStatus" AS ENUM ('citizen', 'pr', 'student', 'refugee', 'work_permit');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'resume';

-- AlterTable
ALTER TABLE "employees"
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "address_line_2" TEXT,
  ADD COLUMN "emergency_contact_name" TEXT,
  ADD COLUMN "emergency_contact_phone" TEXT,
  ADD COLUMN "education_level" TEXT,
  ADD COLUMN "education_from_year" INTEGER,
  ADD COLUMN "education_end_year" INTEGER,
  ADD COLUMN "graduated" BOOLEAN,
  ADD COLUMN "course_studied" TEXT,
  ADD COLUMN "diploma_name" TEXT,
  ADD COLUMN "experience_duties" TEXT,
  ADD COLUMN "available_from" DATE,
  ADD COLUMN "availability_type" "AvailabilityType",
  ADD COLUMN "residency_status" "ResidencyStatus",
  ADD COLUMN "shifts_available" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "able_twelve_hour_shift" BOOLEAN,
  ADD COLUMN "english_proficiency" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "employee_work_experiences" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_number" TEXT,
    "position" TEXT,
    "duration" TEXT,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "employee_work_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_work_experiences_employee_id_idx" ON "employee_work_experiences"("employee_id");

-- AddForeignKey
ALTER TABLE "employee_work_experiences"
  ADD CONSTRAINT "employee_work_experiences_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
