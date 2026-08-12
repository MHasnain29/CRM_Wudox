-- Vancouver agency: add Company Director when missing, then point Sales Managers at agency CD.
WITH vancouver AS (
  SELECT id FROM sub_companies WHERE name ILIKE '%Vancouver%' LIMIT 1
),
org_director AS (
  SELECT id FROM users WHERE role = 'director' AND is_active = true ORDER BY created_at ASC LIMIT 1
),
cd_role AS (
  SELECT id FROM rbac_roles WHERE key = 'company_director' AND is_active = true LIMIT 1
),
password_ref AS (
  SELECT password_hash FROM users WHERE email = 'company.director@nastaffing.com' AND is_active = true LIMIT 1
),
inserted AS (
  INSERT INTO users (
    id,
    email,
    password_hash,
    first_name,
    last_name,
    phone,
    country,
    role,
    role_id,
    user_type,
    sub_company_id,
    reporting_manager_ids,
    accessible_location_ids,
    is_active,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    'company.director.vancouver@nastaffing.com',
    (SELECT password_hash FROM password_ref),
    'Emily',
    'Nguyen',
    '+1-604-555-0108',
    'Canada',
    'company_director',
    (SELECT id FROM cd_role),
    'Company Director',
    v.id,
    ARRAY[(SELECT id FROM org_director)]::text[],
    '{}',
    true,
    NOW(),
    NOW()
  FROM vancouver v
  WHERE (SELECT password_hash FROM password_ref) IS NOT NULL
    AND (SELECT id FROM org_director) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM users u
      WHERE u.role = 'company_director'
        AND u.sub_company_id = v.id
        AND u.is_active = true
    )
  RETURNING id, sub_company_id
)
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
