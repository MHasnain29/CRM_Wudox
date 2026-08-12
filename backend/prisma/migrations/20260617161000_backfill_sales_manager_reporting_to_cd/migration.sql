-- Sales Managers in agencies with a Company Director should report to CD, not org Director.
UPDATE users sm
SET reporting_manager_ids = ARRAY[cd.id]
FROM users cd
WHERE sm.role = 'sales_manager'
  AND sm.is_active = true
  AND cd.role = 'company_director'
  AND cd.is_active = true
  AND cd.sub_company_id = sm.sub_company_id
  AND EXISTS (
    SELECT 1
    FROM users d
    WHERE d.role = 'director'
      AND d.is_active = true
      AND d.id = ANY(sm.reporting_manager_ids)
  )
  AND NOT (cd.id = ANY(sm.reporting_manager_ids));
