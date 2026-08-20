-- Wipes ALL data from the database except:
--   - the super admin user (hassan@wudox.ca)
--   - RBAC tables (rbac_roles / rbac_permissions / role_permissions) so login + permissions keep working
--   - _prisma_migrations (so Prisma migration state stays intact)
--
-- Usage (local docker):
--   docker exec -i wudox_crm_postgres psql -U postgres -d wudox_crm < backend/scripts/wipe-all-keep-super-admin.sql

BEGIN;

-- Skip FK enforcement so tables can be cleared in any order (requires superuser).
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'users',
        'rbac_roles',
        'rbac_permissions',
        'role_permissions',
        '_prisma_migrations'
      )
  LOOP
    EXECUTE format('DELETE FROM %I', t);
  END LOOP;
END $$;

DELETE FROM users WHERE email <> 'hassan@wudox.ca';

-- Null out references to now-empty tables so the kept row doesn't dangle.
UPDATE users
SET sub_company_id = NULL,
    location_id = NULL,
    email_forwarding_to_user_id = NULL,
    reporting_manager_ids = '{}'
WHERE email = 'hassan@wudox.ca';

COMMIT;
