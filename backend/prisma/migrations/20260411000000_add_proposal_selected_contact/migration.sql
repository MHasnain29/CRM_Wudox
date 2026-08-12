-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "selected_contact_id" TEXT;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_selected_contact_id_fkey" FOREIGN KEY ("selected_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
