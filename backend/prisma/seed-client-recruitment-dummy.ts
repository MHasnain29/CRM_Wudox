/**
 * Dummy recruitment seed (Active Clients / Jobs / Employees).
 *
 * Unlike `seed-client-recruitment-demo` (real client package fixtures), this
 * script loads purely fictional data — no Recruitment_Demo_Data PDFs or
 * real company names.
 *
 * Wipes ONLY recruitment domain tables, then reseeds.
 * Requires agencies + users from a prior full seed (npm run prisma:seed).
 *
 * Run: npm run prisma:seed-client-recruitment-dummy
 */
import 'dotenv/config';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_BACKUP_PERCENTAGE,
  DUMMY_ACTIVE_CLIENTS,
  DUMMY_DEFAULT_TRAININGS,
  DUMMY_EMPLOYEES,
  DUMMY_JOBS,
  DUMMY_REQUIRED_DOC_TYPES,
} from './clientRecruitmentDummyData';

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

async function wipeRecruitmentDomain() {
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

  // Child rows first (client training snapshots → assignments → roster → employees/jobs/clients)
  await prisma.activeClientTrainingAssignment.deleteMany({});
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
}

async function nextJobCode(startFrom: number): Promise<{ code: string; next: number }> {
  return {
    code: String(startFrom).padStart(6, '0'),
    next: startFrom + 1,
  };
}

async function seedPlaceholderDocs(params: {
  employeeId: string;
  uploadedById: string;
  includeAgreement: boolean;
}) {
  const { employeeId, uploadedById, includeAgreement } = params;
  const seedUrl = `seed://employees/${employeeId}/dummy-package.pdf`;
  const fileSize = 12_000;

  for (const doc of DUMMY_REQUIRED_DOC_TYPES) {
    if (!includeAgreement && doc.type === 'agreement') continue;
    await prisma.employeeDocument.create({
      data: {
        employeeId,
        type: doc.type,
        name: doc.name,
        fileName: doc.fileName,
        fileSize,
        mimeType: 'application/pdf',
        url: seedUrl,
        uploadedById,
      },
    });
  }

  return { seedUrl, fileSize };
}

async function seedCompletedTrainings(params: {
  employeeId: string;
  uploadedById: string;
  seedUrl: string;
  fileSize: number;
  hireDaysAgo: number;
}) {
  const { employeeId, uploadedById, seedUrl, fileSize, hireDaysAgo } = params;
  const sentAt = daysFromSeed(-hireDaysAgo - 3, 10);
  const completedAt = daysFromSeed(-hireDaysAgo - 1, 14);

  for (const def of DUMMY_DEFAULT_TRAININGS) {
    const slug = def.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const cert = await prisma.employeeDocument.create({
      data: {
        employeeId,
        type: 'training_certificate',
        name: `${def.title} Certificate`,
        fileName: `${slug}-cert.pdf`,
        fileSize,
        mimeType: 'application/pdf',
        url: seedUrl,
        uploadedById,
      },
    });
    await prisma.employeeTraining.create({
      data: {
        employeeId,
        title: def.title,
        url: def.url,
        channel: 'email',
        sentAt,
        sentById: uploadedById,
        completedAt,
        certificateDocumentId: cert.id,
      },
    });
  }
}

