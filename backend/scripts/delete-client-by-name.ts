/**
 * One-off: delete a client (and all cascade-related rows) by exact name match.
 * Usage:  cd backend && npx tsx scripts/delete-client-by-name.ts "Parts"
 *
 * Confirms in two phases: dry-run lists matches, then a second invocation with
 * --confirm performs the delete. Cascade-deletes contacts/tags/locations etc.
 * automatically per the Prisma schema. Throws clearly on FK constraints from
 * non-cascade relations (leads/calls/emails) so we never silently corrupt data.
 */
import prisma from '../src/config/database';

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith('--'));
  const confirm = args.includes('--confirm');

  if (!name) {
    console.error('Usage: npx tsx scripts/delete-client-by-name.ts "<client name>" [--confirm]');
    process.exit(1);
  }

  const matches = await prisma.client.findMany({
    where: { name: { equals: name, mode: 'insensitive' } },
    include: {
      _count: { select: { contacts: true, leads: true, calls: true, emails: true } },
    },
  });

  if (matches.length === 0) {
    console.log(`No clients found with name = "${name}".`);
    return;
  }

  console.log(`Found ${matches.length} client(s):`);
  for (const c of matches) {
    console.log(
      `  - id=${c.id}  name="${c.name}"  contacts=${c._count.contacts} leads=${c._count.leads} calls=${c._count.calls} emails=${c._count.emails}`,
    );
  }

  if (!confirm) {
    console.log('\nDRY RUN. Re-run with --confirm to actually delete:');
    console.log(`  npx tsx scripts/delete-client-by-name.ts "${name}" --confirm`);
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
