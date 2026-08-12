-- v1.0.10 — remark pinning: managers/authors can pin a remark so it floats
-- to the top of the Calls & Remarks timeline. Toggled via PATCH /remarks/:id/pin.

-- AlterTable
ALTER TABLE "remarks" ADD COLUMN "is_pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "remarks_client_id_is_pinned_idx" ON "remarks"("client_id", "is_pinned");