async function main() {
  const subCompanies = await prisma.subCompany.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  if (subCompanies.length === 0) {
    throw new Error('No sub companies found. Run the full seed first (npm run prisma:seed).');
  }

  const toronto =
    subCompanies.find((s) => s.name.toLowerCase().includes('toronto')) ?? subCompanies[0]!;

  const recruiter1 =
    (await findUserByRole(['recruiter', 'sr_recruiter'], toronto.id)) ??
    (await findUserByRole(['recruiter', 'sr_recruiter']));
  const recruitmentManager =
    (await findUserByRole(['recruitment_manager'], toronto.id)) ??
    (await findUserByRole(['recruitment_manager'])) ??
    (await findUserByRole(['director', 'super_admin']));

  if (!recruiter1 || !recruitmentManager) {
    throw new Error(
      'Could not find recruiter / recruitment manager users. Run the full seed first (npm run prisma:seed).',
    );
  }

  console.log(`🏢 Agency: Toronto="${toronto.name}" (${toronto.id})`);
  console.log(`👤 Recruiter: ${recruiter1.email} · RM: ${recruitmentManager.email}`);
  console.log('📦 Using fictional dummy fixtures (no real clients / PDFs)');

  await wipeRecruitmentDomain();

  // ── Active Clients ──────────────────────────────────────────────────────────
  console.log('🏢 Seeding dummy active clients...');
  const clientsByKey = new Map<string, { id: string; name: string }>();
  for (const spec of DUMMY_ACTIVE_CLIENTS) {
    const row = await prisma.activeClient.create({
      data: {
        name: spec.name,
        industry: spec.industry,
        location: spec.location,
        contactName: spec.contactName,
        contactEmail: spec.contactEmail,
        contactPhone: spec.contactPhone,
        status: spec.status ?? 'active',
        notes: spec.notes ?? null,
        clientTraining: false,
        subCompanyId: toronto.id,
        createdById: recruiter1.id,
      },
    });
    clientsByKey.set(spec.key, { id: row.id, name: row.name });
    console.log(`   ✓ ${row.name} (${row.status})`);
  }

  // ── Jobs ────────────────────────────────────────────────────────────────────
  console.log('📋 Seeding dummy jobs...');
  const latest = await prisma.job.findFirst({
    where: { jobCode: { not: null } },
    orderBy: { jobCode: 'desc' },
    select: { jobCode: true },
  });
  let jobCodeN = latest?.jobCode ? parseInt(latest.jobCode, 10) : 0;
  if (!Number.isFinite(jobCodeN)) jobCodeN = 0;
  jobCodeN += 1;

  let jobCount = 0;
  for (const spec of DUMMY_JOBS) {
    const client = clientsByKey.get(spec.clientKey);
    if (!client) throw new Error(`Active client key not found: ${spec.clientKey}`);

    const { code, next } = await nextJobCode(jobCodeN);
    jobCodeN = next;

    const job = await prisma.job.create({
      data: {
        jobCode: code,
        jobType: 'external',
        title: spec.title,
        company: client.name,
        location: spec.location,
        department: spec.department,
        description: spec.description,
        requirements: spec.requirements,
        responsibilities: spec.responsibilities,
        openPositions: spec.openPositions,
        backupPercentage: DEFAULT_BACKUP_PERCENTAGE,
        status: 'open',
        employmentType: spec.employmentType,
        salaryMin: spec.salaryMin,
        salaryMax: spec.salaryMax ?? spec.salaryMin,
        publishLinkedin: true,
        publishIndeed: true,
        publishedAt: daysFromSeed(-7, 9),
        subCompanyId: toronto.id,
        activeClientId: client.id,
        createdById: recruiter1.id,
        applicantCount: 0,
        licenseRequired: spec.licenseRequired,
        requiredLicenseTypes: spec.requiredLicenseTypes,
        shiftSchedule: {
          startTime: spec.shift.startTime,
          endTime: spec.shift.endTime,
          workDays: spec.shift.workDays,
          jobStartDate: daysFromSeed(-3, 8).toISOString(),
          jobEndDate: null,
        } as unknown as Prisma.InputJsonValue,
        screeningCriteria: {
          requiredSkills: spec.requiredSkills,
          preferredSkills: [],
          minExperienceYears: spec.minExperienceYears,
          educationLevel: spec.educationLevel,
          remoteOption: 'onsite',
        } as unknown as Prisma.InputJsonValue,
      },
    });
    jobCount += 1;
    console.log(`   ✓ ${job.title} @ ${client.name} (${job.jobCode})`);
  }

  // ── Employees ───────────────────────────────────────────────────────────────
  console.log('👷 Seeding dummy employees...');
  let masterCount = 0;
  let pendingCount = 0;
  let unregisteredCount = 0;

  for (const [ei, spec] of DUMMY_EMPLOYEES.entries()) {
    const tier = spec.tier ?? 'master';
    const hireDaysAgo = 14 + ei;

    if (tier === 'unregistered') {
      // Product "Unregistered" = pending approvalStatus but not yet submitted (empty chain).
      await prisma.employee.create({
        data: {
          employeeType: 'external',
          firstName: spec.firstName,
          lastName: spec.lastName,
          email: spec.email,
          phone: spec.phone,
          address: spec.address,
          city: spec.city,
          province: spec.province,
          postalCode: spec.postalCode,
          country: 'Canada',
          availabilityTypes: ['full_time'],
          skills: [...spec.skills],
          residencyStatus: 'pr',
          shiftsAvailable: ['Day', 'Afternoon'],
          englishProficiency: ['Fluent'],
          workStatus: 'none',
          approvalStatus: 'pending',
          position: spec.position,
          hireDate: null,
          hourlyRate: 17.6,
          addedById: recruiter1.id,
          submitterRole: null,
          approvalChain: [] as unknown as Prisma.InputJsonValue,
          currentStepIndex: 0,
        },
      });
      unregisteredCount += 1;
      console.log(`   ✓ ${spec.firstName} ${spec.lastName} → Unregistered`);
      continue;
    }

    if (tier === 'pending') {
      const employee = await prisma.employee.create({
        data: {
          employeeType: 'external',
          firstName: spec.firstName,
          lastName: spec.lastName,
          email: spec.email,
          phone: spec.phone,
          address: spec.address,
          city: spec.city,
          province: spec.province,
          postalCode: spec.postalCode,
          country: 'Canada',
          availabilityTypes: ['full_time'],
          skills: [...spec.skills],
          residencyStatus: 'pr',
          shiftsAvailable: ['Day', 'Afternoon'],
          englishProficiency: ['Fluent'],
          workStatus: 'none',
          approvalStatus: 'pending',
          position: spec.position,
          hireDate: daysFromSeed(-hireDaysAgo, 9),
          hourlyRate: 17.6,
          addedById: recruiter1.id,
          submitterRole: 'recruiter',
          approvalChain: ['recruitment_manager'] as unknown as Prisma.InputJsonValue,
          currentStepIndex: 0,
        },
      });
      // Docs without agreement/trainings — not Master-ready yet
      await seedPlaceholderDocs({
        employeeId: employee.id,
        uploadedById: recruiter1.id,
        includeAgreement: false,
      });
      pendingCount += 1;
      console.log(`   ✓ ${spec.firstName} ${spec.lastName} → Pending`);
      continue;
    }

    // Master — approved + agreement + completed default trainings
    const employee = await prisma.employee.create({
      data: {
        employeeType: 'external',
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: spec.email,
        phone: spec.phone,
        address: spec.address,
        city: spec.city,
        province: spec.province,
        postalCode: spec.postalCode,
        country: 'Canada',
        availabilityTypes: ['full_time'],
        skills: [...spec.skills],
        residencyStatus: 'pr',
        shiftsAvailable: ['Day', 'Afternoon'],
        englishProficiency: ['Fluent'],
        workStatus: 'none',
        approvalStatus: 'approved',
        position: spec.position,
        hireDate: daysFromSeed(-hireDaysAgo, 9),
        hourlyRate: 17.6,
        addedById: recruiter1.id,
        approvedById: recruitmentManager.id,
        approvedAt: daysFromSeed(-hireDaysAgo + 2, 11),
        submitterRole: null,
        approvalChain: [] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });

    const { seedUrl, fileSize } = await seedPlaceholderDocs({
      employeeId: employee.id,
      uploadedById: recruiter1.id,
      includeAgreement: true,
    });
    await seedCompletedTrainings({
      employeeId: employee.id,
      uploadedById: recruiter1.id,
      seedUrl,
      fileSize,
      hireDaysAgo,
    });

    masterCount += 1;
    console.log(`   ✓ ${spec.firstName} ${spec.lastName} → Master`);
  }

  console.log('\n✅ Dummy client recruitment data seeded:');
  console.log(`   - Active Clients: ${clientsByKey.size}`);
  console.log(`   - Jobs: ${jobCount}`);
  console.log(`   - Employees: Master=${masterCount}, Pending=${pendingCount}, Unregistered=${unregisteredCount}`);
  console.log('   - Placements: none (ready to link in the UI)');
}

main()
  .catch((error) => {
    console.error('❌ Dummy client recruitment seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
