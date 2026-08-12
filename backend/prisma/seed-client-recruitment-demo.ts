/**
 * Client recruitment demo package seed.
 *
 * Wipes ONLY recruitment domain tables, then loads Active Clients / Jobs /
 * Master employees from Recruitment_Demo_Data fixtures.
 *
 * Run: npm run prisma:seed-client-recruitment-demo
 * Requires agencies + users from a prior full seed (npm run prisma:seed).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import {
  CLIENT_DEMO_ACTIVE_CLIENTS,
  CLIENT_DEMO_DEFAULT_TRAININGS,
  CLIENT_DEMO_EMPLOYEES,
  CLIENT_DEMO_JOBS,
  CLIENT_DEMO_REQUIRED_DOC_TYPES,
  CLIENT_DEMO_SHARED_PHOTO_ID,
  CLIENT_DEMO_SHARED_TRAINING_CERT,
  DEFAULT_BACKUP_PERCENTAGE,
} from './clientRecruitmentDemoData';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const seedNow = new Date();

function daysFromSeed(days: number, hour = 10): Date {
  const date = new Date(seedNow.getTime() + days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

/** Repo root …/Recruitment_Demo_Data (backend/prisma → ../../Recruitment_Demo_Data). */
function demoDataRoot(): string {
  return path.resolve(__dirname, '../../Recruitment_Demo_Data');
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

/**
 * Best-effort document URL: upload package bytes to R2 when configured,
 * otherwise a stable seed:// placeholder (same pattern as seedRecruitmentDemo).
 */
async function resolveDocumentUrl(params: {
  buffer: Buffer | null;
  agencyId: string;
  employeeId: string;
  fileName: string;
}): Promise<{ url: string; fileSize: number }> {
  const { buffer, agencyId, employeeId, fileName } = params;
  const seedUrl = `seed://employees/${employeeId}/${fileName}`;
  if (!buffer) {
    return { url: seedUrl, fileSize: 12_000 };
  }

  try {
    const { uploadToR2, buildAgencyR2Key } = await import('../src/services/r2Storage');
    const key = buildAgencyR2Key(agencyId, 'employees', employeeId, `client-demo-${fileName}`);
    const fileUrl = await uploadToR2(key, buffer, 'application/pdf');
    if (fileUrl) {
      return { url: fileUrl, fileSize: buffer.length };
    }
  } catch (err) {
    console.warn('   ⚠ R2 upload skipped for document:', fileName, err instanceof Error ? err.message : err);
  }

  return { url: seedUrl, fileSize: buffer.length };
}

function readPackagePdf(relativePath: string): Buffer | null {
  const full = path.join(demoDataRoot(), relativePath);
  if (!fs.existsSync(full)) {
    console.warn(`   ⚠ PDF not found: ${full}`);
    return null;
  }
  return fs.readFileSync(full);
}

async function nextJobCode(): Promise<string> {
  const latest = await prisma.job.findFirst({
    where: { jobCode: { not: null } },
    orderBy: { jobCode: 'desc' },
    select: { jobCode: true },
  });
  const n = latest?.jobCode ? parseInt(latest.jobCode, 10) : 0;
  const next = (Number.isFinite(n) ? n : 0) + 1;
  return String(next).padStart(6, '0');
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

  const recruiterFull = await prisma.user.findUnique({
    where: { id: recruiter1.id },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const recruiterDisplayName = recruiterFull
    ? `${recruiterFull.firstName} ${recruiterFull.lastName}`.trim()
    : 'Recruiter';

  console.log(`🏢 Agency: Toronto="${toronto.name}" (${toronto.id})`);
  console.log(`👤 Recruiter: ${recruiter1.email} · RM: ${recruitmentManager.email}`);
  console.log(`📁 Demo data root: ${demoDataRoot()}`);

  await wipeRecruitmentDomain();

  // ── Active Clients ──────────────────────────────────────────────────────────
  console.log('🏢 Seeding active clients...');
  const clientsByKey = new Map<string, { id: string; name: string }>();
  for (const spec of CLIENT_DEMO_ACTIVE_CLIENTS) {
    const row = await prisma.activeClient.create({
      data: {
        name: spec.name,
        industry: spec.industry,
        location: spec.location,
        contactName: spec.contactName,
        contactEmail: spec.contactEmail,
        contactPhone: spec.contactPhone,
        status: 'active',
        notes: spec.notes ?? null,
        subCompanyId: toronto.id,
        createdById: recruiter1.id,
      },
    });
    clientsByKey.set(spec.key, { id: row.id, name: row.name });
    console.log(`   ✓ ${row.name}`);
  }

  // ── Jobs ────────────────────────────────────────────────────────────────────
  console.log('📋 Seeding jobs...');
  let jobCount = 0;
  for (const [i, spec] of CLIENT_DEMO_JOBS.entries()) {
    const client = clientsByKey.get(spec.clientKey);
    if (!client) throw new Error(`Active client key not found: ${spec.clientKey}`);

    const jobCode = await nextJobCode();
    const job = await prisma.job.create({
      data: {
        jobCode,
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

  // ── Employees (Master only) ─────────────────────────────────────────────────
  console.log('👷 Seeding Master employees (trainings complete; agreement via PandaDoc live)...');
  let employeeCount = 0;

  for (const [ei, spec] of CLIENT_DEMO_EMPLOYEES.entries()) {
    const packageBuffer = readPackagePdf(spec.packagePdfRelativePath);
    const photoIdBuffer = readPackagePdf(CLIENT_DEMO_SHARED_PHOTO_ID) ?? packageBuffer;
    const trainingCertBuffer =
      readPackagePdf(CLIENT_DEMO_SHARED_TRAINING_CERT) ?? packageBuffer;
    const hireDaysAgo = 14 + ei;
    const pkgName = path.basename(spec.packagePdfRelativePath);
    const dateOfBirth = new Date(`${spec.dateOfBirth}T12:00:00.000Z`);
    const availableFrom = daysFromSeed(spec.availableFromDaysOffset, 0);

    const employee = await prisma.employee.create({
      data: {
        employeeType: 'external',
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: spec.email,
        phone: spec.phone,
        alternatePhone: spec.alternatePhone,
        dateOfBirth,
        gender: spec.gender,
        address: spec.address,
        addressLine2: spec.addressLine2,
        city: spec.city,
        province: spec.province,
        postalCode: spec.postalCode,
        country: spec.country,
        emergencyContactName: spec.emergencyContactName,
        emergencyContactPhone: spec.emergencyContactPhone,
        educationLevel: spec.educationLevel,
        educationFromYear: spec.educationFromYear,
        educationEndYear: spec.educationEndYear,
        graduated: spec.graduated,
        courseStudied: spec.courseStudied,
        diplomaName: spec.diplomaName,
        experienceDuties: spec.experienceDuties,
        availableFrom,
        availabilityTypes: [...spec.availabilityTypes],
        skills: [...spec.skills],
        residencyStatus: spec.residencyStatus,
        shiftsAvailable: [...spec.shiftsAvailable],
        ableTwelveHourShift: spec.ableTwelveHourShift,
        englishProficiency: [...spec.englishProficiency],
        workStatus: 'none',
        approvalStatus: 'approved',
        position: spec.position,
        department: spec.department,
        hireDate: daysFromSeed(-hireDaysAgo, 9),
        hourlyRate: spec.hourlyRate,
        salaryPaymentMethod: spec.salaryPaymentMethod,
        bankName: spec.bankName,
        bankInstitutionNumber: spec.bankInstitutionNumber,
        bankTransitNumber: spec.bankTransitNumber,
        bankAccountNumber: spec.bankAccountNumber,
        // Onboarding agreement is PandaDoc only — do not fake status or seed an agreement file.
        // Demo: send from Unregistered → PandaDoc email → sync after signature.
        onboardingPandaDocId: null,
        onboardingPandaDocStatus: null,
        onboardingPandaDocUpdatedAt: null,
        addedById: recruiter1.id,
        approvedById: recruitmentManager.id,
        approvedAt: daysFromSeed(-hireDaysAgo + 2, 11),
        // No pending chain — already Master.
        submitterRole: null,
        approvalChain: [] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeCount += 1;

    // Work history (Employment panel).
    for (const wx of spec.workExperiences) {
      await prisma.employeeWorkExperience.create({
        data: {
          employeeId: employee.id,
          companyName: wx.companyName,
          contactNumber: wx.contactNumber,
          position: wx.position,
          duration: wx.duration,
          sortOrder: wx.sortOrder,
        },
      });
    }

    // Profile note for demo polish.
    if (spec.profileNote.trim()) {
      await prisma.employeeNote.create({
        data: {
          employeeId: employee.id,
          userId: recruiter1.id,
          userName: recruiterDisplayName,
          content: spec.profileNote,
        },
      });
    }

    // Upload package once when present; share photo-id / training sample files when present.
    const packageUpload = await resolveDocumentUrl({
      buffer: packageBuffer,
      agencyId: toronto.id,
      employeeId: employee.id,
      fileName: packageBuffer ? pkgName : 'package.pdf',
    });
    const photoIdUpload = await resolveDocumentUrl({
      buffer: photoIdBuffer,
      agencyId: toronto.id,
      employeeId: employee.id,
      fileName: CLIENT_DEMO_SHARED_PHOTO_ID,
    });
    const trainingCertUpload = await resolveDocumentUrl({
      buffer: trainingCertBuffer,
      agencyId: toronto.id,
      employeeId: employee.id,
      fileName: CLIENT_DEMO_SHARED_TRAINING_CERT,
    });

    const photoIdExpiry = daysFromSeed(365 + ei * 30, 12);
    for (const doc of CLIENT_DEMO_REQUIRED_DOC_TYPES) {
      const isId = doc.type === 'photo_id' || doc.type === 'proof_of_status';
      const usePhotoFile = doc.type === 'photo_id' || doc.type === 'proof_of_status';
      const upload = usePhotoFile ? photoIdUpload : packageUpload;
      await prisma.employeeDocument.create({
        data: {
          employeeId: employee.id,
          type: doc.type,
          name: doc.name,
          fileName: doc.fileName,
          fileSize: upload.fileSize,
          mimeType: 'application/pdf',
          url: upload.url,
          uploadedById: recruiter1.id,
          expiryDate: isId ? photoIdExpiry : null,
          notes: isId
            ? 'Valid government document — expires next year'
            : doc.type === 'bank_deposit'
              ? 'Direct deposit / banking form on file'
              : doc.type === 'resume'
                ? 'Resume from candidate package'
                : null,
        },
      });
    }

    // Full package row for Documents panel visibility (not the onboarding agreement).
    if (packageBuffer) {
      await prisma.employeeDocument.create({
        data: {
          employeeId: employee.id,
          type: 'other',
          name: 'Employee document package',
          fileName: pkgName,
          fileSize: packageUpload.fileSize,
          mimeType: 'application/pdf',
          url: packageUpload.url,
          uploadedById: recruiter1.id,
          notes: 'Candidate package (IDs, forms, etc.). Onboarding agreement is via PandaDoc only.',
        },
      });
    }

    // Default trainings complete with certificates (Master readiness gate).
    const sentAt = daysFromSeed(-hireDaysAgo - 3, 10);
    const completedAt = daysFromSeed(-hireDaysAgo - 1, 14);
    for (const def of CLIENT_DEMO_DEFAULT_TRAININGS) {
      const slug = def.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const cert = await prisma.employeeDocument.create({
        data: {
          employeeId: employee.id,
          type: 'training_certificate',
          name: `${def.title} Certificate`,
          fileName: `${slug}-cert.pdf`,
          fileSize: trainingCertUpload.fileSize,
          mimeType: 'application/pdf',
          url: trainingCertUpload.url,
          uploadedById: recruiter1.id,
          notes: 'Training certificate on file',
        },
      });
      await prisma.employeeTraining.create({
        data: {
          employeeId: employee.id,
          title: def.title,
          url: def.url,
          channel: 'email',
          sentAt,
          sentById: recruiter1.id,
          completedAt,
          certificateDocumentId: cert.id,
        },
      });
    }

    console.log(
      `   ✓ ${spec.firstName} ${spec.lastName} → Master` +
        ` (DOB ${spec.dateOfBirth}, full profile)` +
        (packageBuffer ? ' + package PDF' : ' — PDF missing'),
    );
  }

  console.log('\n✅ Client recruitment demo package seeded:');
  console.log(`   - Active Clients: ${clientsByKey.size}`);
  console.log(`   - Jobs: ${jobCount}`);
  console.log(`   - Employees (Master): ${employeeCount}`);
  console.log('   - Placements: none (ready to place live in the demo)');
}

main()
  .catch((error) => {
    console.error('❌ Client recruitment demo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
