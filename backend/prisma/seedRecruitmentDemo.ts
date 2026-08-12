/**
 * Recruitment seed: Active Clients → Jobs → Employees → placements for both agencies.
 * Covers every pipeline stage: unregistered, pending (submitted), master, active-with-client,
 * scheduled (backup), ended placements with ratings (history), pending client assignment requests.
 *
 * Matches live product flow: every job is external + activeClientId; job placements are instant
 * (approved + roster, capacity-safe, isBackup set); only targetType=client stays pending for RM.
 * Submitted/approved employees get required docs + completed default trainings for Master approve.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

type SeedUser = { id: string };

export type SeedRecruitmentDemoResult = {
  activeClientCount: number;
  jobCount: number;
  employeeCount: number;
  jobAssignmentCount: number;
  employeeAssignmentCount: number;
};

type DaysFromSeed = (days: number, hour?: number) => Date;

const RM_CHAIN = ['recruitment_manager'] as const;

const TORONTO_FIRST = [
  'James', 'Priya', 'Daniel', 'Sofia', 'Liam', 'Hannah', 'Ethan', 'Ava', 'Noah', 'Mia',
  'Oliver', 'Isla', 'Lucas', 'Emma', 'Mason', 'Chloe', 'Logan', 'Zoe', 'Ryan', 'Grace',
  'Adrian', 'Nina', 'Leo', 'Sara', 'Omar', 'Fatima', 'Kai', 'Amelia', 'Owen', 'Layla',
  'Nathan', 'Ella', 'Victor', 'Hana', 'Derek', 'Maya', 'Chris', 'Leah', 'Tyler', 'Ivy',
  'Benjamin', 'Nora', 'Samuel', 'Ruby', 'Jordan', 'Alice', 'Kevin', 'Elena', 'Marcus', 'Tara',
  'Patrick', 'Julia', 'Andre', 'Nadia', 'Sean', 'Carmen', 'Blake', 'Rita', 'Dylan', 'Paula',
  'Craig', 'Monica', 'Felix', 'Irene', 'Hugo', 'Diana', 'Reid', 'Helen', 'Cole', 'Wendy',
];

const TORONTO_LAST = [
  'Okoro', 'Nair', 'Brooks', 'Martinez', 'Hughes', 'Kim', 'Walsh', 'Chen', 'Singh', 'Park',
  'Nguyen', 'Patel', 'Williams', 'Garcia', 'Brown', 'Lee', 'Taylor', 'Anderson', 'Thomas', 'Jackson',
  'White', 'Harris', 'Martin', 'Thompson', 'Moore', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams',
  'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips',
  'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris',
  'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey',
];

const VANCOUVER_FIRST = [
  'Noah', 'Maya', 'Ethan', 'Olivia', 'Lucas', 'Aria', 'Jasper', 'Sienna', 'Caleb', 'Freya',
  'Miles', 'Quinn', 'Theo', 'Luna', 'Asher',
];

const VANCOUVER_LAST = [
  'Singh', 'Chen', 'Walsh', 'Reed', 'Park', 'Nguyen', 'Patel', 'Brooks', 'Kim', 'Torres',
  'Nguyen', 'Lopez', 'Grant', 'Shaw', 'Vu',
];

const POSITIONS = [
  'Warehouse Associate',
  'Registered Nurse',
  'CNC Operator',
  'LPN - Long Term Care',
  'Customer Support Rep',
  'Office Administrator',
  'Forklift Driver',
  'Store Manager',
  'Warehouse Supervisor',
  'Teaching Assistant',
  'Production Worker',
  'Security Guard',
];

const TORONTO_CITIES = [
  { city: 'Toronto', province: 'Ontario', postal: 'M5H 2N2' },
  { city: 'Mississauga', province: 'Ontario', postal: 'L5B 1M2' },
  { city: 'Brampton', province: 'Ontario', postal: 'L6T 0A1' },
  { city: 'Markham', province: 'Ontario', postal: 'L3R 0B2' },
  { city: 'Scarborough', province: 'Ontario', postal: 'M1B 2K1' },
  { city: 'North York', province: 'Ontario', postal: 'M2N 5W9' },
  { city: 'Etobicoke', province: 'Ontario', postal: 'M9W 1A1' },
];

const VANCOUVER_CITIES = [
  { city: 'Vancouver', province: 'British Columbia', postal: 'V6B 1A1' },
  { city: 'Burnaby', province: 'British Columbia', postal: 'V5C 3Y3' },
  { city: 'Surrey', province: 'British Columbia', postal: 'V3T 1W4' },
  { city: 'Richmond', province: 'British Columbia', postal: 'V6X 2A9' },
  { city: 'Coquitlam', province: 'British Columbia', postal: 'V3B 0A1' },
];

// ─── Active Clients (recruitment-side) ───────────────────────────────────────

type ActiveClientSpec = {
  key: string;
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status?: 'active' | 'inactive';
  notes?: string;
};

const TORONTO_ACTIVE_CLIENTS: ActiveClientSpec[] = [
  { key: 'maple', name: 'Maple Leaf Logistics', industry: 'Logistics & Warehousing', location: 'Mississauga, ON', contactName: 'Karen Doyle', contactEmail: 'karen.doyle@mapleleaflogistics.ca', contactPhone: '+1-905-555-0110' },
  { key: 'citycare', name: 'CityCare Hospital', industry: 'Healthcare', location: 'Toronto, ON', contactName: 'Dr. Alan Reyes', contactEmail: 'a.reyes@citycare.ca', contactPhone: '+1-416-555-0121' },
  { key: 'metalworks', name: 'MetalWorks Manufacturing', industry: 'Manufacturing', location: 'Brampton, ON', contactName: 'Sunil Mehta', contactEmail: 'sunil.mehta@metalworks.ca', contactPhone: '+1-905-555-0132' },
  { key: 'brightpath', name: 'BrightPath Schools', industry: 'Education', location: 'North York, ON', contactName: 'Emily Watson', contactEmail: 'e.watson@brightpath.ca', contactPhone: '+1-416-555-0143' },
  { key: 'carebridge', name: 'CareBridge Long Term Care', industry: 'Healthcare', location: 'Scarborough, ON', contactName: 'Maria Santos', contactEmail: 'm.santos@carebridge.ca', contactPhone: '+1-416-555-0154' },
  { key: 'harbor', name: 'Harbor Freight Co', industry: 'Warehousing', location: 'Brampton, ON', contactName: 'Doug Fletcher', contactEmail: 'doug@harborfreight.ca', contactPhone: '+1-905-555-0165' },
  { key: 'summit', name: 'Summit Retail Group', industry: 'Retail', location: 'Etobicoke, ON', contactName: 'Tracy Lim', contactEmail: 't.lim@summitretail.ca', contactPhone: '+1-416-555-0176' },
  { key: 'aurora', name: 'Aurora Foods', industry: 'Food Production', location: 'Markham, ON', contactName: 'Peter Novak', contactEmail: 'p.novak@aurorafoods.ca', contactPhone: '+1-905-555-0187' },
  { key: 'pinnacle', name: 'Pinnacle Security Services', industry: 'Security', location: 'Toronto, ON', contactName: 'Grace Oduya', contactEmail: 'g.oduya@pinnaclesecurity.ca', contactPhone: '+1-416-555-0198' },
  { key: 'northern', name: 'Northern Textiles', industry: 'Manufacturing', location: 'Mississauga, ON', contactName: 'Raj Kapoor', contactEmail: 'raj@northerntextiles.ca', contactPhone: '+1-905-555-0209', status: 'inactive', notes: 'Seasonal — reactivates every spring.' },
];

const VANCOUVER_ACTIVE_CLIENTS: ActiveClientSpec[] = [
  { key: 'pacific', name: 'Pacific Care Homes', industry: 'Healthcare', location: 'Vancouver, BC', contactName: 'Janet Wong', contactEmail: 'j.wong@pacificcare.ca', contactPhone: '+1-604-555-0110' },
  { key: 'westcoast', name: 'WestCoast Metals', industry: 'Manufacturing', location: 'Burnaby, BC', contactName: 'Steve Baran', contactEmail: 's.baran@westcoastmetals.ca', contactPhone: '+1-604-555-0121' },
  { key: 'cascade', name: 'Cascade Retail', industry: 'Retail', location: 'Surrey, BC', contactName: 'Dana Price', contactEmail: 'd.price@cascaderetail.ca', contactPhone: '+1-604-555-0132' },
  { key: 'fraser', name: 'Fraser Logistics', industry: 'Logistics & Warehousing', location: 'Richmond, BC', contactName: 'Ken Ito', contactEmail: 'k.ito@fraserlogistics.ca', contactPhone: '+1-604-555-0143' },
];

// ─── Jobs ────────────────────────────────────────────────────────────────────

type JobSpec = {
  jobType: 'external';
  title: string;
  /** Always set — product requires every job on an Active Client. */
  clientKey: string;
  location: string;
  department: string;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions: number;
  status: 'draft' | 'open' | 'closed' | 'filled';
  employmentType: 'full_time' | 'part_time' | 'contract';
  createdById: string;
  applicantCount: number;
  closedDaysAgo?: number;
  shift?: { startTime: string; endTime: string; workDays: string[] };
};

