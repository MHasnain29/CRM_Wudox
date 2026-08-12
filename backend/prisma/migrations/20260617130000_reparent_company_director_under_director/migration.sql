-- Company Director reports to Director (per-agency director, same org level as Operations Manager).

UPDATE "rbac_roles" cd
SET
  "parent_role_id" = d.id,
  "sort_order" = 25,
  "description" = 'Per-agency director; full access for one company (no cross-org)',
  "updated_at" = NOW()
FROM "rbac_roles" d
WHERE cd.key = 'company_director'
  AND d.key = 'director';

-- Restore IT sort order under super_admin (no longer competing with company_director).
UPDATE "rbac_roles"
SET "sort_order" = 3, "updated_at" = NOW()
WHERE "key" = 'it' AND "sort_order" > 3;
