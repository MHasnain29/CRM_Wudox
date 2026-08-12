-- CreateTable
CREATE TABLE "email_attachments" (
    "id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_attachments_email_id_idx" ON "email_attachments"("email_id");

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