const DEFAULT_BACKUP_PERCENTAGE = 70;

function rosterCapacity(openPositions: number, backupPercentage = DEFAULT_BACKUP_PERCENTAGE): number {
  return Math.ceil(openPositions * (1 + backupPercentage / 100));
}

/** Default onboarding trainings (mirror of employeeDefaultTraining.DEFAULT_EMPLOYEE_TRAININGS). */
const SEED_DEFAULT_TRAININGS = [
  {
    title: 'Ontario Health & Safety — 4 Steps',
    url: 'https://www.labour.gov.on.ca/english/hs/elearn/worker/foursteps.php',
  },
  {
    title: 'WHMIS',
    url: 'https://aixsafety.com/',
  },
] as const;

const DAY_SHIFT = { startTime: '07:00', endTime: '15:30', workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };
const AFTERNOON_SHIFT = { startTime: '15:00', endTime: '23:30', workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };
const NIGHT_SHIFT = { startTime: '23:00', endTime: '07:00', workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };
const WEEKEND_SHIFT = { startTime: '08:00', endTime: '16:30', workDays: ['Saturday', 'Sunday'] };

type EmpBucket = 'unregistered' | 'pending' | 'active' | 'master' | 'rejected';

type EmpSpec = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  province: string;
  postalCode: string;
  employeeType: 'external' | 'internal';
  availabilityTypes: Array<'full_time' | 'part_time'>;
  skills: string[];
  workStatus: 'active' | 'scheduled' | 'none';
  approvalStatus: 'approved' | 'pending' | 'rejected';
  /** Pending that already went to RM (vs unregistered unsubmitted). */
  submittedForApproval?: boolean;
  /**
   * When true, skip completed default trainings so RM approve is blocked
   * (demo of training gate). Default submitted/approved get certificates.
   */
  trainingsIncomplete?: boolean;
  position: string;
  addedById: string;
  tags?: Array<'no_show' | 'ex' | 'blacklisted'>;
  hireDaysAgo?: number;
  rejectionReason?: string | null;
};

/** Mirrors frontend skillLicenseMap — fixed licenses (forklift uses equipment types below). */
const SKILL_TO_LICENSES: Record<string, readonly string[]> = {
  // Demo default equipment type when employee has Forklift Operator skill
  'Forklift Operator': ['Counterbalance Forklift'],
  'Driving (Class G)': ['Driver License (Class G)'],
  'Driving (Class AZ/DZ)': ['Driver License (AZ/DZ)'],
  'First Aid Certified': ['First Aid / CPR'],
  'Food Production': ['Food Handler Certificate'],
};

/**
 * Map job titles → SKILL_OPTIONS labels (and optional licenses) so Job Matches /
 * Link-to-Client demos work. Matching requires ALL listed skills.
 */
const JOB_TITLE_MATCH: Record<
  string,
  { requiredSkills: string[]; licenses?: string[] }
> = {
  'Warehouse Associate': { requiredSkills: ['Warehouse'] },
  'Warehouse Associate (Draft)': { requiredSkills: ['Warehouse'] },
  'Warehouse Supervisor': { requiredSkills: ['Warehouse'] },
  'Forklift Driver': {
    requiredSkills: ['Forklift Operator'],
    licenses: ['Counterbalance Forklift'],
  },
  'General Labourer': { requiredSkills: ['General Labour'] },
  Packager: { requiredSkills: ['Picker / Packer'] },
  'Production Worker': {
    requiredSkills: ['Food Production'],
    licenses: ['Food Handler Certificate'],
  },
  'CNC Operator': { requiredSkills: ['Machine Operator'] },
  'Senior CNC Operator': { requiredSkills: ['Machine Operator'] },
  'Customer Support Rep': { requiredSkills: ['Customer Service'] },
  'Office Administrator': { requiredSkills: ['Administrative Support'] },
  Receptionist: { requiredSkills: ['Administrative Support'] },
  'Registered Nurse': { requiredSkills: ['Healthcare Aide'] },
  'RN - Clinic': { requiredSkills: ['Healthcare Aide'] },
  'LPN - Long Term Care': { requiredSkills: ['Healthcare Aide'] },
  'LPN - Night Shift': { requiredSkills: ['Healthcare Aide'] },
  'Security Guard': { requiredSkills: ['General Labour'] },
  'Teaching Assistant': { requiredSkills: ['Administrative Support'] },
  'Store Manager': { requiredSkills: ['Customer Service'] },
};

function matchProfileForJobTitle(title: string): {
  requiredSkills: string[];
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
} {
  const profile = JOB_TITLE_MATCH[title];
  if (!profile) {
    return { requiredSkills: [], licenseRequired: false, requiredLicenseTypes: [] };
  }
  const licenses = [...(profile.licenses ?? [])];
  for (const skill of profile.requiredSkills) {
    const mapped = SKILL_TO_LICENSES[skill];
    if (mapped) for (const l of mapped) if (!licenses.includes(l)) licenses.push(l);
  }
  return {
    requiredSkills: profile.requiredSkills,
    licenseRequired: licenses.length > 0,
    requiredLicenseTypes: licenses,
  };
}

const SKILL_POOL = [
  'General Labour',
  'Warehouse',
  'Forklift Operator',
  'Picker / Packer',
  'Machine Operator',
  'Customer Service',
  'First Aid Certified',
  'Food Production',
  'Administrative Support',
  'Healthcare Aide',
  'Driving (Class G)',
  'Shipping & Receiving',
] as const;

function skillsForIndex(i: number): string[] {
  const primary = SKILL_POOL[i % SKILL_POOL.length]!;
  const secondary = SKILL_POOL[(i + 3) % SKILL_POOL.length]!;
  if (primary === secondary) return [primary];
  // Every other employee gets a second skill for richer matching demos.
  return i % 2 === 0 ? [primary, secondary] : [primary];
}

function licenseTypesForSkills(skills: string[]): string[] {
  const set = new Set<string>();
  for (const skill of skills) {
    const mapped = SKILL_TO_LICENSES[skill];
    if (mapped) for (const license of mapped) set.add(license);
  }
  return [...set];
}

const REJECTION_REASONS = [
  'Did not complete screening requirements',
  'Missing or expired work permit documents',
  'Failed reference check',
  'Incomplete application — please resubmit with required documents',
];

const REQUIRED_DOC_TYPES = [
  { type: 'photo_id' as const, name: 'Photo ID', fileName: 'photo-id.pdf' },
  { type: 'sin' as const, name: 'SIN Document', fileName: 'sin.pdf' },
  { type: 'proof_of_status' as const, name: 'Proof of Status', fileName: 'status.pdf' },
  { type: 'agreement' as const, name: 'Employment Agreement', fileName: 'agreement.pdf' },
];

/** Names treated as female for demo gender assignment (edit form prefill). */
const DEMO_FEMALE_FIRST = new Set([
  'Priya', 'Sofia', 'Hannah', 'Ava', 'Mia', 'Isla', 'Emma', 'Chloe', 'Zoe', 'Grace',
  'Nina', 'Sara', 'Fatima', 'Amelia', 'Layla', 'Ella', 'Hana', 'Maya', 'Leah', 'Ivy',
  'Nora', 'Ruby', 'Alice', 'Elena', 'Tara', 'Julia', 'Nadia', 'Carmen', 'Rita', 'Paula',
  'Monica', 'Irene', 'Diana', 'Helen', 'Wendy', 'Olivia', 'Aria', 'Sienna', 'Freya',
  'Quinn', 'Luna',
]);

