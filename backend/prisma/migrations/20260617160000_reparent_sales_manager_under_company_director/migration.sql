-- Sales Manager reports to Company Director (per-agency sales leadership).
UPDATE rbac_roles sm
SET parent_role_id = cd.id
FROM rbac_roles cd
WHERE sm.key = 'sales_manager'
  AND cd.key = 'company_director';
