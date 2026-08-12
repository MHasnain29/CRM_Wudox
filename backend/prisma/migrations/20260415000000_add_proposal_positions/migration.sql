-- CreateTable
CREATE TABLE "proposal_positions" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_positions_proposal_id_idx" ON "proposal_positions"("proposal_id");

-- AddForeignKey
ALTER TABLE "proposal_positions" ADD CONSTRAINT "proposal_positions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
