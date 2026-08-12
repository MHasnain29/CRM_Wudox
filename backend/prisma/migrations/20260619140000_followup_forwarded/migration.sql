-- Add forwarded_from_user_id to follow_ups for offboarding chip support
ALTER TABLE follow_ups ADD COLUMN forwarded_from_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_follow_ups_forwarded_from ON follow_ups(forwarded_from_user_id);
