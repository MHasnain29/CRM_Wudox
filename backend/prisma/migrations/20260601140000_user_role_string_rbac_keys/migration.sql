-- Allow dynamic RBAC role keys on users (e.g. custom roles from Settings → Roles).
ALTER TABLE "users" ALTER COLUMN "role" TYPE VARCHAR(64) USING "role"::text;

ALTER TABLE "ip_restriction_rules" ALTER COLUMN "role" TYPE VARCHAR(64) USING "role"::text;

ALTER TABLE "client_notes" ALTER COLUMN "user_role" TYPE VARCHAR(64) USING "user_role"::text;

DROP TYPE IF EXISTS "UserRole";
