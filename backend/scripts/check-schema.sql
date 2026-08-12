SELECT column_name FROM information_schema.columns
WHERE table_name = 'documents' AND column_name IN ('sub_company_id', 'is_public');
