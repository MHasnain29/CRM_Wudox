/**
 * Additive seed for filter-system manual testing.
 * Run AFTER the main seed:  npx tsx prisma/seed-filter-test.ts
 *
 * Adds:
 *   - 2 extra agencies (Toronto, Vancouver)
 *   - 15 new users (managers + associates) in those agencies
 *   - 50 clients spread across contacted / active / lost / ex / unsubscribed / permanently_closed
 *   - Leads owned by specific users so chip filtering shows distinct counts
 *   - 2 UserAgencyLink groups so linked-account row + act-as is testable
 *
 * Safe to re-run: every create is guarded by upsert or a findFirst skip.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
let PASSWORD = ''; // set in main() after bcrypt.hash

// ─── helpers ──────────────────────────────────────────────────────────────────

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const INDUSTRIES = [
  'Technology', 'Finance', 'Healthcare', 'Manufacturing', 'Retail',
  'Education', 'Consulting', 'Real Estate', 'Logistics', 'Media',
];

const CLIENT_NAMES = [
  'Apex Solutions', 'BlueSky Corp', 'Cedar Holdings', 'Delta Partners',
  'Emerald Group', 'Falcon Industries', 'GreenWave Tech', 'Harbor Logistics',
  'Iris Consulting', 'Jade Financial', 'Keystone Media', 'Lumen Health',
  'Maple Innovations', 'Nexus Retail', 'Orbit Systems', 'Pinnacle Capital',
  'Quartz Analytics', 'Redwood Partners', 'Summit Services', 'Titan Enterprises',
  'Union Digital', 'Vertex Manufacturing', 'Willow Education', 'Xcel Group',
  'Yarrow Advisors', 'Zenith Dynamics', 'Anchor Bay Inc', 'Bright Path Co',
  'Cascade Ventures', 'Driftwood Media', 'Eclipse Global', 'Fern & Co',
  'Gilded Networks', 'Horizon Staffing', 'Indigo Futures', 'Jubilee Works',
  'Kinetic Labs', 'Lantern Group', 'Momentum Corp', 'Northern Lights Inc',
  'Obsidian Holdings', 'Paragon Tech', 'Quantum Bridge', 'Radiant Solutions',
  'Sterling Agency', 'Threshold Digital', 'Upland Ventures', 'Vanguard Co',
  'Westbrook Inc', 'Yellowstone Media',
];

async function upsertUser(data: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  role: string;
  userType: string;
  subCompanyId: string | null;
}) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return existing;
  return prisma.user.create({
    data: { ...data, passwordHash: PASSWORD, isActive: true },
  });
}

async function createClient(
  name: string,
  code: string,
  visibility: 'agency' | 'global',
) {
  const existing = await prisma.client.findUnique({ where: { corporateCode: code } });
  if (existing) return existing;
  return prisma.client.create({
    data: {
      corporateCode: code,
      name,
      industry: rnd(INDUSTRIES),
      location: 'Toronto, ON',
      visibility,
      status: 'contacted',
      lastActivity: new Date(),
      createdByRole: 'sales_associate',
      contacts: {
        create: [{ name: `${name} Contact`, isPrimary: true }],
      },
    },
  });
}

async function ensureClientSubCompany(
  clientId: string,
  subCompanyId: string,
  status: 'contacted' | 'active' | 'lost' | 'ex' | 'unsubscribed' | 'permanently_closed',
) {
  const existing = await prisma.clientSubCompany.findUnique({
    where: { clientId_subCompanyId: { clientId, subCompanyId } },
  });
  if (existing) {
    return prisma.clientSubCompany.update({
      where: { clientId_subCompanyId: { clientId, subCompanyId } },
      data: { status, lastActivity: new Date() },
    });
  }
  return prisma.clientSubCompany.create({
    data: { clientId, subCompanyId, status, lastActivity: new Date() },
  });
}

async function ensureLead(
  clientId: string,
  ownerId: string,
  subCompanyId: string,
  leadStatus: 'open' | 'active' | 'closed_won' | 'closed_lost',
) {
  const existing = await prisma.lead.findFirst({
    where: { clientId, subCompanyId, ownerId },
  });
  if (existing) return existing;
  const stage =
    leadStatus === 'closed_won'
      ? 'closed_won'
      : leadStatus === 'closed_lost'
        ? 'closed_lost'
        : 'contact_made';
  return prisma.lead.create({
    data: {
      clientId,
      ownerId,
      subCompanyId,
      stage,
      status: leadStatus,
      temperature: rnd(['hot', 'warm', 'cold'] as const),
      lastActivity: new Date(),
    },
  });
}

async function linkUsers(userA: string, userB: string, createdById: string) {
  // Only link if neither is already in a group
  const existingA = await prisma.userAgencyLink.findUnique({ where: { userId: userA } });
  const existingB = await prisma.userAgencyLink.findUnique({ where: { userId: userB } });
  if (existingA || existingB) return;
  const groupId = `filter-test-${userA.slice(0, 8)}-${userB.slice(0, 8)}`;
  await prisma.userAgencyLink.createMany({
    data: [
      { groupId, userId: userA, createdBy: createdById },
      { groupId, userId: userB, createdBy: createdById },
    ],
  });
  console.log(`   🔗 Linked ${userA.slice(0, 8)}… ↔ ${userB.slice(0, 8)}…`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  PASSWORD = await bcrypt.hash('password123', 12);
  console.log('🧪 Filter-test seed starting…');

  // ── 1. Find existing base agency (Mississauga) and super admin ─────────────
  const mississaugaAgency = await prisma.subCompany.findFirst({
    where: { name: { contains: 'Mississauga' } },
  });
  if (!mississaugaAgency) {
    throw new Error('Run the main seed first (npm run prisma:seed). Mississauga agency not found.');
  }
  const msId = mississaugaAgency.id;

  const superAdmin = await prisma.user.findFirst({ where: { role: 'super_admin' } });
  const superAdminId = superAdmin?.id ?? 'system';

  // Existing Mississauga users
  const msMgr = await prisma.user.findFirst({ where: { subCompanyId: msId, role: 'sales_manager' } });
  const msAssoc1 = await prisma.user.findFirst({ where: { email: 'associate1@wudox.ca' } });
  const msAssoc2 = await prisma.user.findFirst({ where: { email: 'associate2@wudox.ca' } });
  const msRecMgr = await prisma.user.findFirst({ where: { email: 'recruitment.manager@wudox.ca' } });

  // ── 2. Create Toronto agency ────────────────────────────────────────────────
  let torontoAgency = await prisma.subCompany.findFirst({ where: { name: 'Wudox - Toronto' } });
  if (!torontoAgency) {
    torontoAgency = await prisma.subCompany.create({
      data: {
        name: 'Wudox - Toronto',
        appProjectName: 'Wudox CRM',
        agencyEmail: 'toronto@wudox.ca',
        agencyPhone: '+1-416-555-2000',
        mainOrgId: 'main-org-001',
      },
    });
    console.log('   🏢 Created Wudox - Toronto');
  }
  const toId = torontoAgency.id;

  // ── 3. Create Vancouver agency ──────────────────────────────────────────────
  let vanAgency = await prisma.subCompany.findFirst({ where: { name: 'Wudox - Vancouver' } });
  if (!vanAgency) {
    vanAgency = await prisma.subCompany.create({
      data: {
        name: 'Wudox - Vancouver',
        appProjectName: 'Wudox CRM',
        agencyEmail: 'vancouver@wudox.ca',
        agencyPhone: '+1-604-555-3000',
        mainOrgId: 'main-org-001',
      },
    });
    console.log('   🏢 Created Wudox - Vancouver');
  }
  const vanId = vanAgency.id;

  // ── 4. Create users in new agencies ─────────────────────────────────────────
  console.log('👥 Creating filter-test users…');

  // Toronto: company director + manager + 3 associates
  const toDir = await upsertUser({
    email: 'to.director@wudox.ca',
    firstName: 'Samantha',
    lastName: 'Lee',
    phone: '+1-416-555-2001',
    country: 'Canada',
    role: 'company_director',
    userType: 'Company Director',
    subCompanyId: toId,
  });

  const toMgr = await upsertUser({
    email: 'to.manager@wudox.ca',
    firstName: 'Ali',
    lastName: 'Khan',
    phone: '+1-416-555-2002',
    country: 'Canada',
    role: 'sales_manager',
    userType: 'Sales Manager',
    subCompanyId: toId,
  });

  const toAssoc1 = await upsertUser({
    email: 'to.assoc1@wudox.ca',
    firstName: 'Maya',
    lastName: 'Singh',
    phone: '+1-416-555-2003',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    subCompanyId: toId,
  });

  const toAssoc2 = await upsertUser({
    email: 'to.assoc2@wudox.ca',
    firstName: 'Jake',
    lastName: 'Wilson',
    phone: '+1-416-555-2004',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    subCompanyId: toId,
  });

  const toAssoc3 = await upsertUser({
    email: 'to.assoc3@wudox.ca',
    firstName: 'Nina',
    lastName: 'Patel',
    phone: '+1-416-555-2005',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    subCompanyId: toId,
  });

  // Vancouver: company director + manager + 3 associates
  const vanDir = await upsertUser({
    email: 'van.director@wudox.ca',
    firstName: 'Emily',
    lastName: 'Chen',
    phone: '+1-604-555-3001',
    country: 'Canada',
    role: 'company_director',
    userType: 'Company Director',
    subCompanyId: vanId,
  });

  const vanMgr = await upsertUser({
    email: 'van.manager@wudox.ca',
    firstName: 'David',
    lastName: 'Park',
    phone: '+1-604-555-3002',
    country: 'Canada',
    role: 'sales_manager',
    userType: 'Sales Manager',
    subCompanyId: vanId,
  });

  const vanAssoc1 = await upsertUser({
    email: 'van.assoc1@wudox.ca',
    firstName: 'Priya',
    lastName: 'Sharma',
    phone: '+1-604-555-3003',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    subCompanyId: vanId,
  });

  const vanAssoc2 = await upsertUser({
    email: 'van.assoc2@wudox.ca',
    firstName: 'Tom',
    lastName: 'Brown',
    phone: '+1-604-555-3004',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    subCompanyId: vanId,
  });

  const vanAssoc3 = await upsertUser({
    email: 'van.assoc3@wudox.ca',
    firstName: 'Leila',
    lastName: 'Nouri',
    phone: '+1-604-555-3005',
    country: 'Canada',
    role: 'sales_associate',
    userType: 'Sales Associate',
    subCompanyId: vanId,
  });

  // Set reporting managers (idempotent)
  await prisma.user.update({ where: { id: toMgr.id }, data: { reportingManagerIds: [toDir.id] } });
  await prisma.user.update({ where: { id: toAssoc1.id }, data: { reportingManagerIds: [toMgr.id] } });
  await prisma.user.update({ where: { id: toAssoc2.id }, data: { reportingManagerIds: [toMgr.id] } });
  await prisma.user.update({ where: { id: toAssoc3.id }, data: { reportingManagerIds: [toMgr.id] } });
  await prisma.user.update({ where: { id: vanMgr.id }, data: { reportingManagerIds: [vanDir.id] } });
  await prisma.user.update({ where: { id: vanAssoc1.id }, data: { reportingManagerIds: [vanMgr.id] } });
  await prisma.user.update({ where: { id: vanAssoc2.id }, data: { reportingManagerIds: [vanMgr.id] } });
  await prisma.user.update({ where: { id: vanAssoc3.id }, data: { reportingManagerIds: [vanMgr.id] } });

  console.log('   ✓ Toronto: Samantha Lee (company_director) → Ali Khan (manager) → Maya, Jake, Nina');
  console.log('   ✓ Vancouver: Emily Chen (company_director) → David Park (manager) → Priya, Tom, Leila');

  // ── 5. Create 50 clients with leads ─────────────────────────────────────────
  console.log('🏢 Creating 50 filter-test clients…');

  // Owner plan: who owns how many clients, in which agency, with which status
  // Format: [clientName, code, agencyId, ownerId, clientStatus, leadStatus]
  type ClientPlan = [string, string, string, string | null, 'contacted' | 'active' | 'lost' | 'ex' | 'unsubscribed' | 'permanently_closed', 'open' | 'active' | 'closed_won' | 'closed_lost'];

  const msA1 = msAssoc1?.id;
  const msA2 = msAssoc2?.id;
  const msMId = msMgr?.id;
  const msRMId = msRecMgr?.id;

  const plans: ClientPlan[] = [
    // ── Mississauga clients (20) ──────────────────────────────────────────────
    // Contacted — owned by assoc1 (6)
    [CLIENT_NAMES[0]!, 'FT-MS-C01', msId, msA1 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[1]!, 'FT-MS-C02', msId, msA1 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[2]!, 'FT-MS-C03', msId, msA1 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[3]!, 'FT-MS-C04', msId, msA1 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[4]!, 'FT-MS-C05', msId, msA1 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[5]!, 'FT-MS-C06', msId, msA1 ?? msMId, 'contacted', 'open'],
    // Contacted — owned by assoc2 (4)
    [CLIENT_NAMES[6]!, 'FT-MS-C07', msId, msA2 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[7]!, 'FT-MS-C08', msId, msA2 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[8]!, 'FT-MS-C09', msId, msA2 ?? msMId, 'contacted', 'open'],
    [CLIENT_NAMES[9]!, 'FT-MS-C10', msId, msA2 ?? msMId, 'contacted', 'open'],
    // Active (4)
    [CLIENT_NAMES[10]!, 'FT-MS-A01', msId, msA1 ?? msMId, 'active', 'active'],
    [CLIENT_NAMES[11]!, 'FT-MS-A02', msId, msA1 ?? msMId, 'active', 'active'],
    [CLIENT_NAMES[12]!, 'FT-MS-A03', msId, msA2 ?? msMId, 'active', 'active'],
    [CLIENT_NAMES[13]!, 'FT-MS-A04', msId, msMId ?? msA1, 'active', 'active'],
    // Lost (3)
    [CLIENT_NAMES[14]!, 'FT-MS-L01', msId, msA1 ?? msMId, 'lost', 'closed_lost'],
    [CLIENT_NAMES[15]!, 'FT-MS-L02', msId, msA2 ?? msMId, 'lost', 'closed_lost'],
    [CLIENT_NAMES[16]!, 'FT-MS-L03', msId, msMId ?? msA1, 'lost', 'closed_lost'],
    // Ex (2)
    [CLIENT_NAMES[17]!, 'FT-MS-E01', msId, msMId ?? msA1, 'ex', 'closed_won'],
    [CLIENT_NAMES[18]!, 'FT-MS-E02', msId, msRMId ?? msA1, 'ex', 'closed_won'],
    // Unsubscribed + permanently_closed (1 each)
    [CLIENT_NAMES[19]!, 'FT-MS-U01', msId, msA2 ?? msMId, 'unsubscribed', 'open'],
    [CLIENT_NAMES[20]!, 'FT-MS-P01', msId, msA2 ?? msMId, 'permanently_closed', 'closed_lost'],

    // ── Toronto clients (15) ──────────────────────────────────────────────────
    // Contacted — owned by toAssoc1 (5)
    [CLIENT_NAMES[21]!, 'FT-TO-C01', toId, toAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[22]!, 'FT-TO-C02', toId, toAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[23]!, 'FT-TO-C03', toId, toAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[24]!, 'FT-TO-C04', toId, toAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[25]!, 'FT-TO-C05', toId, toAssoc1.id, 'contacted', 'open'],
    // Contacted — owned by toAssoc2 (3)
    [CLIENT_NAMES[26]!, 'FT-TO-C06', toId, toAssoc2.id, 'contacted', 'open'],
    [CLIENT_NAMES[27]!, 'FT-TO-C07', toId, toAssoc2.id, 'contacted', 'open'],
    [CLIENT_NAMES[28]!, 'FT-TO-C08', toId, toAssoc2.id, 'contacted', 'open'],
    // Contacted — owned by toAssoc3 (2)
    [CLIENT_NAMES[29]!, 'FT-TO-C09', toId, toAssoc3.id, 'contacted', 'open'],
    [CLIENT_NAMES[30]!, 'FT-TO-C10', toId, toAssoc3.id, 'contacted', 'open'],
    // Active (2)
    [CLIENT_NAMES[31]!, 'FT-TO-A01', toId, toAssoc1.id, 'active', 'active'],
    [CLIENT_NAMES[32]!, 'FT-TO-A02', toId, toAssoc2.id, 'active', 'active'],
    // Lost (2)
    [CLIENT_NAMES[33]!, 'FT-TO-L01', toId, toMgr.id, 'lost', 'closed_lost'],
    [CLIENT_NAMES[34]!, 'FT-TO-L02', toId, toAssoc1.id, 'lost', 'closed_lost'],
    // Ex (1)
    [CLIENT_NAMES[35]!, 'FT-TO-E01', toId, toMgr.id, 'ex', 'closed_won'],

    // ── Vancouver clients (14) ────────────────────────────────────────────────
    // Contacted — owned by vanAssoc1 (5)
    [CLIENT_NAMES[36]!, 'FT-VA-C01', vanId, vanAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[37]!, 'FT-VA-C02', vanId, vanAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[38]!, 'FT-VA-C03', vanId, vanAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[39]!, 'FT-VA-C04', vanId, vanAssoc1.id, 'contacted', 'open'],
    [CLIENT_NAMES[40]!, 'FT-VA-C05', vanId, vanAssoc1.id, 'contacted', 'open'],
    // Contacted — owned by vanAssoc2 (3)
    [CLIENT_NAMES[41]!, 'FT-VA-C06', vanId, vanAssoc2.id, 'contacted', 'open'],
    [CLIENT_NAMES[42]!, 'FT-VA-C07', vanId, vanAssoc2.id, 'contacted', 'open'],
    [CLIENT_NAMES[43]!, 'FT-VA-C08', vanId, vanAssoc2.id, 'contacted', 'open'],
    // Contacted — owned by vanAssoc3 (2)
    [CLIENT_NAMES[44]!, 'FT-VA-C09', vanId, vanAssoc3.id, 'contacted', 'open'],
    [CLIENT_NAMES[45]!, 'FT-VA-C10', vanId, vanAssoc3.id, 'contacted', 'open'],
    // Active (2)
    [CLIENT_NAMES[46]!, 'FT-VA-A01', vanId, vanAssoc1.id, 'active', 'active'],
    [CLIENT_NAMES[47]!, 'FT-VA-A02', vanId, vanMgr.id, 'active', 'active'],
    // Lost (1)
    [CLIENT_NAMES[48]!, 'FT-VA-L01', vanId, vanAssoc2.id, 'lost', 'closed_lost'],
    // Ex (1)
    [CLIENT_NAMES[49]!, 'FT-VA-E01', vanId, vanMgr.id, 'ex', 'closed_won'],
  ];

  let created = 0;
  for (const [name, code, agencyId, ownerId, clientStatus, leadStatus] of plans) {
    const client = await createClient(name, code, 'agency');
    await ensureClientSubCompany(client.id, agencyId, clientStatus);
    if (ownerId) {
      await ensureLead(client.id, ownerId, agencyId, leadStatus);
    }
    created++;
  }
  console.log(`   ✓ ${created} clients created with leads`);

  // ── 6. UserAgencyLink — two groups ──────────────────────────────────────────
  console.log('🔗 Setting up linked accounts…');

  // Group 1: Sarah Manager (MS) ↔ Ali Khan (Toronto)
  // When Sarah logs in she can see Ali's clients and vice versa.
  if (msMgr) {
    await linkUsers(msMgr.id, toMgr.id, superAdminId);
    console.log('   Group 1: Sarah (MS manager) ↔ Ali (Toronto manager)');
    console.log('   → Log in as manager1@wudox.ca → linked-accounts row should show Toronto');
  }

  // Group 2: Robert Hayes (MS company_director) ↔ Emily Chen (Vancouver)
  const msCompanyDir = await prisma.user.findFirst({ where: { email: 'company.director@wudox.ca' } });
  if (msCompanyDir) {
    await linkUsers(msCompanyDir.id, vanDir.id, superAdminId);
    console.log('   Group 2: Robert Hayes (MS company_director) ↔ Emily Chen (Vancouver company_director)');
    console.log('   → Log in as company.director@wudox.ca → linked-accounts row should show Vancouver');
  }

  // ── 7. Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Filter-test seed complete. Login guide:');
  console.log('   Password for ALL new users: password123\n');
  console.log('   ROLE                 EMAIL                    AGENCY');
  console.log('   ────────────────     ──────────────────────   ─────────────────');
  console.log('   super_admin          hassan@wudox.ca          —');
  console.log('   director             director@wudox.ca        —  (All Agencies)');
  console.log('   company_director     company.director@wudox.ca   Mississauga  [linked → Van]');
  console.log('   sales_manager        manager1@wudox.ca        Mississauga  [linked → Toronto]');
  console.log('   sales_associate      associate1@wudox.ca      Mississauga');
  console.log('   sales_associate      associate2@wudox.ca      Mississauga');
  console.log('   company_director     to.director@wudox.ca     Toronto');
  console.log('   sales_manager        to.manager@wudox.ca      Toronto  [linked → Mississauga]');
  console.log('   sales_associate      to.assoc1@wudox.ca       Toronto  (5 contacted, 2 active, 1 lost)');
  console.log('   sales_associate      to.assoc2@wudox.ca       Toronto  (3 contacted, 1 active)');
  console.log('   sales_associate      to.assoc3@wudox.ca       Toronto  (2 contacted)');
  console.log('   company_director     van.director@wudox.ca    Vancouver  [linked → Mississauga]');
  console.log('   sales_manager        van.manager@wudox.ca     Vancouver');
  console.log('   sales_associate      van.assoc1@wudox.ca      Vancouver  (5 contacted, 1 active)');
  console.log('   sales_associate      van.assoc2@wudox.ca      Vancouver  (3 contacted, 1 lost)');
  console.log('   sales_associate      van.assoc3@wudox.ca      Vancouver  (2 contacted)\n');
  console.log('   What to test:');
  console.log('   1. Log in as associate1@wudox.ca → no chip bar, all tabs show only your records');
  console.log('   2. Log in as manager1@wudox.ca → chip bar visible; no chip = own records;');
  console.log('      "All Team" → assoc1+assoc2 records; click assoc1 chip → only assoc1');
  console.log('   3. Log in as director@wudox.ca → agency row + hierarchy chips;');
  console.log('      "All Agencies" → org-wide counts; select Toronto agency → Toronto data');
  console.log('   4. Log in as manager1@wudox.ca → linked-accounts row shows Toronto;');
  console.log('      click Toronto → see Ali Khan\'s clients; click Ali chip → act-as mode');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
