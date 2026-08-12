/**
 * One-time script: strips legacy inline signature blocks from existing email templates.
 * Run once after deploying the auto-append footer feature:
 *   npx tsx backend/scripts/normalizeEmailTemplateSignatures.ts
 *
 * The send path now always appends "Best regards, [name+sig]" automatically,
 * so these blocks in template bodies would cause duplicate signatures.
 */
import prisma from '../src/config/database';

const PATTERNS_TO_STRIP = [
  // emailSignature block: <p ...>Best regards,<br><strong>{{sender_name}}</strong>...</p>
  /<p[^>]*>\s*Best regards,\s*<br\s*\/?>\s*<strong>\{\{sender_name\}\}<\/strong>[\s\S]*?<\/p>/gi,
  // Simple "Best,\n{{sender_name}}" block
  /<p[^>]*>\s*Best,\s*<br\s*\/?>\s*<strong>\{\{sender_name\}\}<\/strong>\s*<\/p>/gi,
  // "Regards,\n{{sender_name}}\n{{sender_title}}" block
  /<p[^>]*>\s*Regards,\s*<br\s*\/?>\s*<strong>\{\{sender_name\}\}<\/strong>[\s\S]*?<\/p>/gi,
];

async function main() {
  const templates = await prisma.emailTemplate.findMany({ select: { id: true, name: true, bodyHtml: true } });
  let updated = 0;

  for (const t of templates) {
    if (!t.bodyHtml) continue;
    let body = t.bodyHtml;
    for (const pattern of PATTERNS_TO_STRIP) {
      body = body.replace(pattern, '');
    }
    if (body !== t.bodyHtml) {
      await prisma.emailTemplate.update({ where: { id: t.id }, data: { bodyHtml: body } });
      console.log(`✅ Updated: ${t.name}`);
      updated++;
    }
  }

  console.log(`\nDone. ${updated}/${templates.length} templates updated.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