const PHOTO_ID_TYPES = ['drivers_license', 'passport', 'provincial_id', 'other_government_id'] as const;
const EDUCATION_LEVELS = ['High School', "Bachelor's", 'College Diploma', 'Trade Certificate'] as const;

/**
 * Full profile fields so edit form opens prefilled (seed used to omit most of these).
 * Never includes SIN digits.
 */
function buildDemoEmployeeProfile(
  index: number,
  firstName: string,
  lastName: string,
  position: string | null | undefined,
  daysFromSeed: DaysFromSeed,
) {
  const gender = DEMO_FEMALE_FIRST.has(firstName) ? ('female' as const) : ('male' as const);
  const birthYear = 1985 + (index % 18);
  const birthMonth = (index % 12) + 1;
  const birthDay = (index % 27) + 1;
  const dateOfBirth = new Date(
    `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}T12:00:00.000Z`,
  );
  const eduLevel = EDUCATION_LEVELS[index % EDUCATION_LEVELS.length]!;
  const fromYear = 2005 + (index % 10);
  const graduated = index % 5 !== 0;
  const endYear = graduated ? fromYear + 2 + (index % 3) : null;
  const photoIdType = PHOTO_ID_TYPES[index % PHOTO_ID_TYPES.length]!;
  const photoIdExpiry = daysFromSeed(400 + (index % 200), 12);
  const statusDocExpiry = daysFromSeed(500 + (index % 100), 12);
  const sinDocExpiry = daysFromSeed(600 + (index % 150), 12);
  const photoIdExpiryStr = photoIdExpiry.toISOString().slice(0, 10);
  const statusDocExpiryStr = statusDocExpiry.toISOString().slice(0, 10);
  const sinDocExpiryStr = sinDocExpiry.toISOString().slice(0, 10);

  const uiExtras = {
    skills: [] as string[],
    noWorkExperience: false,
    extraEducation: [] as unknown[],
    extraExperiences: [] as unknown[],
    assignedClientId: '',
    assignedClientName: '',
    photoIdType,
    photoIdNumber: `ID-${100000 + index}`,
    photoIdExpiry: photoIdExpiryStr,
    statusDocExpiry: statusDocExpiryStr,
    sinDocExpiry: sinDocExpiryStr,
    licensesNotApplicable: false,
    licenses: [] as Array<{ licenseType: string; expiryDate: string; docId: string | null }>,
    profilePhotoDocId: null as string | null,
  };

  return {
    gender,
    dateOfBirth,
    emergencyContactName: `${firstName} Emergency`,
    emergencyContactPhone: `+1-416-555-${String(2000 + (index % 8000)).padStart(4, '0')}`,
    educationLevel: eduLevel,
    educationFromYear: fromYear,
    educationEndYear: endYear,
    graduated,
    courseStudied: position ? `${position} studies` : 'General studies',
    diplomaName: graduated ? eduLevel : null,
    experienceDuties: 'General warehouse and production duties; reliable team contributor.',
    availableFrom: daysFromSeed(index % 21, 0),
    ableTwelveHourShift: index % 3 !== 0,
    englishProficiency: index % 2 === 0 ? (['All'] as string[]) : (['Speak', 'Read', 'Write'] as string[]),
    salaryPaymentMethod: index % 2 === 0 ? ('cheque' as const) : ('deposit' as const),
    bankName: index % 2 === 0 ? null : 'Demo Bank of Canada',
    bankInstitutionNumber: index % 2 === 0 ? null : '001',
    bankTransitNumber: index % 2 === 0 ? null : '12345',
    bankAccountNumber: index % 2 === 0 ? null : `10${String(1000000 + index).slice(-7)}`,
    uiExtras,
    docExpiries: {
      photo_id: photoIdExpiry,
      sin: sinDocExpiry,
      proof_of_status: statusDocExpiry,
    } as Record<string, Date>,
    workExperiences: [
      {
        companyName: 'Demo Logistics Co.',
        contactNumber: '+1-416-555-0100',
        position: position || 'Associate',
        duration: '2 years',
        sortOrder: 1,
      },
      {
        companyName: 'North Star Staffing Temp',
        contactNumber: '+1-416-555-0101',
        position: 'General Labour',
        duration: '8 months',
        sortOrder: 2,
      },
    ],
  };
}

