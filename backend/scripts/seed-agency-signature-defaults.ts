/**
 * Persist the universal Executive agency signature for agencies that have none saved.
 *
 * Runtime send already falls back to this default — this script only writes it into
 * the DB so Settings shows it as saved per agency.
 *
 * Usage:
 *   npx tsx scripts/seed-agency-signature-defaults.ts
 *   npx tsx scripts/seed-agency-signature-defaults.ts --dry-run
 *   npx tsx scripts/seed-agency-signature-defaults.ts --force   # overwrite existing too
 */
import '../src/loadEnv';
import prisma from '../src/config/database';
import {
  buildSignatureHtmlFromConfig,
  DEFAULT_SIGNATURE_CONFIG,
} from '../src/services/signatureHtml';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  const agencies = await prisma.subCompany.findMany({
    select: {
      id: true,
      name: true,
      emailSignatureTemplate: true,
      emailSignatureConfig: true,
    },
    orderBy: { name: 'asc' },
  });

  const html = buildSignatureHtmlFromConfig(DEFAULT_SIGNATURE_CONFIG);
  const config = { ...DEFAULT_SIGNATURE_CONFIG };

  let updated = 0;
  let skipped = 0;

  for (const a of agencies) {
    const hasSaved =
      a.emailSignatureConfig != null ||
      !!(a.emailSignatureTemplate && a.emailSignatureTemplate.trim());
    if (hasSaved && !force) {
      skipped += 1;
      console.log(`skip  ${a.name} (already has signature)`);
      continue;
    }
    console.log(`${dryRun ? 'would update' : 'update'}  ${a.name}`);
    if (!dryRun) {
      await prisma.subCompany.update({
        where: { id: a.id },
        data: {
          emailSignatureConfig: config,
          emailSignatureTemplate: html,
        },
      });
    }
    updated += 1;
  }

  console.log(
    `\nDone. ${dryRun ? 'Would update' : 'Updated'}: ${updated}, skipped: ${skipped}, total: ${agencies.length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
