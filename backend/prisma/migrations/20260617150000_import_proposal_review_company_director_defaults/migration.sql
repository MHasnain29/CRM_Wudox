-- Client CSV import and proposal review default to Sales Manager → Company Director.
UPDATE agency_approval_policies
SET workflows = (
  SELECT jsonb_object_agg(
    kv.key,
    CASE
      WHEN kv.key IN ('client_manual_add', 'client_manual_edit', 'client_import', 'proposal_review')
        AND kv.value->>'mode' = 'route'
        AND kv.value ? 'route'
      THEN jsonb_set(
        kv.value,
        '{route}',
        CASE
          WHEN jsonb_array_length(kv.value->'route') = 1
            AND kv.value->'route'->0 = '"sales_manager"'
          THEN '["sales_manager", "company_director"]'::jsonb
          ELSE (
            SELECT COALESCE(
              jsonb_agg(
                to_jsonb(
                  CASE
                    WHEN elem #>> '{}' = 'director' THEN 'company_director'
                    ELSE elem #>> '{}'
                  END
                )
              ),
              '[]'::jsonb
            )
            FROM jsonb_array_elements(kv.value->'route') AS elem
          )
        END
      )
      ELSE kv.value
    END
  )
  FROM jsonb_each(workflows::jsonb) AS kv
)
WHERE workflows::text LIKE '%"sales_manager"%';
