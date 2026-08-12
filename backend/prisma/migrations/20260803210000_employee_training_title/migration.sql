-- Optional display title for standalone employee trainings (Ontario 4 Steps, WHMIS, etc.)
ALTER TABLE "employee_trainings" ADD COLUMN IF NOT EXISTS "title" TEXT;
