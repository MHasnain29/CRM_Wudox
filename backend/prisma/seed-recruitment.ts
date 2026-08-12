/**
 * Standalone recruitment demo seed (Active Clients, Jobs, Employees, placements).
 *
 * Unlike the full `prisma/seed.ts` (which resets everything), this script:
 *   1. Wipes ONLY the recruitment domain tables (employee assignments, job roster,
 *      employees + child rows, jobs, active clients) plus orphan approval steps
 *      and recruitment-related notifications.
 *   2. Re-seeds them against the EXISTING agencies and users in the database.
 *
 * Run with: npm run prisma:seed-recruitment
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedRecruitmentDemo } from './seedRecruitmentDemo';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const seedNow = new Date();

function daysFromSeed(days: number, hour = 10): Date {
  const date = new Date(seedNow.getTime() + days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function findUserByRole(roles: string[], subCompanyId?: string) {
  for (const role of roles) {
    const user = await prisma.user.findFirst({
      where: {
        role,
        isActive: true,
        ...(subCompanyId ? { subCompanyId } : {}),
      },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    if (user) return user;
  }
  return null;
}

const RECRUITMENT_NOTIFICATION_TYPES = [
  'job_closed',
  'job_filled',
  'job_reopened',
  'job_placement_added',
  'job_placement_ended',
  'employee_data_received',
] as const;

async function main() {
  // ── Resolve agency ──────────────────────────────────────────────────────────
  const subCompanies = await prisma.subCompany.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  if (subCompanies.length === 0) {
    throw new Error('No sub companies found. Run the full seed first (npm run prisma:seed).');
  }

  const agency =
    subCompanies.find((s) => s.name.toLowerCase().includes('mississauga')) ??
    subCompanies.find((s) => s.name.toLowerCase().includes('toronto')) ??
    subCompanies[0]!;

  // ── Resolve users ───────────────────────────────────────────────────────────
  const recruiter1 =
    (await findUserByRole(['recruiter', 'sr_recruiter'], agency.id)) ??
    (await findUserByRole(['recruiter', 'sr_recruiter']));
  const srRecruiter =
    (await findUserByRole(['sr_recruiter'], agency.id)) ?? recruiter1;
  const pakistanUser =
    (await findUserByRole(['recruiter'], agency.id)) ?? recruiter1;
  const recruitmentManager =
    (await findUserByRole(['recruitment_manager'], agency.id)) ??
    (await findUserByRole(['recruitment_manager'])) ??
    (await findUserByRole(['director', 'super_admin']));

  if (!recruiter1 || !recruitmentManager) {
    throw new Error(
      'Could not find recruiter / recruitment manager users. Run the full seed first (npm run prisma:seed).',
    );
  }

  console.log(`🏢 Agency: "${agency.name}"`);
  console.log(`👤 Recruiter: ${recruiter1.email} · RM: ${recruitmentManager.email}`);

  // ── Wipe recruitment domain ─────────────────────────────────────────────────
  console.log('🧹 Clearing existing recruitment data (employees, jobs, active clients)...');

  const [employees, assignments, jobs] = await Promise.all([
    prisma.employee.findMany({ select: { id: true } }),
    prisma.employeeAssignment.findMany({ select: { id: true } }),
    prisma.job.findMany({ select: { id: true } }),
  ]);
  const relatedIds = [
    ...employees.map((e) => e.id),
    ...assignments.map((a) => a.id),
    ...jobs.map((j) => j.id),
  ];

  const approvalStepsDeleted = await prisma.approvalStep.deleteMany({
    where: {
      OR: [
        { workflow: { in: ['employee_add', 'employee_assignment'] } },
        { entityType: { in: ['employees', 'employee_assignments'] } },
      ],
    },
  });

  const notificationsDeleted = await prisma.notification.deleteMany({
    where: {
      OR: [
        { type: { in: [...RECRUITMENT_NOTIFICATION_TYPES] } },
        ...(relatedIds.length > 0 ? [{ relatedId: { in: relatedIds } }] : []),
        { link: { startsWith: '/employees' } },
        { link: { startsWith: '/jobs' } },
      ],
    },
  });

  await prisma.employeeAssignment.deleteMany({});
  await prisma.jobAssignment.deleteMany({});
  await prisma.employeeTraining.deleteMany({});
  await prisma.employeeDocument.deleteMany({});
  await prisma.employeeNote.deleteMany({});
  await prisma.employeeTag.deleteMany({});
  await prisma.employeeWorkExperience.deleteMany({});
  const employeesDeleted = await prisma.employee.deleteMany({});
  const jobsDeleted = await prisma.job.deleteMany({});
  const activeClientsDeleted = await prisma.activeClient.deleteMany({});

  console.log(
    `   wiped: ${employeesDeleted.count} employees, ${jobsDeleted.count} jobs, ` +
      `${activeClientsDeleted.count} active clients, ` +
      `${approvalStepsDeleted.count} approval steps, ${notificationsDeleted.count} notifications`,
  );

  // ── Re-seed ─────────────────────────────────────────────────────────────────
  const counts = await seedRecruitmentDemo(prisma, {
    recruiter1,
    srRecruiter: srRecruiter ?? recruiter1,
    pakistanUser: pakistanUser ?? recruiter1,
    recruitmentManager,
    subCompanyTorontoId: agency.id,
    daysFromSeed,
  });

  console.log('\n✅ Recruitment demo data seeded:');
  console.log(`   - Active Clients: ${counts.activeClientCount}`);
  console.log(`   - Jobs: ${counts.jobCount}`);
  console.log(`   - Employees: ${counts.employeeCount}`);
  console.log(`   - Job roster rows: ${counts.jobAssignmentCount}`);
  console.log(`   - Employee assignments: ${counts.employeeAssignmentCount}`);
}

main()
  .catch((error) => {
    console.error('❌ Recruitment seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
