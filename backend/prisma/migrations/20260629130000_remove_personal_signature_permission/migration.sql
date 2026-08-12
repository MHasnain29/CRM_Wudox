-- Remove email:personal_signature permission — all users can manage their own signature without restriction
DELETE FROM "role_permissions" WHERE permission_id IN (
  SELECT id FROM "rbac_permissions" WHERE key = 'email:personal_signature'
);
DELETE FROM "rbac_permissions" WHERE key = 'email:personal_signature';
