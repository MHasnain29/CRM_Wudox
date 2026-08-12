-- Personal email template copies (ownerUserId set) vs shared library (null)
ALTER TABLE "email_templates" ADD COLUMN "owner_user_id" TEXT;
ALTER TABLE "email_templates" ADD COLUMN "source_template_id" TEXT;

CREATE INDEX "email_templates_owner_user_id_idx" ON "email_templates"("owner_user_id");
CREATE INDEX "email_templates_source_template_id_idx" ON "email_templates"("source_template_id");

ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
