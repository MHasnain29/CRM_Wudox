-- Conversation id for Gmail-style email threading
ALTER TABLE "emails" ADD COLUMN "thread_id" TEXT;

-- Backfill: resolve each conversation's root by walking the in_reply_to chain,
-- then stamp every message in the chain with the root id as its thread_id.
WITH RECURSIVE chain AS (
  SELECT id, in_reply_to, id AS root
  FROM emails
  WHERE in_reply_to IS NULL
  UNION ALL
  SELECT e.id, e.in_reply_to, c.root
  FROM emails e
  JOIN chain c ON e.in_reply_to = c.id
)
UPDATE emails SET thread_id = chain.root
FROM chain
WHERE emails.id = chain.id;

-- Orphans (reply whose parent no longer exists) become their own thread root.
UPDATE emails SET thread_id = id WHERE thread_id IS NULL;

CREATE INDEX "emails_thread_id_idx" ON "emails"("thread_id");
