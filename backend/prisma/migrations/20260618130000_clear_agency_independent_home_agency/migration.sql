-- Org-wide roles must not have a home agency (sub_company_id / location_id).
UPDATE users
SET sub_company_id = NULL,
    location_id = NULL
WHERE role IN (
  'super_admin',
  'director',
  'operations_manager',
  'data_entry_specialist',
  'database_manager'
)
AND (sub_company_id IS NOT NULL OR location_id IS NOT NULL);
