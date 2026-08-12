-- Assign employees:offboard permission to super_admin, director, company_director, operations_manager
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "rbac_roles" r
CROSS JOIN "rbac_permissions" p
WHERE r.key IN ('super_admin', 'director', 'company_director', 'operations_manager')
  AND p.key = 'employees:offboard'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
