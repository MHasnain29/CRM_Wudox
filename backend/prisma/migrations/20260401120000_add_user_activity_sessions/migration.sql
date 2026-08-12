-- CreateEnum
CREATE TYPE "ActivityState" AS ENUM ('active', 'idle', 'offline_suspected');

-- AlterTable: add activitySessions relation to users (no column change needed, relation is on child table)

-- CreateTable
CREATE TABLE "user_activity_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sub_company_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "current_state" "ActivityState" NOT NULL DEFAULT 'active',
    "idle_started_at" TIMESTAMP(3),
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "idle_seconds" INTEGER NOT NULL DEFAULT 0,
    "offline_seconds" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_activity_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_code" TEXT,
    "metadata" JSONB,

    CONSTRAINT "user_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_activity_sessions_user_id_ended_at_idx" ON "user_activity_sessions"("user_id", "ended_at");

-- CreateIndex
CREATE INDEX "user_activity_sessions_sub_company_id_started_at_idx" ON "user_activity_sessions"("sub_company_id", "started_at");

-- CreateIndex
CREATE INDEX "user_activity_sessions_last_seen_at_idx" ON "user_activity_sessions"("last_seen_at");

-- CreateIndex
CREATE INDEX "user_activity_sessions_current_state_last_seen_at_idx" ON "user_activity_sessions"("current_state", "last_seen_at");

-- CreateIndex
CREATE INDEX "user_activity_events_session_id_event_at_idx" ON "user_activity_events"("session_id", "event_at");

-- AddForeignKey
ALTER TABLE "user_activity_sessions" ADD CONSTRAINT "user_activity_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity_sessions" ADD CONSTRAINT "user_activity_sessions_sub_company_id_fkey" FOREIGN KEY ("sub_company_id") REFERENCES "sub_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_activity_events" ADD CONSTRAINT "user_activity_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_activity_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
