-- Add email forwarding rule to users: departed user's inbound emails route to this user
ALTER TABLE "users" ADD COLUMN "email_forwarding_to_user_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_email_forwarding_to_user_id_fkey"
  FOREIGN KEY ("email_forwarding_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "users_email_forwarding_to_user_id_idx" ON "users"("email_forwarding_to_user_id");
