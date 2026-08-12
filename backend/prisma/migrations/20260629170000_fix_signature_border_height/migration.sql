-- Fix: use display:block so personal signature renders below (not beside) the agency block
UPDATE "sub_companies"
SET "email_signature_template" = $tmpl$<div style="font-family:Arial,sans-serif;border-left:3px solid #3b5bdb;padding-left:12px;">
  <p style="margin:0 0 1px 0;font-size:14px;font-weight:700;color:#111827;line-height:1.3;">{{sender_name}}</p>
  <p style="margin:0 0 1px 0;font-size:11px;color:#6b7280;line-height:1.3;">{{sender_title}}</p>
  <p style="margin:0 0 8px 0;font-size:11px;color:#6b7280;font-weight:600;line-height:1.3;">{{agency_name}}</p>
  <p style="margin:0 0 1px 0;font-size:11px;color:#9ca3af;line-height:1.3;">{{sender_phone}}</p>
  <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.3;">{{sender_email}}</p>
</div>
{{sender_signature}}$tmpl$
WHERE "email_signature_template" IS NOT NULL;
