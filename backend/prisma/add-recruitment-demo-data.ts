/**
 * ADDITIVE recruitment demo data — Active Clients, Jobs, and Candidates (Employees),
 * owned by different recruiters so the per-user ("my records") filtering on the
 * recruitment pages has varied data to show.
 *
 * SAFETY:
 *   - Only CREATES rows. Never deletes, updates, truncates, or resets anything.
 *   - Idempotent: each section (clients/jobs, candidates) has its OWN skip check,
 *     so re-running never duplicates and can top up a section added later.
 *   - Touches ONLY the recruitment domain (active_clients, jobs, employees).
 *
 * Run with:  npx tsx prisma/add-recruitment-demo-data.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CLIENT_MARKER = 'seed:rec-owner-demo';           // active_clients.notes
const CAND_MARKER = 'rec.owner.demo';                  // token inside employees.email
const RECRUITMENT_ROLES = ['recruiter', 'sr_recruiter', 'recruitment_manager'];

const COMPANY_NAMES = [
  'Northwind Logistics', 'Maple Foods Group', 'Summit Manufacturing', 'Harbour Hospitality',
  'Cedar Retail Partners', 'Ironclad Construction', 'BlueRiver Healthcare', 'Pinnacle Warehousing',
  'Evergreen Distribution', 'Granite Industrial', 'Lakeshore Staffing Clients', 'Vertex Assembly',
];
const INDUSTRIES = [
  'Logistics', 'Food & Beverage', 'Manufacturing', 'Hospitality',
  'Retail', 'Construction', 'Healthcare', 'Warehousing',
];
const LOCATIONS = [
  'Toronto, ON', 'Mississauga, ON', 'Brampton, ON', 'Vancouver, BC',
  'Calgary, AB', 'Montreal, QC', 'Edmonton, AB', 'Hamilton, ON',
];
const JOB_TITLES = [
  'Warehouse Associate', 'Forklift Operator', 'Machine Operator', 'General Labourer',
  'Order Picker', 'Production Worker', 'Shipping Clerk', 'Assembler',
  'Quality Inspector', 'Line Cook', 'Cleaner', 'Delivery Driver',
];
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'temporary'] as const;

const CAND_FIRST = [
  'Noah', 'Olivia', 'Ethan', 'Ava', 'Lucas', 'Mia', 'Mason', 'Isla',
  'Leo', 'Zara', 'Omar', 'Priya', 'Jai', 'Sana', 'Diego', 'Nina',
  'Yusuf', 'Amara', 'Ivan', 'Lena', 'Kofi', 'Rina', 'Tariq', 'Elsa',
];
const CAND_LAST = [
  'Brown', 'Wilson', 'Patel', 'Nguyen', 'Garcia', 'Khan', 'Silva', 'Ali',
  'Chen', 'Reyes', 'Osei', 'Kaur', 'Haddad', 'Novak', 'Mensah', 'Costa',
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { role: { in: RECRUITMENT_ROLES }, isActive: true, subCompanyId: { not: null } },
    select: { id: true, firstName: true, lastName: true, role: true, subCompanyId: true },
    orderBy: { createdAt: 'asc' },
  });

  if (users.length === 0) {
    console.log('No active recruitment users (recruiter / sr_recruiter / recruitment_manager) found. Nothing created.');
    return;
  }

  console.log(`Found ${users.length} recruitment user(s). Adding demo clients, jobs, and candidates owned by each...\n`);

  let clientsCreated = 0;
  let jobsCreated = 0;
  let candsCreated = 0;
  let skippedClients = 0;
  let skippedCands = 0;

  for (let u = 0; u < users.length; u++) {
    const user = users[u]!;
    const subCompanyId = user.subCompanyId!;
    const parts: string[] = [];

    // ── Active Clients + Jobs ────────────────────────────────────────────────
    const hasClients = await prisma.activeClient.count({
      where: { createdById: user.id, notes: CLIENT_MARKER },
    });
    if (hasClients > 0) {
      skippedClients++;
      parts.push('clients: already present');
    } else {
      for (let c = 0; c < 2; c++) {
        const idx = u * 2 + c;
        const client = await prisma.activeClient.create({
          data: {
            name: `${pick(COMPANY_NAMES, idx)} — ${user.firstName}`,
            industry: pick(INDUSTRIES, idx),
            location: pick(LOCATIONS, idx),
            contactName: `${user.firstName}'s Contact ${c + 1}`,
            contactEmail: `contact${idx}@example.com`,
            contactPhone: `+1416555${String(1000 + idx).padStart(4, '0')}`,
            status: 'active',
            notes: CLIENT_MARKER,
            subCompanyId,
            createdById: user.id,
          },
        });
        clientsCreated++;
        for (let j = 0; j < 2; j++) {
          const jIdx = idx * 2 + j;
          await prisma.job.create({
            data: {
              jobType: 'external',
              title: pick(JOB_TITLES, jIdx),
              company: client.name,
              location: client.location,
              description: `Demo job for ${client.name}. Owned by ${user.firstName} ${user.lastName}.`,
              requirements: 'Reliable, punctual, able to work scheduled shifts.',
              responsibilities: 'Perform assigned duties safely and to standard.',
              openPositions: 1 + (jIdx % 3),
              status: 'open',
              employmentType: pick([...EMPLOYMENT_TYPES], jIdx),
              subCompanyId,
              activeClientId: client.id, // linked so it appears on Job Matches
              createdById: user.id,
            },
          });
          jobsCreated++;
        }
      }
      parts.push('+2 clients, +4 jobs');
    }

    // ── Candidates (Master / available) ──────────────────────────────────────
    const hasCands = await prisma.employee.count({
      where: { addedById: user.id, email: { contains: CAND_MARKER } },
    });
    if (hasCands > 0) {
      skippedCands++;
      parts.push('candidates: already present');
    } else {
      for (let k = 0; k < 3; k++) {
        const idx = u * 3 + k;
        await prisma.employee.create({
          data: {
            firstName: pick(CAND_FIRST, idx),
            lastName: `${pick(CAND_LAST, idx)} (${user.firstName})`,
            phone: `+1647555${String(2000 + idx).padStart(4, '0')}`,
            email: `cand.${idx}.${CAND_MARKER}@example.com`,
            city: pick(LOCATIONS, idx).split(',')[0],
            province: 'ON',
            country: 'Canada',
            employeeType: 'external',
            approvalStatus: 'approved', // shows in Master + Job Matches candidate pool
            workStatus: 'none',         // available (not placed)
            skills: ['General Labour', 'Warehouse'],
            addedById: user.id,
          },
        });
        candsCreated++;
      }
      parts.push('+3 candidates');
    }

    console.log(`- ${user.firstName} ${user.lastName} (${user.role}) — ${parts.join('; ')}.`);
  }

  console.log(
    `\nDone. Created ${clientsCreated} clients, ${jobsCreated} jobs, ${candsCreated} candidates.` +
    ` Skipped clients for ${skippedClients} user(s), candidates for ${skippedCands} user(s).`,
  );
  console.log(`\nTo remove later (children first):`);
  console.log(`  jobs:       prisma.job.deleteMany({ where: { activeClient: { notes: '${CLIENT_MARKER}' } } })`);
  console.log(`  clients:    prisma.activeClient.deleteMany({ where: { notes: '${CLIENT_MARKER}' } })`);
  console.log(`  candidates: prisma.employee.deleteMany({ where: { email: { contains: '${CAND_MARKER}' } } })`);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
