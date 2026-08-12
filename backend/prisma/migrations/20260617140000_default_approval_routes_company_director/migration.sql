-- Default client approval routes use Company Director (per agency), not org Director.
UPDATE agency_approval_policies
SET workflows = (
  SELECT jsonb_object_agg(
    kv.key,
    CASE
      WHEN kv.key IN ('client_manual_add', 'client_manual_edit')
        AND kv.value->>'mode' = 'route'
        AND kv.value ? 'route'
      THEN jsonb_set(
        kv.value,
        '{route}',
        (
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
      )
      ELSE kv.value
    END
  )
  FROM jsonb_each(workflows::jsonb) AS kv
)
WHERE workflows::text LIKE '%"director"%';