function buildRoster(params: {
  firstNames: string[];
  lastNames: string[];
  cities: typeof TORONTO_CITIES;
  phonePrefix: string;
  emailDomain: string;
  adders: SeedUser[];
  counts: { unregistered: number; pending: number; active: number; master: number; rejected: number };
}): EmpSpec[] {
  const { firstNames, lastNames, cities, phonePrefix, emailDomain, adders, counts } = params;
  const plan: EmpBucket[] = [
    ...Array(counts.unregistered).fill('unregistered' as const),
    ...Array(counts.pending).fill('pending' as const),
    ...Array(counts.active).fill('active' as const),
    ...Array(counts.master).fill('master' as const),
    ...Array(counts.rejected).fill('rejected' as const),
  ];

  let rejectedIdx = 0;

  return plan.map((bucket, i) => {
    const firstName = firstNames[i % firstNames.length]!;
    const lastName = lastNames[i % lastNames.length]!;
    const loc = cities[i % cities.length]!;
    const adder = adders[i % adders.length]!;
    const position = POSITIONS[i % POSITIONS.length]!;
    const tags: EmpSpec['tags'] = [];
    if (bucket === 'rejected' && i % 3 === 0) tags.push('no_show');
    if (bucket === 'rejected' && i % 3 === 1) tags.push('ex');
    if (bucket === 'master' && i % 11 === 0) tags.push('blacklisted');

    const base: EmpSpec = {
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i}@${emailDomain}`,
      phone: `${phonePrefix}${String(2000 + i).padStart(4, '0')}`,
      city: loc.city,
      province: loc.province,
      postalCode: loc.postal,
      employeeType: i % 7 === 0 ? 'internal' : 'external',
      availabilityTypes: i % 5 === 0 ? (['part_time'] as const) : (['full_time'] as const),
      skills: skillsForIndex(i),
      workStatus: 'none',
      approvalStatus: 'pending',
      position,
      addedById: adder.id,
      tags: tags.length ? tags : undefined,
    };

    if (bucket === 'unregistered') {
      return { ...base, approvalStatus: 'pending', workStatus: 'none', submittedForApproval: false };
    }
    if (bucket === 'pending') {
      return { ...base, approvalStatus: 'pending', workStatus: 'none', submittedForApproval: true };
    }
    if (bucket === 'active') {
      return { ...base, approvalStatus: 'approved', workStatus: 'active', hireDaysAgo: 20 + (i % 100) };
    }
    if (bucket === 'master') {
      return { ...base, approvalStatus: 'approved', workStatus: 'none', hireDaysAgo: 10 + (i % 40) };
    }
    const reason = REJECTION_REASONS[rejectedIdx % REJECTION_REASONS.length]!;
    rejectedIdx += 1;
    return { ...base, approvalStatus: 'rejected', workStatus: 'none', rejectionReason: reason };
  });
}

function payRateFor(index: number): string {
  const min = 18 + (index % 8);
  return `$${min}–$${min + 4}/hr`;
}

function shiftLabel(shift: { startTime: string; endTime: string; workDays: string[] }): string {
  return `${shift.startTime}–${shift.endTime} · ${shift.workDays.slice(0, 5).join(', ')}`;
}

export async function seedRecruitmentDemo(
  prisma: PrismaClient,
  deps: {
    recruiter1: SeedUser;
    srRecruiter: SeedUser;
    vancouverRecruiter: SeedUser;
    pakistanUser: SeedUser;
    recruitmentManager: SeedUser;
    subCompanyTorontoId: string;
    subCompanyVancouverId: string;
    daysFromSeed: DaysFromSeed;
  },
): Promise<SeedRecruitmentDemoResult> {
  console.log('👷 Seeding recruitment data (Active Clients → Jobs → Employees → placements)...');

  const {
    recruiter1,
    srRecruiter,
    vancouverRecruiter,
    pakistanUser,
    recruitmentManager,
    subCompanyTorontoId,
    subCompanyVancouverId,
    daysFromSeed,
  } = deps;

  // ── 1. Active Clients per agency ───────────────────────────────────────────
  const activeClientsByKey = new Map<string, { id: string; name: string }>();

  const createActiveClients = async (
    specs: ActiveClientSpec[],
    subCompanyId: string,
    createdById: string,
    keyPrefix: string,
  ) => {
    for (const spec of specs) {
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
          subCompanyId,
          createdById,
        },
      });
      activeClientsByKey.set(`${keyPrefix}:${spec.key}`, { id: row.id, name: row.name });
    }
  };

  await createActiveClients(TORONTO_ACTIVE_CLIENTS, subCompanyTorontoId, recruiter1.id, 'to');
  await createActiveClients(VANCOUVER_ACTIVE_CLIENTS, subCompanyVancouverId, vancouverRecruiter.id, 'va');

  const activeClientCount = activeClientsByKey.size;
  const toClient = (key: string) => activeClientsByKey.get(`to:${key}`)!;
  const vaClient = (key: string) => activeClientsByKey.get(`va:${key}`)!;

  // ── 2. Jobs (agency-scoped, linked to active clients) ──────────────────────
  const torontoJobs: JobSpec[] = [
    { jobType: 'external', title: 'Warehouse Associate', clientKey: 'maple', location: 'Mississauga, Ontario', department: 'Warehouse', description: 'Warehouse associates for day and afternoon shifts.', requirements: '1+ year warehouse experience.', responsibilities: 'Picking, packing, inventory.', openPositions: 8, status: 'open', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 18, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Registered Nurse', clientKey: 'citycare', location: 'Toronto, Ontario', department: 'Healthcare', description: 'RNs for med-surg coverage.', requirements: 'Active CNO registration.', responsibilities: 'Patient care and charting.', openPositions: 5, status: 'open', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 22, shift: AFTERNOON_SHIFT },
    { jobType: 'external', title: 'Customer Support Rep', clientKey: 'brightpath', location: 'Markham, Ontario', department: 'Customer Service', description: 'Inbound support for retail clients.', requirements: 'Clear English; CRM experience preferred.', responsibilities: 'Ticket triage and follow-ups.', openPositions: 4, status: 'open', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 14, shift: DAY_SHIFT },
    { jobType: 'external', title: 'CNC Operator', clientKey: 'metalworks', location: 'Brampton, Ontario', department: 'Production', description: 'CNC operators for precision machining.', requirements: 'CNC setup experience.', responsibilities: 'Machine setup and QC.', openPositions: 6, status: 'open', employmentType: 'full_time', createdById: pakistanUser.id, applicantCount: 11, shift: AFTERNOON_SHIFT },
    { jobType: 'external', title: 'Senior CNC Operator', clientKey: 'metalworks', location: 'Mississauga, Ontario', department: 'Production', description: 'Lead CNC operator.', requirements: '5+ years CNC.', responsibilities: 'Program edits and mentoring.', openPositions: 3, status: 'open', employmentType: 'full_time', createdById: srRecruiter.id, applicantCount: 9, shift: DAY_SHIFT },
    { jobType: 'external', title: 'LPN - Long Term Care', clientKey: 'carebridge', location: 'Toronto, Ontario', department: 'Healthcare', description: 'LPNs for LTC residences.', requirements: 'Active LPN licence.', responsibilities: 'Medication and resident care.', openPositions: 7, status: 'open', employmentType: 'full_time', createdById: srRecruiter.id, applicantCount: 16, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Forklift Driver', clientKey: 'harbor', location: 'Scarborough, Ontario', department: 'Warehouse', description: 'Certified forklift drivers.', requirements: 'Valid forklift certification.', responsibilities: 'Load/unload and staging.', openPositions: 4, status: 'open', employmentType: 'full_time', createdById: srRecruiter.id, applicantCount: 8, shift: NIGHT_SHIFT },
    { jobType: 'external', title: 'Office Administrator', clientKey: 'summit', location: 'Etobicoke, Ontario', department: 'Administration', description: 'Front desk and intake support for Summit Retail HQ.', requirements: '2+ years admin.', responsibilities: 'Scheduling and intake.', openPositions: 1, status: 'open', employmentType: 'full_time', createdById: srRecruiter.id, applicantCount: 5, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Production Worker', clientKey: 'aurora', location: 'Markham, Ontario', department: 'Production', description: 'Assembly line production.', requirements: 'Physical stamina; safety training.', responsibilities: 'Assembly and packing.', openPositions: 12, status: 'open', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 28, shift: AFTERNOON_SHIFT },
    { jobType: 'external', title: 'Security Guard', clientKey: 'pinnacle', location: 'Toronto, Ontario', department: 'Security', description: 'Site security for retail campuses.', requirements: 'Valid security licence.', responsibilities: 'Patrol and incident reporting.', openPositions: 3, status: 'open', employmentType: 'full_time', createdById: pakistanUser.id, applicantCount: 7, shift: NIGHT_SHIFT },
    { jobType: 'external', title: 'Warehouse Supervisor', clientKey: 'maple', location: 'Mississauga, Ontario', department: 'Warehouse', description: 'Evening shift supervisor.', requirements: 'Prior supervisory experience.', responsibilities: 'Team leadership and safety.', openPositions: 2, status: 'closed', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 10, closedDaysAgo: 14, shift: AFTERNOON_SHIFT },
    { jobType: 'external', title: 'Teaching Assistant', clientKey: 'brightpath', location: 'North York, Ontario', department: 'Education', description: 'Classroom support roles.', requirements: 'Experience with children.', responsibilities: 'Assist teachers and students.', openPositions: 4, status: 'open', employmentType: 'part_time', createdById: srRecruiter.id, applicantCount: 12, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Store Manager', clientKey: 'summit', location: 'Etobicoke, Ontario', department: 'Retail', description: 'Store manager for west-end location.', requirements: '3+ years retail management.', responsibilities: 'Floor ops and KPIs.', openPositions: 1, status: 'open', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 6, shift: DAY_SHIFT },
    { jobType: 'external', title: 'LPN - Night Shift', clientKey: 'carebridge', location: 'Scarborough, Ontario', department: 'Healthcare', description: 'Overnight LPN coverage.', requirements: 'Active LPN; nights preferred.', responsibilities: 'Night rounds and meds.', openPositions: 4, status: 'open', employmentType: 'full_time', createdById: srRecruiter.id, applicantCount: 9, shift: NIGHT_SHIFT },
    { jobType: 'external', title: 'General Labourer', clientKey: 'harbor', location: 'Brampton, Ontario', department: 'Warehouse', description: 'General labour for inbound freight.', requirements: 'Steel-toe boots; reliable transport.', responsibilities: 'Loading and yard support.', openPositions: 10, status: 'open', employmentType: 'full_time', createdById: pakistanUser.id, applicantCount: 20, shift: DAY_SHIFT },
    { jobType: 'external', title: 'RN - Clinic', clientKey: 'citycare', location: 'Markham, Ontario', department: 'Healthcare', description: 'Clinic RN roles.', requirements: 'Active CNO; clinic experience preferred.', responsibilities: 'Triage and patient education.', openPositions: 3, status: 'open', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 8, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Packager', clientKey: 'maple', location: 'Mississauga, Ontario', department: 'Warehouse', description: 'Packaging line for e-commerce.', requirements: 'Standing for long periods.', responsibilities: 'Pack and label orders.', openPositions: 9, status: 'filled', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 15, closedDaysAgo: 7, shift: WEEKEND_SHIFT },
    { jobType: 'external', title: 'Receptionist', clientKey: 'brightpath', location: 'Toronto, Ontario', department: 'Administration', description: 'Front desk receptionist.', requirements: 'Professional phone manner.', responsibilities: 'Greeting and scheduling.', openPositions: 1, status: 'open', employmentType: 'part_time', createdById: srRecruiter.id, applicantCount: 4, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Warehouse Associate (Draft)', clientKey: 'maple', location: 'Mississauga, Ontario', department: 'Warehouse', description: 'Draft order — publish when client confirms headcount.', requirements: '1+ year warehouse experience.', responsibilities: 'Picking, packing, inventory.', openPositions: 5, status: 'draft', employmentType: 'full_time', createdById: recruiter1.id, applicantCount: 0, shift: DAY_SHIFT },
  ];

  const vancouverJobs: JobSpec[] = [
    { jobType: 'external', title: 'LPN - Long Term Care', clientKey: 'pacific', location: 'Vancouver, British Columbia', department: 'Healthcare', description: 'LPNs for Vancouver LTC partners.', requirements: 'Active BCCNM registration.', responsibilities: 'Resident care and charting.', openPositions: 5, status: 'open', employmentType: 'full_time', createdById: vancouverRecruiter.id, applicantCount: 11, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Senior CNC Operator', clientKey: 'westcoast', location: 'Burnaby, British Columbia', department: 'Production', description: 'CNC for Burnaby plant.', requirements: 'CNC experience; night shift flexible.', responsibilities: 'Setup and QC.', openPositions: 3, status: 'open', employmentType: 'full_time', createdById: vancouverRecruiter.id, applicantCount: 8, shift: NIGHT_SHIFT },
    { jobType: 'external', title: 'Store Manager', clientKey: 'cascade', location: 'Surrey, British Columbia', department: 'Retail', description: 'Store manager for Surrey.', requirements: '3+ years retail management.', responsibilities: 'Floor ops and scheduling.', openPositions: 1, status: 'open', employmentType: 'full_time', createdById: vancouverRecruiter.id, applicantCount: 4, shift: DAY_SHIFT },
    { jobType: 'external', title: 'Warehouse Associate', clientKey: 'fraser', location: 'Richmond, British Columbia', department: 'Warehouse', description: 'DC associates for Richmond.', requirements: 'Prior warehouse experience.', responsibilities: 'Picking and packing.', openPositions: 6, status: 'open', employmentType: 'full_time', createdById: vancouverRecruiter.id, applicantCount: 12, shift: AFTERNOON_SHIFT },
  ];

  const createdJobs: Array<{
    id: string;
    title: string;
    company: string;
    location: string;
    status: string;
    activeClientId: string;
    subCompanyId: string;
    openPositions: number;
    backupPercentage: number;
    requiredSkills: string[];
    shift: { startTime: string; endTime: string; workDays: string[] };
    salaryIndex: number;
  }> = [];

  const createJobs = async (
    specs: JobSpec[],
    subCompanyId: string,
    keyPrefix: 'to' | 'va',
  ) => {
    for (const [i, spec] of specs.entries()) {
      const client = activeClientsByKey.get(`${keyPrefix}:${spec.clientKey}`);
      if (!client) {
        throw new Error(`Active client key not found: ${keyPrefix}:${spec.clientKey}`);
      }
      const shift = spec.shift ?? DAY_SHIFT;
      const salaryMin = 18 + (i % 8);
      // Every 3rd job is fixed price (salaryMin === salaryMax); the rest are ranges.
      const isFixedPay = i % 3 === 0;
      // Mix of end dates: ending soon / overdue / far out / open-ended.
      const endOffsetDays =
        i % 4 === 1
          ? 3 + (i % 5)
          : i % 4 === 3
            ? -(2 + (i % 5))
            : i % 4 === 0
              ? 45 + i
              : null;
      const match = matchProfileForJobTitle(spec.title);
      const job = await prisma.job.create({
        data: {
          jobType: spec.jobType,
          title: spec.title,
          company: client.name,
          location: spec.location,
          department: spec.department,
          description: spec.description,
          requirements: spec.requirements,
          responsibilities: spec.responsibilities,
          openPositions: spec.openPositions,
          backupPercentage: DEFAULT_BACKUP_PERCENTAGE,
          status: spec.status,
          employmentType: spec.employmentType,
          salaryMin,
          salaryMax: isFixedPay ? salaryMin : salaryMin + 4,
          createdById: spec.createdById,
          applicantCount: spec.applicantCount,
          publishLinkedin: spec.status !== 'draft',
          publishIndeed: spec.status !== 'draft',
          publishedAt: spec.status === 'draft' ? null : daysFromSeed(-30 - i, 9),
          closedAt: spec.closedDaysAgo != null ? daysFromSeed(-spec.closedDaysAgo, 16) : null,
          subCompanyId,
          activeClientId: client.id,
          licenseRequired: match.licenseRequired,
          requiredLicenseTypes: match.requiredLicenseTypes,
          shiftSchedule: {
            startTime: shift.startTime,
            endTime: shift.endTime,
            workDays: shift.workDays,
            jobStartDate: daysFromSeed(-25 - i, 8).toISOString(),
            jobEndDate:
              endOffsetDays != null ? daysFromSeed(endOffsetDays, 17).toISOString() : null,
          } as unknown as Prisma.InputJsonValue,
          screeningCriteria: {
            requiredSkills: match.requiredSkills,
            preferredSkills: [],
            minExperienceYears: 1,
            remoteOption: 'onsite',
          } as unknown as Prisma.InputJsonValue,
        },
      });
      createdJobs.push({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        status: job.status,
        activeClientId: client.id,
        subCompanyId,
        openPositions: spec.openPositions,
        backupPercentage: DEFAULT_BACKUP_PERCENTAGE,
        requiredSkills: match.requiredSkills,
        shift,
        salaryIndex: i,
      });
    }
  };

  await createJobs(torontoJobs, subCompanyTorontoId, 'to');
  await createJobs(vancouverJobs, subCompanyVancouverId, 'va');

  // ── 3. Employees ────────────────────────────────────────────────────────────
  const torontoEmployees = buildRoster({
    firstNames: TORONTO_FIRST,
    lastNames: TORONTO_LAST,
    cities: TORONTO_CITIES,
    phonePrefix: '+1-416-555-',
    emailDomain: 'mail.demo',
    adders: [recruiter1, srRecruiter, pakistanUser],
    // ~70 Toronto: 8 unregistered, 12 pending, 25 active, 17 master, 8 rejected
    counts: { unregistered: 8, pending: 12, active: 25, master: 17, rejected: 8 },
  });

  // Named Master demos — guaranteed skill/license matches for Job Matches / Link UI.
  const torontoDemoMasters: EmpSpec[] = [
    {
      firstName: 'Alex',
      lastName: 'Forklift',
      email: 'alex.forklift.demo@mail.demo',
      phone: '+1-416-555-9001',
      city: 'Scarborough',
      province: 'Ontario',
      postalCode: 'M1B 2K1',
      employeeType: 'external',
      availabilityTypes: ['full_time'],
      skills: ['Forklift Operator', 'Warehouse'],
      workStatus: 'none',
      approvalStatus: 'approved',
      position: 'Forklift Driver',
      addedById: recruiter1.id,
      hireDaysAgo: 45,
    },
    {
      firstName: 'Sam',
      lastName: 'Warehouse',
      email: 'sam.warehouse.demo@mail.demo',
      phone: '+1-416-555-9002',
      city: 'Mississauga',
      province: 'Ontario',
      postalCode: 'L5B 1M2',
      employeeType: 'external',
      availabilityTypes: ['full_time'],
      skills: ['Warehouse', 'Picker / Packer', 'General Labour'],
      workStatus: 'none',
      approvalStatus: 'approved',
      position: 'Warehouse Associate',
      addedById: srRecruiter.id,
      hireDaysAgo: 40,
    },
    {
      firstName: 'Jordan',
      lastName: 'Foodline',
      email: 'jordan.foodline.demo@mail.demo',
      phone: '+1-416-555-9003',
      city: 'Markham',
      province: 'Ontario',
      postalCode: 'L3R 0B2',
      employeeType: 'external',
      availabilityTypes: ['full_time', 'part_time'],
      skills: ['Food Production', 'General Labour'],
      workStatus: 'none',
      approvalStatus: 'approved',
      position: 'Production Worker',
      addedById: recruiter1.id,
      hireDaysAgo: 35,
    },
    {
      firstName: 'Casey',
      lastName: 'Machine',
      email: 'casey.machine.demo@mail.demo',
      phone: '+1-416-555-9004',
      city: 'Brampton',
      province: 'Ontario',
      postalCode: 'L6T 0A1',
      employeeType: 'external',
      availabilityTypes: ['full_time'],
      skills: ['Machine Operator', 'First Aid Certified'],
      workStatus: 'none',
      approvalStatus: 'approved',
      position: 'CNC Operator',
      addedById: pakistanUser.id,
      hireDaysAgo: 30,
    },
  ];
  torontoEmployees.push(...torontoDemoMasters);

  // One submitted pending without training certs — RM approve blocked until Training complete.
  torontoEmployees.push({
    firstName: 'Blake',
    lastName: 'PendingGate',
    email: 'blake.pendinggate.demo@mail.demo',
    phone: '+1-416-555-9010',
    city: 'Toronto',
    province: 'Ontario',
    postalCode: 'M5H 2N2',
    employeeType: 'external',
    availabilityTypes: ['full_time'],
    skills: ['Warehouse'],
    workStatus: 'none',
    approvalStatus: 'pending',
    submittedForApproval: true,
    trainingsIncomplete: true,
    position: 'Warehouse Associate',
    addedById: recruiter1.id,
  });

  const vancouverEmployees = buildRoster({
    firstNames: VANCOUVER_FIRST,
    lastNames: VANCOUVER_LAST,
    cities: VANCOUVER_CITIES,
    phonePrefix: '+1-604-555-',
    emailDomain: 'mail.demo',
    adders: [vancouverRecruiter],
    // ~13 Vancouver
    counts: { unregistered: 2, pending: 2, active: 5, master: 2, rejected: 2 },
  });

  vancouverEmployees.push({
    firstName: 'Riley',
    lastName: 'Fraser',
    email: 'riley.fraser.demo@mail.demo',
    phone: '+1-604-555-9001',
    city: 'Richmond',
    province: 'British Columbia',
    postalCode: 'V6X 2A9',
    employeeType: 'external',
    availabilityTypes: ['full_time'],
    skills: ['Warehouse', 'General Labour'],
    workStatus: 'none',
    approvalStatus: 'approved',
    position: 'Warehouse Associate',
    addedById: vancouverRecruiter.id,
    hireDaysAgo: 28,
  });

  const employeesSpec = [...torontoEmployees, ...vancouverEmployees];
  const createdEmployees: Array<{
    id: string;
    approvalStatus: string | null;
    workStatus: string | null;
    province: string | null;
    tags: string[];
    skills: string[];
  }> = [];

  for (const spec of employeesSpec) {
    const isPending = spec.approvalStatus === 'pending';
    const isRejected = spec.approvalStatus === 'rejected';
    const isApproved = spec.approvalStatus === 'approved';
    const isSubmitted = isPending && spec.submittedForApproval === true;
    const idx = createdEmployees.length;
    const profile = buildDemoEmployeeProfile(
      idx,
      spec.firstName,
      spec.lastName,
      spec.position,
      daysFromSeed,
    );

    const employee = await prisma.employee.create({
      data: {
        employeeType: spec.employeeType,
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: spec.email,
        phone: spec.phone,
        address: `${100 + idx} King Street, ${spec.city}`,
        city: spec.city,
        province: spec.province,
        postalCode: spec.postalCode,
        country: 'Canada',
        gender: profile.gender,
        dateOfBirth: profile.dateOfBirth,
        emergencyContactName: profile.emergencyContactName,
        emergencyContactPhone: profile.emergencyContactPhone,
        educationLevel: profile.educationLevel,
        educationFromYear: profile.educationFromYear,
        educationEndYear: profile.educationEndYear,
        graduated: profile.graduated,
        courseStudied: profile.courseStudied,
        diplomaName: profile.diplomaName,
        experienceDuties: profile.experienceDuties,
        availableFrom: profile.availableFrom,
        ableTwelveHourShift: profile.ableTwelveHourShift,
        availabilityTypes: [...spec.availabilityTypes],
        skills: [...spec.skills],
        residencyStatus: idx % 4 === 0 ? 'pr' : 'citizen',
        shiftsAvailable: ['Day', 'Afternoon'],
        englishProficiency: profile.englishProficiency,
        workStatus: spec.workStatus,
        approvalStatus: spec.approvalStatus,
        position: spec.position,
        hireDate: spec.hireDaysAgo != null ? daysFromSeed(-spec.hireDaysAgo, 9) : null,
        hourlyRate: 18 + (idx % 10),
        salaryPaymentMethod: profile.salaryPaymentMethod,
        bankName: profile.bankName,
        bankInstitutionNumber: profile.bankInstitutionNumber,
        bankTransitNumber: profile.bankTransitNumber,
        bankAccountNumber: profile.bankAccountNumber,
        uiExtras: profile.uiExtras as unknown as Prisma.InputJsonValue,
        addedById: spec.addedById,
        submitterRole: isSubmitted ? 'recruiter' : null,
        approvalChain: (isSubmitted ? [...RM_CHAIN] : []) as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
        approvedById: isApproved ? recruitmentManager.id : null,
        approvedAt: isApproved ? daysFromSeed(-(spec.hireDaysAgo ?? 30) + 2, 11) : null,
        rejectedById: isRejected ? recruitmentManager.id : null,
        rejectedAt: isRejected ? daysFromSeed(-40 - (idx % 10), 14) : null,
        rejectionReason: isRejected
          ? (spec.rejectionReason ?? 'Did not complete screening requirements')
          : null,
        tags: spec.tags?.length ? { create: spec.tags.map((tag) => ({ tag })) } : undefined,
        workExperiences: {
          create: profile.workExperiences,
        },
      },
    });
    createdEmployees.push({
      id: employee.id,
      approvalStatus: employee.approvalStatus,
      workStatus: employee.workStatus,
      province: employee.province,
      tags: spec.tags ?? [],
      skills: [...spec.skills],
    });

    // Required docs so RM can approve submitted pending employees via the chain.
    if (isSubmitted || isApproved) {
      for (const doc of REQUIRED_DOC_TYPES) {
        await prisma.employeeDocument.create({
          data: {
            employeeId: employee.id,
            type: doc.type,
            name: doc.name,
            fileName: doc.fileName,
            fileSize: 12_000,
            mimeType: 'application/pdf',
            url: `seed://employees/${employee.id}/${doc.fileName}`,
            uploadedById: spec.addedById,
            expiryDate: profile.docExpiries[doc.type] ?? null,
          },
        });
      }
      if (profile.salaryPaymentMethod === 'deposit') {
        await prisma.employeeDocument.create({
          data: {
            employeeId: employee.id,
            type: 'bank_deposit',
            name: 'deposit — void-cheque.pdf',
            fileName: 'void-cheque.pdf',
            fileSize: 10_000,
            mimeType: 'application/pdf',
            url: `seed://employees/${employee.id}/void-cheque.pdf`,
            uploadedById: spec.addedById,
          },
        });
      }
      // License docs for skills that require certification (Documents panel / form).
      for (const licenseType of licenseTypesForSkills(spec.skills)) {
        const slug = licenseType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        await prisma.employeeDocument.create({
          data: {
            employeeId: employee.id,
            type: 'other',
            name: `license — ${licenseType}`,
            fileName: `${slug}.pdf`,
            fileSize: 8_000,
            mimeType: 'application/pdf',
            url: `seed://employees/${employee.id}/${slug}.pdf`,
            uploadedById: spec.addedById,
            expiryDate: daysFromSeed(180 + (createdEmployees.length % 90), 12),
          },
        });
      }

      // Default trainings complete (Master approve gate) unless intentionally blocked.
      if (!spec.trainingsIncomplete) {
        const sentAt = daysFromSeed(-(spec.hireDaysAgo ?? 20) - 3, 10);
        const completedAt = daysFromSeed(-(spec.hireDaysAgo ?? 20) - 1, 14);
        for (const def of SEED_DEFAULT_TRAININGS) {
          const slug = def.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const cert = await prisma.employeeDocument.create({
            data: {
              employeeId: employee.id,
              type: 'training_certificate',
              name: `${def.title} Certificate`,
              fileName: `${slug}-cert.pdf`,
              fileSize: 6_000,
              mimeType: 'application/pdf',
              url: `seed://employees/${employee.id}/${slug}-cert.pdf`,
              uploadedById: spec.addedById,
            },
          });
          await prisma.employeeTraining.create({
            data: {
              employeeId: employee.id,
              title: def.title,
              url: def.url,
              channel: 'email',
              sentAt,
              sentById: spec.addedById,
              completedAt,
              certificateDocumentId: cert.id,
            },
          });
        }
      } else {
        // Links sent but no certificates — shows incomplete Training on Pending.
        const sentAt = daysFromSeed(-2, 10);
        for (const def of SEED_DEFAULT_TRAININGS) {
          await prisma.employeeTraining.create({
            data: {
              employeeId: employee.id,
              title: def.title,
              url: def.url,
              channel: 'email',
              sentAt,
              sentById: spec.addedById,
            },
          });
        }
      }
    }

    // Work experience on a subset of approved employees (Master / Active polish).
    if (isApproved && createdEmployees.length % 4 === 0) {
      await prisma.employeeWorkExperience.create({
        data: {
          employeeId: employee.id,
          companyName: 'Prior Staffing Placement Co',
          contactNumber: '+1-416-555-0100',
          position: spec.position,
          duration: '8 months',
          sortOrder: 0,
        },
      });
      if (createdEmployees.length % 8 === 0) {
        await prisma.employeeWorkExperience.create({
          data: {
            employeeId: employee.id,
            companyName: 'Metro Warehouse Ltd',
            contactNumber: '+1-905-555-0199',
            position: 'General Labour',
            duration: '1 year',
            sortOrder: 1,
          },
        });
      }
    }
  }

  // ── 4. Placements: JobAssignment roster + approved EmployeeAssignment ──────
  let jobAssignmentCount = 0;
  let employeeAssignmentCount = 0;

  const cleanEmp = (e: (typeof createdEmployees)[number]) =>
    !e.tags.some((t) => t === 'blacklisted' || t === 'ex' || t === 'no_show');

  const placeOnJob = async (params: {
    employee: (typeof createdEmployees)[number];
    job: (typeof createdJobs)[number];
    isBackup: boolean;
    assignedById: string;
    daysAgo: number;
  }) => {
    const { employee, job, isBackup, assignedById, daysAgo } = params;
    await prisma.jobAssignment.create({
      data: {
        jobId: job.id,
        employeeId: employee.id,
        isBackup,
        isActive: true,
        assignedById,
        assignedAt: daysFromSeed(-daysAgo, 10),
      },
    });
    jobAssignmentCount++;

    await prisma.employeeAssignment.create({
      data: {
        employeeId: employee.id,
        targetType: 'job',
        jobId: job.id,
        activeClientId: job.activeClientId,
        workLocation: job.location,
        positionTitle: job.title,
        payRate: payRateFor(job.salaryIndex),
        shiftSchedule: shiftLabel(job.shift),
        expectedDuration: 'Ongoing',
        supervisorInfo: 'Site supervisor — details at orientation',
        requiredPpe: 'Steel-toe boots, hi-vis vest',
        detailsSentToCandidateAt: daysFromSeed(-daysAgo - 1, 9),
        status: 'approved',
        isActive: true,
        isBackup,
        submittedById: assignedById,
        submitterRole: 'recruiter',
        approvedById: recruitmentManager.id,
        approvedAt: daysFromSeed(-daysAgo, 11),
        approvalChain: [...RM_CHAIN] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeAssignmentCount++;

    await prisma.employee.update({
      where: { id: employee.id },
      data: { workStatus: isBackup ? 'scheduled' : 'active' },
    });
  };

  const takeNextActive = (
    pool: Array<(typeof createdEmployees)[number]>,
    used: Set<string>,
    reserveTail: number,
    preferredSkills: string[],
  ): (typeof createdEmployees)[number] | null => {
    const available = pool.filter((e) => !used.has(e.id));
    if (available.length <= reserveTail) return null;
    const candidates = available.slice(0, available.length - reserveTail);
    if (preferredSkills.length > 0) {
      const match = candidates.find((e) =>
        preferredSkills.every((s) => e.skills.includes(s)),
      );
      if (match) return match;
    }
    return candidates[0] ?? null;
  };

  const torontoActive = createdEmployees.filter(
    (e) => e.approvalStatus === 'approved' && e.workStatus === 'active' && e.province === 'Ontario' && cleanEmp(e),
  );
  const torontoOpenJobs = createdJobs.filter(
    (j) => j.status === 'open' && j.subCompanyId === subCompanyTorontoId && j.activeClientId,
  );

  // Capacity-safe fill: primaries ≤ openPositions, total ≤ ceil(open × 1.7).
  // Demo fill targets ~2 primaries + 1 backup (clamped). Keep 3 actives for client-only.
  const CLIENT_ONLY_RESERVE = 3;
  const usedToronto = new Set<string>();
  for (const job of torontoOpenJobs) {
    const capacity = rosterCapacity(job.openPositions, job.backupPercentage);
    const primaryTarget = Math.min(2, job.openPositions, capacity);
    const backupTarget = Math.min(1, Math.max(0, capacity - primaryTarget));

    for (let p = 0; p < primaryTarget; p++) {
      const employee = takeNextActive(
        torontoActive,
        usedToronto,
        CLIENT_ONLY_RESERVE,
        job.requiredSkills,
      );
      if (!employee) break;
      usedToronto.add(employee.id);
      await placeOnJob({
        employee,
        job,
        isBackup: false,
        assignedById: usedToronto.size % 2 === 0 ? recruiter1.id : srRecruiter.id,
        daysAgo: 5 + usedToronto.size,
      });
    }
    for (let b = 0; b < backupTarget; b++) {
      const employee = takeNextActive(
        torontoActive,
        usedToronto,
        CLIENT_ONLY_RESERVE,
        job.requiredSkills,
      );
      if (!employee) break;
      usedToronto.add(employee.id);
      await placeOnJob({
        employee,
        job,
        isBackup: true,
        assignedById: usedToronto.size % 2 === 0 ? recruiter1.id : srRecruiter.id,
        daysAgo: 5 + usedToronto.size,
      });
    }
  }

  // Few Toronto actives: direct Active Client placements (no job) → Active with Client tab.
  const torontoClientKeys = ['maple', 'citycare', 'carebridge'] as const;
  const torontoClientOnly = torontoActive
    .filter((e) => !usedToronto.has(e.id))
    .slice(0, CLIENT_ONLY_RESERVE);
  for (let i = 0; i < torontoClientOnly.length; i++) {
    const employee = torontoClientOnly[i]!;
    usedToronto.add(employee.id);
    const client = toClient(torontoClientKeys[i % torontoClientKeys.length]!);
    await prisma.employeeAssignment.create({
      data: {
        employeeId: employee.id,
        targetType: 'client',
        activeClientId: client.id,
        workLocation: 'Client site — see details',
        positionTitle: POSITIONS[i % POSITIONS.length]!,
        payRate: payRateFor(i),
        shiftSchedule: shiftLabel(DAY_SHIFT),
        expectedDuration: '6 months',
        supervisorInfo: `${client.name} site supervisor`,
        requiredPpe: 'Standard site PPE',
        detailsSentToCandidateAt: daysFromSeed(-6 - i, 9),
        status: 'approved',
        isActive: true,
        submittedById: recruiter1.id,
        submitterRole: 'recruiter',
        approvedById: recruitmentManager.id,
        approvedAt: daysFromSeed(-5 - i, 10),
        approvalChain: [...RM_CHAIN] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeAssignmentCount++;
  }

  // Leftover active-bucket employees (no placement) → Master so they are free for instant job demos.
  for (const employee of torontoActive.filter((e) => !usedToronto.has(e.id))) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { workStatus: 'none' },
    });
  }

  // Vancouver: place actives on jobs (leave last for client-only), capacity-safe.
  const vancouverActive = createdEmployees.filter(
    (e) => e.approvalStatus === 'approved' && e.workStatus === 'active' && e.province === 'British Columbia' && cleanEmp(e),
  );
  const vancouverOpenJobs = createdJobs.filter(
    (j) => j.status === 'open' && j.subCompanyId === subCompanyVancouverId && j.activeClientId,
  );
  const usedVancouver = new Set<string>();
  const VA_CLIENT_RESERVE = 1;
  for (const job of vancouverOpenJobs) {
    const capacity = rosterCapacity(job.openPositions, job.backupPercentage);
    if (capacity < 1) continue;
    const employee = takeNextActive(
      vancouverActive,
      usedVancouver,
      VA_CLIENT_RESERVE,
      job.requiredSkills,
    );
    if (!employee) break;
    usedVancouver.add(employee.id);
    await placeOnJob({
      employee,
      job,
      isBackup: false,
      assignedById: vancouverRecruiter.id,
      daysAgo: 4 + usedVancouver.size,
    });
  }
  if (vancouverActive.length > 0) {
    const last =
      vancouverActive.find((e) => !usedVancouver.has(e.id)) ??
      vancouverActive[vancouverActive.length - 1]!;
    usedVancouver.add(last.id);
    const client = vaClient('pacific');
    await prisma.employeeAssignment.create({
      data: {
        employeeId: last.id,
        targetType: 'client',
        activeClientId: client.id,
        workLocation: 'Vancouver care home',
        positionTitle: 'LPN - Long Term Care',
        payRate: '$26–$30/hr',
        shiftSchedule: shiftLabel(DAY_SHIFT),
        expectedDuration: 'Ongoing',
        supervisorInfo: 'Director of Care',
        requiredPpe: 'Scrubs, N95 fit-tested',
        detailsSentToCandidateAt: daysFromSeed(-4, 9),
        status: 'approved',
        isActive: true,
        submittedById: vancouverRecruiter.id,
        submitterRole: 'recruiter',
        approvedById: recruitmentManager.id,
        approvedAt: daysFromSeed(-3, 12),
        approvalChain: [...RM_CHAIN] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeAssignmentCount++;
  }

  // Leftover Vancouver actives without placement → Master.
  for (const employee of vancouverActive.filter((e) => !usedVancouver.has(e.id))) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { workStatus: 'none' },
    });
  }

  // ── 5. Ended placements with ratings (employment history) ──────────────────
  const torontoMaster = createdEmployees.filter(
    (e) => e.approvalStatus === 'approved' && e.workStatus === 'none' && e.province === 'Ontario' && cleanEmp(e),
  );
  const closedJobs = createdJobs.filter((j) => j.status !== 'open' && j.subCompanyId === subCompanyTorontoId);
  const endReasons = ['work_complete', 'not_performing', 'other'] as const;
  const endNotes = [
    'Contract completed successfully.',
    'Struggled with attendance in final month.',
    'Client downsized the shift.',
  ];

  const historyCount = Math.min(6, torontoMaster.length);
  for (let i = 0; i < historyCount; i++) {
    const employee = torontoMaster[i]!;
    const job = closedJobs[i % Math.max(1, closedJobs.length)] ?? torontoOpenJobs[i % torontoOpenJobs.length]!;
    const endedDaysAgo = 10 + i * 4;
    // Inactive roster row (historical)
    await prisma.jobAssignment.create({
      data: {
        jobId: job.id,
        employeeId: employee.id,
        isBackup: false,
        isActive: false,
        assignedById: recruiter1.id,
        assignedAt: daysFromSeed(-endedDaysAgo - 60, 10),
      },
    });
    jobAssignmentCount++;
    await prisma.employeeAssignment.create({
      data: {
        employeeId: employee.id,
        targetType: 'job',
        jobId: job.id,
        activeClientId: job.activeClientId,
        workLocation: job.location,
        positionTitle: job.title,
        payRate: payRateFor(job.salaryIndex),
        shiftSchedule: shiftLabel(job.shift),
        expectedDuration: '3 months',
        supervisorInfo: 'Site supervisor',
        requiredPpe: 'Standard site PPE',
        detailsSentToCandidateAt: daysFromSeed(-endedDaysAgo - 61, 9),
        status: 'approved',
        isActive: false,
        isBackup: false,
        endedAt: daysFromSeed(-endedDaysAgo, 15),
        endReason: endReasons[i % endReasons.length],
        endNotes: endNotes[i % endNotes.length],
        rating: 3 + (i % 3),
        submittedById: recruiter1.id,
        submitterRole: 'recruiter',
        approvedById: recruitmentManager.id,
        approvedAt: daysFromSeed(-endedDaysAgo - 60, 11),
        approvalChain: [...RM_CHAIN] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeAssignmentCount++;
  }

  // ── 6. Pending client assignment requests (RM dashboard) ───────────────────
  // Job placements are instant in product — do NOT seed pending targetType=job.
  const masterForPending = torontoMaster.slice(historyCount);
  if (masterForPending[0]) {
    const client = toClient('metalworks');
    await prisma.employeeAssignment.create({
      data: {
        employeeId: masterForPending[0].id,
        targetType: 'client',
        activeClientId: client.id,
        workLocation: 'Brampton plant — Gate 3',
        positionTitle: 'CNC Operator',
        payRate: '$24–$28/hr',
        shiftSchedule: shiftLabel(AFTERNOON_SHIFT),
        expectedDuration: '12 months',
        supervisorInfo: 'Plant supervisor — S. Mehta',
        requiredPpe: 'Safety glasses, steel-toe boots, hearing protection',
        detailsSentToCandidateAt: daysFromSeed(-1, 9),
        status: 'pending',
        isActive: false,
        submittedById: recruiter1.id,
        submitterRole: 'recruiter',
        approvalChain: [...RM_CHAIN] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeAssignmentCount++;
  }

  const vancouverMaster = createdEmployees.filter(
    (e) => e.approvalStatus === 'approved' && e.workStatus === 'none' && e.province === 'British Columbia' && cleanEmp(e),
  );
  if (vancouverMaster[0]) {
    const client = vaClient('fraser');
    await prisma.employeeAssignment.create({
      data: {
        employeeId: vancouverMaster[0].id,
        targetType: 'client',
        activeClientId: client.id,
        workLocation: 'Richmond DC — Dock B',
        positionTitle: 'Warehouse Associate',
        payRate: '$20–$24/hr',
        shiftSchedule: shiftLabel(AFTERNOON_SHIFT),
        expectedDuration: '6 months',
        supervisorInfo: 'DC supervisor — K. Ito',
        requiredPpe: 'Steel-toe boots, hi-vis vest',
        detailsSentToCandidateAt: daysFromSeed(-1, 10),
        status: 'pending',
        isActive: false,
        submittedById: vancouverRecruiter.id,
        submitterRole: 'recruiter',
        approvalChain: [...RM_CHAIN] as unknown as Prisma.InputJsonValue,
        currentStepIndex: 0,
      },
    });
    employeeAssignmentCount++;
  }

  // ── 7. Recompute job filled/scheduled counts from the actual roster ────────
  for (const job of createdJobs) {
    const roster = await prisma.jobAssignment.findMany({
      where: { jobId: job.id, isActive: true },
      select: { isBackup: true },
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        filledPositions: roster.filter((r) => !r.isBackup).length,
        scheduledPositions: roster.filter((r) => r.isBackup).length,
      },
    });
  }

  console.log(
    `  ✓ Recruitment seed: ${activeClientCount} active clients, ${createdJobs.length} jobs, ${createdEmployees.length} employees ` +
    `(${torontoEmployees.length} Toronto / ${vancouverEmployees.length} Vancouver), ` +
    `${jobAssignmentCount} job roster rows, ${employeeAssignmentCount} employee assignments (active + ended + pending)`,
  );
  console.log(
    '  ✓ Rules: all jobs external + activeClientId; capacity-safe rosters; isBackup on job placements; ' +
      'default trainings complete for approve demos (blake.pendinggate.demo@mail.demo = incomplete gate)',
  );
  console.log(
    '  ✓ Skill/license match demos: alex.forklift.demo@mail.demo → Forklift Driver; ' +
      'jordan.foodline.demo@mail.demo → Production Worker; sam.warehouse.demo@mail.demo → Warehouse jobs',
  );

  return {
    activeClientCount,
    jobCount: createdJobs.length,
    employeeCount: createdEmployees.length,
    jobAssignmentCount,
    employeeAssignmentCount,
  };
}
