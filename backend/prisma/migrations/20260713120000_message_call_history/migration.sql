-- Internal chat call history: typed messages with optional metadata JSON
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
