BEGIN;

-- Leave pre-existing send outcomes unknown: a Sent mailbox row is not proof of a send.
ALTER TABLE "emails"
  ADD COLUMN "send_status" TEXT,
  ADD COLUMN "sent_at" TIMESTAMP(3),
  ADD COLUMN "activity_actor_id" TEXT,
  ADD COLUMN "sending_kind" TEXT;
ALTER TABLE "email_recipients"
  ADD COLUMN "send_status" TEXT,
  ADD COLUMN "sent_at" TIMESTAMP(3);
CREATE INDEX "emails_sub_company_id_activity_actor_id_sent_at_idx"
  ON "emails"("sub_company_id", "activity_actor_id", "sent_at");

CREATE TABLE "work_completion_events" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "sub_company_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "due_at" TIMESTAMP(3),
  CONSTRAINT "work_completion_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "work_completion_events_sub_company_id_user_id_occurred_at_idx"
  ON "work_completion_events"("sub_company_id", "user_id", "occurred_at");
CREATE INDEX "work_completion_events_kind_entity_id_occurred_at_idx"
  ON "work_completion_events"("kind", "entity_id", "occurred_at");

COMMIT;
