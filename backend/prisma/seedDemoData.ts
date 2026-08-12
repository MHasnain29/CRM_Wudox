import type { ApprovalWorkflowType, PrismaClient, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { buildApprovalChain, initialStepIndexForSubmitter } from '../src/services/approvalChain';
import { GLOBAL_APPROVAL_SCOPE } from '../src/types/approval';

/** Opt-in only: when `SEED_ALL_SUPER_ADMIN=true`, every user gets super_admin (breaks Super Users + approval demos). */
export function isSeedAllSuperAdmin(): boolean {
  return process.env.SEED_ALL_SUPER_ADMIN === 'true';
}

export type SeedUserKey =
  | 'superAdmin'
  | 'director'
  | 'companyDirector'
  | 'companyDirectorVancouver'
  | 'salesManager1'
  | 'salesManager2'
  | 'salesAssociate1'
  | 'salesAssociate2'
  | 'vancouverAssociate'
  | 'vancouverAssociate2'
  | 'recruiter1'
  | 'vancouverRecruiter'
  | 'pakistanUser'
  | 'recruitmentManager'
  | 'recruitmentManagerVancouver'
  | 'salesExecutive'
  | 'srRecruiter'
  | 'dataEntrySpecialist'
  | 'databaseManager'
  | 'operationsManager'
  | 'itUser'
  | 'devTeamUser';

type AgencyKey = 'toronto' | 'vancouver';
type LocationKey = 'toronto' | 'vancouver' | 'pakistan';

interface SeedUserDef {
  key: SeedUserKey;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  role: string;
  userType: string;
  agency?: AgencyKey | null;
  location?: LocationKey | null;
  reportingTo?: SeedUserKey[];
  dailyCallsTarget?: number;
  dailyEmailsTarget?: number;
}

const SEED_USER_DEFS: SeedUserDef[] = [
  {
    key: 'superAdmin',
    email: 'hassan@wudox.com',
    firstName: 'Hassan',
    lastName: 'Super Admin',
    phone: '+1-416-555-0000',
    country: 'Canada',
    role: 'super_admin',
    userType: 'Super Admin',
    agency: null,
    location: null,
  },
  {
    key: 'director',
    email: 'director@nastaffing.com',
    firstName: 'John',
    lastName: 'Director',
    phone: '+1-416-555-0100',
    country: 'Canada',
    role: 'director',
    userType: 'Director',
    agency: null,
    location: null,
  },
  {
    key: 'companyDirector',
    email: 'company.director@nastaffing.com',
    firstName: 'Robert',
    lastName: 'Hayes',
    phone: '+1-416-555-0107',
    country: 'Canada',
    role: 'company_director',
    userType: 'Company Director',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['director'],
  },
  {
    key: 'salesManager1',
    email: 'manager1@nastaffing.com',
    firstName: 'Sarah',
    lastName: 'Manager',
    phone: '+1-416-555-0101',
    country: 'Canada',
    role: 'sales_manager',
    userType: 'Sales Manager',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['companyDirector'],
    dailyCallsTarget: 50,
    dailyEmailsTarget: 30,
  },
  {
    key: 'companyDirectorVancouver',
    email: 'company.director.vancouver@nastaffing.com',
    firstName: 'Emily',
    lastName: 'Nguyen',
    phone: '+1-604-555-0108',
    country: 'Canada',
    role: 'company_director',
    userType: 'Company Director',
    agency: 'vancouver',
    location: 'vancouver',
    reportingTo: ['director'],
  },
  {
    key: 'salesManager2',
    email: 'manager2@nastaffing.com',
    firstName: 'Michael',
    lastName: 'Chen',
    phone: '+1-604-555-0102',
    country: 'Canada',
    role: 'sales_manager',
    userType: 'Sales Manager',
    agency: 'vancouver',
    location: 'vancouver',
    reportingTo: ['companyDirectorVancouver'],
    dailyCallsTarget: 50,
    dailyEmailsTarget: 30,
  },
  {
    key: 'salesAssociate1',
    email: 'associate1@nastaffing.com',
    firstName: 'Emily',
    lastName: 'Johnson',
    phone: '+1-416-555-0103',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['salesManager1'],
    dailyCallsTarget: 100,
    dailyEmailsTarget: 50,
  },
  {
    key: 'salesAssociate2',
    email: 'associate2@hrglobal.ca',
    firstName: 'David',
    lastName: 'Williams',
    phone: '+1-416-555-0104',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['salesManager1'],
    dailyCallsTarget: 100,
    dailyEmailsTarget: 50,
  },
  {
    key: 'vancouverAssociate',
    email: 'associate.vancouver@nastaffing.com',
    firstName: 'Maya',
    lastName: 'Patel',
    phone: '+1-604-555-0103',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    agency: 'vancouver',
    location: 'vancouver',
    reportingTo: ['salesManager2'],
    dailyCallsTarget: 90,
    dailyEmailsTarget: 45,
  },
  {
    key: 'vancouverAssociate2',
    email: 'associate2.vancouver@nastaffing.com',
    firstName: 'Noah',
    lastName: 'Wilson',
    phone: '+1-604-555-0104',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    agency: 'vancouver',
    location: 'vancouver',
    reportingTo: ['salesManager2'],
    dailyCallsTarget: 90,
    dailyEmailsTarget: 45,
  },
  {
    key: 'recruiter1',
    email: 'recruiter1@nastaffing.com',
    firstName: 'Lisa',
    lastName: 'Anderson',
    phone: '+1-416-555-0105',
    country: 'Canada',
    role: 'recruiter',
    userType: 'Recruiter',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['recruitmentManager'],
  },
  {
    key: 'vancouverRecruiter',
    email: 'recruiter.vancouver@nastaffing.com',
    firstName: 'Olivia',
    lastName: 'Martin',
    phone: '+1-604-555-0105',
    country: 'Canada',
    role: 'recruiter',
    userType: 'Recruiter',
    agency: 'vancouver',
    location: 'vancouver',
    reportingTo: ['recruitmentManagerVancouver'],
  },
  {
    key: 'pakistanUser',
    email: 'pakistan@nastaffing.com',
    firstName: 'Ahmed',
    lastName: 'Khan',
    phone: '+92-300-1234567',
    country: 'Pakistan',
    role: 'recruiter',
    userType: 'Recruiter',
    agency: 'toronto',
    location: 'pakistan',
    reportingTo: ['director'],
  },
  {
    key: 'recruitmentManager',
    email: 'recruitment.manager@nastaffing.com',
    firstName: 'Zara',
    lastName: 'Sheikh',
    phone: '+1-416-555-0106',
    country: 'Canada',
    role: 'recruitment_manager',
    userType: 'Recruitment Manager',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['director'],
  },
  {
    key: 'recruitmentManagerVancouver',
    email: 'recruitment.manager.vancouver@nastaffing.com',
    firstName: 'Zara',
    lastName: 'Sheikh',
    phone: '+1-604-555-0106',
    country: 'Canada',
    role: 'recruitment_manager',
    userType: 'Recruitment Manager',
    agency: 'vancouver',
    location: 'vancouver',
    reportingTo: ['director'],
  },
  {
    key: 'salesExecutive',
    email: 'executive@nastaffing.com',
    firstName: 'Ryan',
    lastName: 'Thompson',
    phone: '+1-416-555-0107',
    country: 'Canada',
    role: 'sales_executive',
    userType: 'Sales Executive',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['salesManager1'],
    dailyCallsTarget: 80,
    dailyEmailsTarget: 40,
  },
  {
    key: 'srRecruiter',
    email: 'sr.recruiter@nastaffing.com',
    firstName: 'Nadia',
    lastName: 'Ali',
    phone: '+1-416-555-0108',
    country: 'Canada',
    role: 'sr_recruiter',
    userType: 'Senior Recruiter',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['recruitmentManager'],
  },
  {
    key: 'dataEntrySpecialist',
    email: 'dataentry@nastaffing.com',
    firstName: 'Omar',
    lastName: 'Farooq',
    phone: '+92-321-5556789',
    country: 'Pakistan',
    role: 'data_entry_specialist',
    userType: 'Data Entry Specialist',
    agency: null,
    location: null,
    reportingTo: ['director'],
  },
  {
    key: 'databaseManager',
    email: 'db.manager@nastaffing.com',
    firstName: 'Sara',
    lastName: 'Malik',
    phone: '+92-333-1112233',
    country: 'Pakistan',
    role: 'database_manager',
    userType: 'Database Manager',
    agency: null,
    location: null,
    reportingTo: ['director'],
  },
  {
    key: 'operationsManager',
    email: 'operations@nastaffing.com',
    firstName: 'Kevin',
    lastName: 'Murphy',
    phone: '+1-604-555-0109',
    country: 'Canada',
    role: 'operations_manager',
    userType: 'Operations Manager',
    agency: null,
    location: null,
    reportingTo: ['director'],
  },
  {
    key: 'itUser',
    email: 'it@nastaffing.com',
    firstName: 'Alex',
    lastName: 'Dev',
    phone: '+1-416-555-0110',
    country: 'Canada',
    role: 'it',
    userType: 'IT',
    agency: 'toronto',
    location: 'toronto',
    reportingTo: ['director'],
  },
  {
    key: 'devTeamUser',
    email: 'devteam@wudox.com',
    firstName: 'Dev',
    lastName: 'Team',
    phone: '+1-416-555-0111',
    country: 'Canada',
    role: 'dev_team',
    userType: 'Dev Team',
    agency: 'toronto',
    location: 'toronto',
  },
];

export type SeedUsersResult = Record<SeedUserKey, User> & { allSeedUsers: User[] };

export interface SeedUsersContext {
  subCompanyTorontoId: string;
  subCompanyVancouverId: string;
  locationTorontoId: string;
  locationVancouverId: string;
  locationPakistanId: string;
}

export async function seedUsers(
  prisma: PrismaClient,
  ctx: SeedUsersContext,
): Promise<SeedUsersResult> {
  const allSuperAdmin = isSeedAllSuperAdmin();
  const demoPassword = await bcrypt.hash('password123', 12);
  const legacySuperAdminPassword =
    process.env.SUPER_ADMIN_INITIAL_PASSWORD?.trim() || 'NA-Staffing-SuperAdmin-2025!';
  const legacySuperAdminHash = await bcrypt.hash(legacySuperAdminPassword, 12);

  const passwordFor = (def: SeedUserDef): string => {
    if (allSuperAdmin) return demoPassword;
    if (def.key === 'superAdmin' && process.env.SUPER_ADMIN_INITIAL_PASSWORD?.trim()) {
      return legacySuperAdminHash;
    }
    return demoPassword;
  };

  const agencyId = (key?: AgencyKey | null): string | null => {
    if (!key) return null;
    return key === 'toronto' ? ctx.subCompanyTorontoId : ctx.subCompanyVancouverId;
  };

  const locationId = (key?: LocationKey | null): string | null => {
    if (!key) return null;
    if (key === 'toronto') return ctx.locationTorontoId;
    if (key === 'vancouver') return ctx.locationVancouverId;
    return ctx.locationPakistanId;
  };

  const usersByKey = new Map<SeedUserKey, User>();

  for (const def of SEED_USER_DEFS) {
    const useSuperAdmin = allSuperAdmin || def.key === 'superAdmin';
    const role = useSuperAdmin ? 'super_admin' : def.role;
    const userType = useSuperAdmin ? 'Super Admin' : def.userType;
    const passwordHash = passwordFor(def);

    const user = await prisma.user.create({
      data: {
        email: def.email,
        passwordHash,
        firstName: def.firstName,
        lastName: def.lastName,
        phone: def.phone,
        country: def.country,
        role,
        userType,
        subCompanyId: agencyId(def.agency),
        locationId: locationId(def.location),
        dailyCallsTarget: def.dailyCallsTarget,
        dailyEmailsTarget: def.dailyEmailsTarget,
        isActive: true,
      },
    });
    usersByKey.set(def.key, user);
  }

  for (const def of SEED_USER_DEFS) {
    if (!def.reportingTo?.length) continue;
    const user = usersByKey.get(def.key)!;
    const reportingManagerIds = def.reportingTo.map((k) => usersByKey.get(k)!.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { reportingManagerIds },
    });
    user.reportingManagerIds = reportingManagerIds;
  }

  const operationsManager = usersByKey.get('operationsManager')!;
  await prisma.operationsManagerSubCompany.createMany({
    data: [
      { userId: operationsManager.id, subCompanyId: ctx.subCompanyTorontoId },
      { userId: operationsManager.id, subCompanyId: ctx.subCompanyVancouverId },
    ],
  });

  // Recruitment managers stay single-agency (Toronto RM / Vancouver RM are separate users, not linked).

  const allSeedUsers = SEED_USER_DEFS.map((d) => usersByKey.get(d.key)!);

  if (allSuperAdmin) {
    console.log('  ⚠ All users seeded as super_admin — Super Users page and approval demos will be empty. Use default seed (omit SEED_ALL_SUPER_ADMIN) for full demo data.');
  } else {
    console.log('  ✓ Users seeded with persona roles + password123 (hassan@wudox.com = super_admin).');
  }

  return {
    superAdmin: usersByKey.get('superAdmin')!,
    director: usersByKey.get('director')!,
    companyDirector: usersByKey.get('companyDirector')!,
    companyDirectorVancouver: usersByKey.get('companyDirectorVancouver')!,
    salesManager1: usersByKey.get('salesManager1')!,
    salesManager2: usersByKey.get('salesManager2')!,
    salesAssociate1: usersByKey.get('salesAssociate1')!,
    salesAssociate2: usersByKey.get('salesAssociate2')!,
    vancouverAssociate: usersByKey.get('vancouverAssociate')!,
    vancouverAssociate2: usersByKey.get('vancouverAssociate2')!,
    recruiter1: usersByKey.get('recruiter1')!,
    vancouverRecruiter: usersByKey.get('vancouverRecruiter')!,
    pakistanUser: usersByKey.get('pakistanUser')!,
    recruitmentManager: usersByKey.get('recruitmentManager')!,
    recruitmentManagerVancouver: usersByKey.get('recruitmentManagerVancouver')!,
    salesExecutive: usersByKey.get('salesExecutive')!,
    srRecruiter: usersByKey.get('srRecruiter')!,
    dataEntrySpecialist: usersByKey.get('dataEntrySpecialist')!,
    databaseManager: usersByKey.get('databaseManager')!,
    operationsManager,
    itUser: usersByKey.get('itUser')!,
    devTeamUser: usersByKey.get('devTeamUser')!,
    allSeedUsers,
  };
}

