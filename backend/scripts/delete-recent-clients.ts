/**
 * One-off: delete the N most recently created clients (and cascade their contacts/tags/etc.).
 * Usage:  cd backend && npx tsx scripts/delete-recent-clients.ts <count> [--confirm]
 *
 * Default: dry-run lists the matches. Add --confirm to actually delete.
 * Cascade-deletes contacts/tags/locations etc. automatically per the Prisma schema.
 */
import prisma from '../src/config/database';

async function main() {
  const args = process.argv.slice(2);
  const count = Number(args.find((a) => !a.startsWith('--')) ?? '10');
  const confirm = args.includes('--confirm');

  if (!Number.isFinite(count) || count <= 0 || count > 100) {
    console.error('Usage: npx tsx scripts/delete-recent-clients.ts <count between 1 and 100> [--confirm]');
    process.exit(1);
  }

  const matches = await prisma.client.findMany({
    orderBy: { createdAt: 'desc' },
    take: count,
    select: {
      id: true,
      name: true,
      industry: true,
      importSourceId: true,
      createdAt: true,
      _count: { select: { contacts: true, leads: true, calls: true, emails: true } },
    },
  });

  if (matches.length === 0) {
    console.log('No clients found.');
    return;
  }

  console.log(`Last ${matches.length} client(s) by createdAt:`);
  for (const c of matches) {
    const flags: string[] = [];
    if (c._count.leads) flags.push(`leads=${c._count.leads}`);
    if (c._count.calls) flags.push(`calls=${c._count.calls}`);
    if (c._count.emails) flags.push(`emails=${c._count.emails}`);
    const flagStr = flags.length ? ` ⚠️ ${flags.join(' ')}` : '';
    console.log(
      `  - ${c.createdAt.toISOString()}  name="${c.name}"  industry="${c.industry ?? ''}"  importSourceId=${c.importSourceId ?? '∅'}  contacts=${c._count.contacts}${flagStr}  id=${c.id}`,
    );
  }

  if (!confirm) {
    console.log('\nDRY RUN. Re-run with --confirm to actually delete:');
    console.log(`  npx tsx scripts/delete-recent-clients.ts ${count} --confirm`);
    return;
  }

  console.log('\nDeleting...');
  for (const c of matches) {
    await prisma.client.delete({ where: { id: c.id } });
    console.log(`  ✓ deleted ${c.id} ("${c.name}")`);
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
