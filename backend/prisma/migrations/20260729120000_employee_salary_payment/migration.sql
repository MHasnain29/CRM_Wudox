-- Employee salary payment method + bank details; bank_deposit document type

CREATE TYPE "SalaryPaymentMethod" AS ENUM ('cheque', 'deposit');

ALTER TABLE "employees"
  ADD COLUMN "salary_payment_method" "SalaryPaymentMethod",
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "bank_institution_number" TEXT,
  ADD COLUMN "bank_transit_number" TEXT,
  ADD COLUMN "bank_account_number" TEXT;

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'bank_deposit';