export function getSeedLoginPassword(): string {
  if (isSeedAllSuperAdmin()) return 'password123';
  if (process.env.SUPER_ADMIN_INITIAL_PASSWORD?.trim()) {
    return 'password123 for demo users; hassan uses SUPER_ADMIN_INITIAL_PASSWORD';
  }
  return 'password123';
}

// --- Workflow demo seed (pending approvals + offboarding prep) ---

type SeedClient = { id: string; name: string; corporateCode: string };
type SeedLead = { id: string; clientId: string; ownerId: string; status: string };
type SeedAgency = { id: string; name: string };

export interface SeedWorkflowDemosContext {
  subCompany1: SeedAgency;
  subCompany2: SeedAgency;
  salesAssociate1: User;
  salesAssociate2: User;
  vancouverAssociate: User;
  vancouverAssociate2: User;
  salesManager1: User;
  salesManager2: User;
  databaseManager: User;
  sharedClients: SeedClient[];
  torontoClients: SeedClient[];
  vancouverClients: SeedClient[];
  leadsByAgency: Map<string, SeedLead[]>;
  daysFromSeed: (days: number, hour?: number) => Date;
}

export interface SeedWorkflowDemosResult {
  pendingClientAddCount: number;
  pendingClientEditCount: number;
  pendingClientImportCount: number;
  pendingDatabaseClientAddCount: number;
  pendingDatabaseClientImportCount: number;
  leadRequestCount: number;
  leadReassignmentCount: number;
  leadExtensionCount: number;
  proposalReviewCount: number;
  proposalExtensionCount: number;
  offboardingClientCount: number;
  offboardingLeadCount: number;
  offboardingTaskCount: number;
}

