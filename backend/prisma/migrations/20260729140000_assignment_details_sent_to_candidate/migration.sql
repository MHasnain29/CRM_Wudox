-- Require tracking that assignment details were sent to the candidate before activation
ALTER TABLE "employee_assignments"
  ADD COLUMN "details_sent_to_candidate_at" TIMESTAMP(3);
