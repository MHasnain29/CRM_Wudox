-- Remove unused trainer name from Active Client training.
ALTER TABLE "active_client_training_assignments" DROP COLUMN IF EXISTS "trainer_name";
ALTER TABLE "active_clients" DROP COLUMN IF EXISTS "trainer_name";
