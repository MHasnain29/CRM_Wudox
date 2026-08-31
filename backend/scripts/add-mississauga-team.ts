/**
 * Add a dummy Mississauga sales team under the existing org Director.
 * Same action as Settings → Danger Zone → Seed Mississauga team.
 *
 * Usage (from backend/):
 *   npx tsx scripts/add-mississauga-team.ts
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { seedMississaugaTeam } from '../src/services/dangerousAdminSeedTeam';

async function main() {
  const result = await seedMississaugaTeam();
  console.log(`Agency   : ${result.agencyName}`);
  console.log(`Director : ${result.directorName} <${result.directorEmail}>`);
  console.log(`Location : ${result.locationName}`);
  console.log('');
  console.log('Result');
  console.log('------');
  for (const row of result.rows) {
    console.log(`  ${row.action.padEnd(46)}  ${row.name}  <${row.email}>  (${row.role})`);
  }
  console.log('');
  console.log(`Password for new / marketing user: ${result.password}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
