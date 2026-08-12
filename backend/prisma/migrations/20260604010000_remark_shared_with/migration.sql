-- AlterTable
ALTER TABLE "remarks" ADD COLUMN "shared_with" TEXT[] NOT NULL DEFAULT '{}';

-- CreateIndex (GIN for fast array containment queries)
CREATE INDEX "remarks_shared_with_idx" ON "remarks" USING GIN("shared_with");
