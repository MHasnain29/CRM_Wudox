/**
 * Verify Option A PandaDoc agency template scoping against the DB.
 * Run: npx tsx scripts/verify-pandadoc-agency-templates.ts
 */
import prisma from '../src/config/database';
import {
  filterTemplatesByAllowedIds,
  getAllowedPandaDocTemplateIds,
  getAllowedPandaDocTemplateIdsForAgencies,
  getPandaDocTemplateAgencyLabels,
} from '../src/services/pandadoc/agencyTemplates';

async function main() {
  const agencies = await prisma.subCompany.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  console.log(`Agencies: ${agencies.length}`);

  const perAgency: { name: string; id: string; ids: string[] }[] = [];
  for (const a of agencies) {
    const ids = await getAllowedPandaDocTemplateIds(a.id);
    perAgency.push({ name: a.name, id: a.id, ids });
    console.log(`  ${a.name}: ${ids.length} mapped template(s) → ${ids.join(', ') || '(none)'}`);
  }

  const allIds = await getAllowedPandaDocTemplateIdsForAgencies(agencies.map((a) => a.id));
  const unionManual = new Set(perAgency.flatMap((p) => p.ids));
  const unionOk =
    allIds.length === unionManual.size && allIds.every((id) => unionManual.has(id));
  console.log(`\nUnion all agencies: ${allIds.length} unique id(s)`);
  console.log(unionOk ? 'PASS union matches per-agency merge' : 'FAIL union mismatch');

  const labels = await getPandaDocTemplateAgencyLabels(agencies.map((a) => a.id));
  for (const [tid, list] of labels) {
    if (list.length > 1) {
      console.log(`  shared template ${tid.slice(0, 8)}… → ${list.map((x) => x.name).join(' + ')}`);
    }
  }

  // Fail-closed unit checks
  const empty = await getAllowedPandaDocTemplateIds('00000000-0000-0000-0000-000000000000');
  console.log(empty.length === 0 ? 'PASS unknown agency → []' : 'FAIL unknown agency');

  const filtered = filterTemplatesByAllowedIds(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    ['b', 'c', 'b'],
  );
  console.log(
    filtered.map((t) => t.id).join(',') === 'b,c' ? 'PASS filter + dedupe source' : 'FAIL filter',
  );

  const withNone = filterTemplatesByAllowedIds([{ id: 'a' }], []);
  console.log(withNone.length === 0 ? 'PASS empty allowlist → []' : 'FAIL empty allowlist');

  // Agencies with zero mappings should not enlarge the union incorrectly
  const zeroAgencies = perAgency.filter((p) => p.ids.length === 0);
  console.log(`Agencies with no mapping: ${zeroAgencies.map((z) => z.name).join(', ') || '(none)'}`);

  if (!unionOk) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
