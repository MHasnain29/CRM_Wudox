-- CreateEnum
CREATE TYPE "AgentPresenceStatus" AS ENUM ('available', 'busy', 'away', 'offline');

-- CreateEnum
CREATE TYPE "PhoneQueueEntryStatus" AS ENUM ('waiting', 'connecting', 'connected', 'abandoned', 'timeout');

-- CreateTable
CREATE TABLE "agent_phone_presence" (
    "user_id" TEXT NOT NULL,
    "sub_company_id" TEXT,
    "manual_status" "AgentPresenceStatus",
    "active_call_count" INTEGER NOT NULL DEFAULT 0,
    "last_call_ended_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_phone_presence_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "phone_queue_entries" (
    "id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "ring_group_id" TEXT,
    "ring_group_name" TEXT,
    "queue_name" TEXT NOT NULL,
    "inbound_call_id" TEXT,
    "call_sid" TEXT NOT NULL,
    "caller_number" TEXT NOT NULL,
    "caller_name" TEXT,
    "status" "PhoneQueueEntryStatus" NOT NULL DEFAULT 'waiting',
    "connected_user_id" TEXT,
    "enqueued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_phone_presence_sub_company_id_idx" ON "agent_phone_presence"("sub_company_id");

-- CreateIndex
CREATE INDEX "phone_queue_entries_sub_company_id_status_idx" ON "phone_queue_entries"("sub_company_id", "status");

-- CreateIndex
CREATE INDEX "phone_queue_entries_ring_group_id_status_idx" ON "phone_queue_entries"("ring_group_id", "status");

-- CreateIndex
CREATE INDEX "phone_queue_entries_call_sid_idx" ON "phone_queue_entries"("call_sid");
