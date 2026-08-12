-- Add signing_authorities table
CREATE TABLE signing_authorities (
  id            TEXT NOT NULL,
  sub_company_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  font_family   TEXT NOT NULL,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT signing_authorities_pkey PRIMARY KEY (id),
  CONSTRAINT signing_authorities_sub_company_id_fkey
    FOREIGN KEY (sub_company_id) REFERENCES sub_companies(id) ON DELETE CASCADE
);

CREATE INDEX signing_authorities_sub_company_id_idx ON signing_authorities(sub_company_id);

-- Enforce at most one primary per agency at the DB level
CREATE UNIQUE INDEX signing_authorities_one_primary_per_agency
  ON signing_authorities(sub_company_id)
  WHERE is_primary = true;
