-- Allow the same E.164 on different agencies; keep one row per agency + number.
DROP INDEX IF EXISTS "phone_numbers_e164_key";
CREATE UNIQUE INDEX "phone_numbers_sub_company_id_e164_key" ON "phone_numbers"("sub_company_id", "e164");