async function approvalFields(
  submitterRole: string,
  workflow: ApprovalWorkflowType,
  subCompanyId: string,
): Promise<{ approvalChain: string[]; currentStepIndex: number }> {
  const chain = await buildApprovalChain(submitterRole, workflow, subCompanyId);
  const currentStepIndex = initialStepIndexForSubmitter(chain, submitterRole);
  return { approvalChain: chain, currentStepIndex };
}

export async function seedWorkflowDemos(
  prisma: PrismaClient,
  ctx: SeedWorkflowDemosContext,
): Promise<SeedWorkflowDemosResult> {
  console.log('⛓ Seeding workflow demo data (pending approvals + offboarding prep)...');

  const result: SeedWorkflowDemosResult = {
    pendingClientAddCount: 0,
    pendingClientEditCount: 0,
    pendingClientImportCount: 0,
    pendingDatabaseClientAddCount: 0,
    pendingDatabaseClientImportCount: 0,
    leadRequestCount: 0,
    leadReassignmentCount: 0,
    leadExtensionCount: 0,
    proposalReviewCount: 0,
    proposalExtensionCount: 0,
    offboardingClientCount: 0,
    offboardingLeadCount: 0,
    offboardingTaskCount: 0,
  };

  const agencyConfigs = [
    {
      subCompany: ctx.subCompany1,
      associate: ctx.salesAssociate1,
      associates: [ctx.salesAssociate1, ctx.salesAssociate2],
      manager: ctx.salesManager1,
      clients: [...ctx.sharedClients.slice(0, 3), ...ctx.torontoClients.slice(0, 3)],
      label: 'Toronto',
    },
    {
      subCompany: ctx.subCompany2,
      associate: ctx.vancouverAssociate,
      associates: [ctx.vancouverAssociate, ctx.vancouverAssociate2],
      manager: ctx.salesManager2,
      clients: [...ctx.sharedClients.slice(0, 3), ...ctx.vancouverClients.slice(0, 3)],
      label: 'Vancouver',
    },
  ];

  for (const agency of agencyConfigs) {
    const subCompanyId = agency.subCompany.id;
    const submitterRole = 'sales_associate';

    const addChain = await approvalFields(submitterRole, 'client_manual_add', subCompanyId);
    await prisma.pendingClientSubmission.create({
      data: {
        subCompanyId,
        submissionSource: 'agency',
        submittedById: agency.associate.id,
        name: `${agency.label} Pending Client Add (Seed)`,
        industry: 'Technology',
        location: agency.label,
        submitterRole,
        approvalChain: addChain.approvalChain,
        currentStepIndex: addChain.currentStepIndex,
      },
    });
    result.pendingClientAddCount++;

    const editClient = agency.clients[0];
    if (editClient) {
      const editChain = await approvalFields(submitterRole, 'client_manual_edit', subCompanyId);
      await prisma.pendingClientEdit.create({
        data: {
          subCompanyId,
          clientId: editClient.id,
          submittedById: agency.associate.id,
          name: `${editClient.name} (edited)`,
          industry: editClient.name,
          location: agency.label,
          submitterRole,
          approvalChain: editChain.approvalChain,
          currentStepIndex: editChain.currentStepIndex,
        },
      });
      result.pendingClientEditCount++;
    }

    const importChain = await approvalFields(submitterRole, 'client_import', subCompanyId);
    await prisma.pendingImportedClient.create({
      data: {
        subCompanyId,
        submissionSource: 'agency',
        importedById: agency.associate.id,
        name: `${agency.label} Imported Client (Seed)`,
        industry: 'Manufacturing',
        location: agency.label,
        tags: ['import-seed'],
        approvalChain: importChain.approvalChain,
        currentStepIndex: importChain.currentStepIndex,
      },
    });
    result.pendingClientImportCount++;

    const agencyLeads = ctx.leadsByAgency.get(subCompanyId) ?? [];
    const leadClientIds = new Set(agencyLeads.map((l) => l.clientId));
    const requestClient =
      agency.clients.find((c) => !leadClientIds.has(c.id)) ?? agency.clients[0];
    if (requestClient) {
      const leadReqChain = await approvalFields(submitterRole, 'lead_request', subCompanyId);
      await prisma.leadRequest.create({
        data: {
          clientId: requestClient.id,
          requestedById: agency.associate.id,
          managerId: agency.manager.id,
          note: `${agency.label} pending lead request (seed demo)`,
          status: 'pending',
          subCompanyId,
          requestedAt: ctx.daysFromSeed(-1, 10),
          approvalChain: leadReqChain.approvalChain,
          currentStepIndex: leadReqChain.currentStepIndex,
        },
      });
      result.leadRequestCount++;
    }

    const reassignmentLead = agencyLeads.find((l) => l.status === 'open');
    const proposedOwner =
      agency.associates.find((u) => u.id !== reassignmentLead?.ownerId) ?? agency.manager;
    if (reassignmentLead && proposedOwner.id !== reassignmentLead.ownerId) {
      const reassignChain = await approvalFields('sales_manager', 'lead_reassignment', subCompanyId);
      await prisma.leadReassignmentRequest.create({
        data: {
          leadId: reassignmentLead.id,
          requestedById: agency.manager.id,
          currentOwnerId: reassignmentLead.ownerId,
          proposedOwnerId: proposedOwner.id,
          note: `${agency.label} test reassignment request (seed demo)`,
          status: 'pending',
          subCompanyId,
          requestedAt: ctx.daysFromSeed(-2, 11),
          approvalChain: reassignChain.approvalChain,
          currentStepIndex: reassignChain.currentStepIndex,
        },
      });
      result.leadReassignmentCount++;
    }

    const extensionLead = agencyLeads.find((l) => l.status === 'open');
    if (extensionLead) {
      const extChain = await approvalFields(submitterRole, 'lead_extension', subCompanyId);
      await prisma.leadExtensionRequest.create({
        data: {
          leadId: extensionLead.id,
          requestedById: extensionLead.ownerId,
          reason: `${agency.label} seed lead extension request`,
          requestedDays: 14,
          status: 'pending',
          approvalChain: extChain.approvalChain,
          currentStepIndex: extChain.currentStepIndex,
          requestedAt: ctx.daysFromSeed(-1, 9),
        },
      });
      result.leadExtensionCount++;
    }

    const proposalLead = agencyLeads.find((l) => l.status === 'open' && l.id !== extensionLead?.id) ?? extensionLead;
    if (proposalLead) {
      const reviewChain = await approvalFields(submitterRole, 'proposal_review', subCompanyId);
      const proposal = await prisma.proposal.create({
        data: {
          leadId: proposalLead.id,
          createdById: agency.associate.id,
          locationType: 'onsite',
          agreementTypes: ['temp'],
          tempPricingType: 'hourly',
          tempPricingValue: 45,
          paymentTerms: 'net_30',
          comment: `${agency.label} seed proposal pending review`,
          status: 'pending',
          isForReview: true,
          approvalChain: reviewChain.approvalChain,
          currentStepIndex: reviewChain.currentStepIndex,
        },
      });
      result.proposalReviewCount++;

      const propExtChain = await approvalFields(submitterRole, 'proposal_extension', subCompanyId);
      await prisma.proposalExtensionRequest.create({
        data: {
          proposalId: proposal.id,
          requestedById: agency.associate.id,
          reason: `${agency.label} seed proposal extension`,
          requestedDays: 7,
          status: 'pending',
          approvalChain: propExtChain.approvalChain,
          currentStepIndex: propExtChain.currentStepIndex,
        },
      });
      result.proposalExtensionCount++;
    }
  }

  const dbSubmitterRole = 'database_manager';
  const dbAddChain = await approvalFields(dbSubmitterRole, 'database_client_add', GLOBAL_APPROVAL_SCOPE);
  await prisma.pendingClientSubmission.create({
    data: {
      subCompanyId: null,
      submissionSource: 'global_database',
      submittedById: ctx.databaseManager.id,
      name: 'Global Database Pending Add (Seed)',
      industry: 'Healthcare',
      location: 'Canada',
      submitterRole: dbSubmitterRole,
      approvalChain: dbAddChain.approvalChain,
      currentStepIndex: dbAddChain.currentStepIndex,
    },
  });
  result.pendingDatabaseClientAddCount++;

  const dbImportChain = await approvalFields(dbSubmitterRole, 'database_client_import', GLOBAL_APPROVAL_SCOPE);
  await prisma.pendingImportedClient.create({
    data: {
      subCompanyId: null,
      submissionSource: 'global_database',
      importedById: ctx.databaseManager.id,
      name: 'Global Database Pending Import (Seed)',
      industry: 'Retail',
      location: 'Canada',
      tags: ['global-import-seed'],
      approvalChain: dbImportChain.approvalChain,
      currentStepIndex: dbImportChain.currentStepIndex,
    },
  });
  result.pendingDatabaseClientImportCount++;

  const offboardingUser = ctx.salesAssociate1;
  const offboardingAgencyId = ctx.subCompany1.id;
  const offboardingClients = [
    { name: 'Maple Tech Solutions', industry: 'Technology', location: 'Toronto, ON', corporateCode: 'MTS-OFFBOARD-001' },
    { name: 'Northern Builders Inc', industry: 'Construction', location: 'Toronto, ON', corporateCode: 'NBI-OFFBOARD-002' },
    { name: 'Sunrise Healthcare', industry: 'Healthcare', location: 'Mississauga, ON', corporateCode: 'SHC-OFFBOARD-003' },
  ];

  const offClients: SeedClient[] = [];
  for (const cd of offboardingClients) {
    const client = await prisma.client.create({
      data: {
        name: cd.name,
        industry: cd.industry,
        location: cd.location,
        corporateCode: cd.corporateCode,
        status: 'active',
        ownershipType: 'associate',
        ownershipUserId: offboardingUser.id,
        visibility: 'agency',
        clientSubCompanies: {
          create: { subCompanyId: offboardingAgencyId, status: 'active' },
        },
      },
    });
    offClients.push({ id: client.id, name: client.name, corporateCode: client.corporateCode });
    result.offboardingClientCount++;
  }

  const pipelineLeads = [
    { clientIdx: 0, stage: 'qualified', status: 'open' as const, value: 45000 },
    { clientIdx: 1, stage: 'proposal_sent', status: 'open' as const, value: 120000 },
  ];
  for (const pl of pipelineLeads) {
    await prisma.lead.create({
      data: {
        clientId: offClients[pl.clientIdx].id,
        ownerId: offboardingUser.id,
        subCompanyId: offboardingAgencyId,
        stage: pl.stage,
        status: pl.status,
        value: pl.value,
        temperature: 'warm',
        notes: `Offboarding demo lead for ${offClients[pl.clientIdx].name}`,
      },
    });
    result.offboardingLeadCount++;
  }

  const closedLeads = [
    { clientIdx: 2, status: 'closed_won' as const, value: 85000 },
    { clientIdx: 0, status: 'closed_lost' as const, value: 30000 },
  ];
  for (const cl of closedLeads) {
    await prisma.lead.create({
      data: {
        clientId: offClients[cl.clientIdx].id,
        ownerId: offboardingUser.id,
        subCompanyId: offboardingAgencyId,
        stage: 'closed_won',
        status: cl.status,
        value: cl.value,
        temperature: 'cold',
        closedAt: ctx.daysFromSeed(-5, 14),
        notes: `Offboarding demo closed lead for ${offClients[cl.clientIdx].name}`,
      },
    });
    result.offboardingLeadCount++;
  }

  const taskTitles = [
    'Send Q3 proposal to Maple Tech',
    'Follow up on Northern Builders contract review',
    'Prepare onboarding docs for Sunrise Healthcare',
  ];
  for (let i = 0; i < taskTitles.length; i++) {
    await prisma.task.create({
      data: {
        title: taskTitles[i],
        ownerId: offboardingUser.id,
        assignedById: offboardingUser.id,
        subCompanyId: offboardingAgencyId,
        priority: i === 2 ? 'urgent' : i === 0 ? 'high' : 'medium',
        status: 'to_do',
        dueDate: ctx.daysFromSeed(i + 1, 10),
        description: 'Offboarding demo task',
      },
    });
    result.offboardingTaskCount++;
  }

  for (let i = 0; i < 2; i++) {
    const client = offClients[i];
    const startTime = ctx.daysFromSeed(i + 2, 10);
    const endTime = ctx.daysFromSeed(i + 2, 11);
    await prisma.meeting.create({
      data: {
        title: `Offboarding demo meeting — ${client.name}`,
        clientId: client.id,
        ownerId: offboardingUser.id,
        subCompanyId: offboardingAgencyId,
        startTime,
        endTime,
        status: 'scheduled',
        agenda: 'Offboarding demo meeting',
      },
    });
  }

  for (let i = 0; i < offClients.length; i++) {
    await prisma.followUp.create({
      data: {
        clientId: offClients[i].id,
        ownerId: offboardingUser.id,
        subCompanyId: offboardingAgencyId,
        notes: `Offboarding demo follow-up for ${offClients[i].name}`,
        dueDate: ctx.daysFromSeed(i + 2, 15),
        completed: false,
      },
    });
  }

  console.log('  ✓ Workflow demo data seeded');
  return result;
}
