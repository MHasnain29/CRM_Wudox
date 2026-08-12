-- Replace random job_code (e.g. JOB-C07C3D) with 6-digit sequential codes
-- starting at 000001, allocated via a DB sequence.

CREATE SEQUENCE IF NOT EXISTS "jobs_job_code_seq";

-- Re-number all existing jobs in creation order.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "created_at" ASC, id ASC) AS rn
  FROM "jobs"
)
UPDATE "jobs" j
SET "job_code" = LPAD(o.rn::text, 6, '0')
FROM ordered o
WHERE j.id = o.id;

-- Next nextval() returns max existing + 1 (or 1 when empty).
SELECT setval(
  'jobs_job_code_seq',
  COALESCE(
    (
      SELECT MAX("job_code"::integer)
      FROM "jobs"
      WHERE "job_code" ~ '^\d+$'
    ),
    0
  ) + 1,
  false
);
