-- Backfill: grant meetings:add_participants to every role (all users by default).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, add_perm.id
FROM "rbac_roles" r
CROSS JOIN "rbac_permissions" add_perm
WHERE add_perm.key = 'meetings:add_participants'
ON CONFLICT DO NOTHING;
