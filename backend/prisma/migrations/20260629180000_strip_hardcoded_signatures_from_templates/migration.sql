-- Remove hardcoded signature blocks from email template bodies.
-- The backend now auto-injects the agency signature at send time.

-- Strip the exact signature pattern injected by emailStarterTemplates.ts
UPDATE "email_templates"
SET "body_html" = regexp_replace(
  "body_html",
  '<p[^>]*>Best regards,<br\s*/?><strong>\{\{sender_name\}\}</strong><br\s*/?><span[^>]*>\{\{sender_title\}\}</span><br\s*/?><span[^>]*>\{\{sender_phone\}\}[^<]*\{\{sender_email\}\}</span></p>',
  '',
  'gi'
)
WHERE "body_html" ILIKE '%Best regards%'
  AND "body_html" ILIKE '%{{sender_name}}%';

-- Also strip looser patterns: plain "Best regards," paragraphs near sender placeholders
UPDATE "email_templates"
SET "body_html" = regexp_replace(
  "body_html",
  '<p[^>]*>\s*(Best regards|Best,|Regards,|Warm regards,|See you soon,)[,]?\s*<br\s*/?>\s*<strong>\{\{sender_name\}\}</strong>.*?</p>',
  '',
  'gis'
)
WHERE "body_html" ~* '(Best regards|Best,|Regards,|Warm regards,|See you soon,)';
