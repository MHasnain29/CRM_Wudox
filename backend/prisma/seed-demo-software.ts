/**
 * Software house demo data — full org hierarchy, projects, tasks, milestones, leave.
 * Safe to re-run (upserts users, skips duplicate projects/leave).
 * Run: npx tsx prisma/seed-demo-software.ts
 */
import { PrismaClient, LeaveStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log('🌱 Seeding software house demo data...\n');

  // ── 1. Company ─────────────────────────────────────────────────────────────
  const company = await prisma.subCompany.findFirst({
    where: { name: { in: ['Wudox CRM', 'Wudox - Mississauga'] } },
  });
  if (!company) { console.error('❌ No Wudox company found. Run prisma:seed first'); process.exit(1); }
  const cid = company.id;

  // ── 2. Users (full org hierarchy) ─────────────────────────────────────────
  const pw = await bcrypt.hash('password123', 10);

  // Ordered: CTO → Management → Team Leads → Developers → QA → Design → Support
  const USERS = [
    // ── Executive ──────────────────────────────────────────────────────────
    { email: 'cto@wudox.com',         firstName: 'Ali',      lastName: 'Raza',      role: 'cto',              userType: 'CTO',               level: 'Executive' },

    // ── Management ─────────────────────────────────────────────────────────
    { email: 'pm@wudox.com',          firstName: 'Sarah',    lastName: 'Khan',      role: 'project_manager',  userType: 'Project Manager',   level: 'Management' },
    { email: 'hr@wudox.com',          firstName: 'Sana',     lastName: 'Javed',     role: 'hr',               userType: 'HR Manager',        level: 'Management' },
    { email: 'finance@wudox.com',     firstName: 'Tariq',    lastName: 'Mahmood',   role: 'finance',          userType: 'Finance Manager',   level: 'Management' },

    // ── Team Leads ─────────────────────────────────────────────────────────
    { email: 'lead@wudox.com',        firstName: 'Omar',     lastName: 'Sheikh',    role: 'team_lead',        userType: 'Dev Team Lead',     level: 'Team Lead' },
    { email: 'qa.lead@wudox.com',     firstName: 'Nida',     lastName: 'Farooqi',   role: 'team_lead',        userType: 'QA Lead',           level: 'Team Lead' },
    { email: 'design.lead@wudox.com', firstName: 'Imran',    lastName: 'Siddiqui',  role: 'team_lead',        userType: 'Design Lead',       level: 'Team Lead' },
    { email: 'devops@wudox.com',      firstName: 'Kamran',   lastName: 'Ali',       role: 'devops_engineer',  userType: 'DevOps Lead',       level: 'Team Lead' },

    // ── Developers ─────────────────────────────────────────────────────────
    { email: 'dev1@wudox.com',        firstName: 'Bilal',    lastName: 'Ahmad',     role: 'developer',        userType: 'Senior Developer',  level: 'Developer' },
    { email: 'dev2@wudox.com',        firstName: 'Ayesha',   lastName: 'Malik',     role: 'developer',        userType: 'Senior Developer',  level: 'Developer' },
    { email: 'dev3@wudox.com',        firstName: 'Usman',    lastName: 'Raza',      role: 'developer',        userType: 'Developer',         level: 'Developer' },
    { email: 'dev4@wudox.com',        firstName: 'Hamza',    lastName: 'Qureshi',   role: 'developer',        userType: 'Developer',         level: 'Developer' },
    { email: 'dev5@wudox.com',        firstName: 'Maryam',   lastName: 'Baig',      role: 'developer',        userType: 'Junior Developer',  level: 'Developer' },

    // ── QA Engineers ───────────────────────────────────────────────────────
    { email: 'qa@wudox.com',          firstName: 'Fatima',   lastName: 'Noor',      role: 'qa_engineer',      userType: 'Senior QA Engineer',level: 'QA' },
    { email: 'qa2@wudox.com',         firstName: 'Danish',   lastName: 'Mirza',     role: 'qa_engineer',      userType: 'QA Engineer',       level: 'QA' },

    // ── Designers ──────────────────────────────────────────────────────────
    { email: 'designer@wudox.com',    firstName: 'Zara',     lastName: 'Ahmed',     role: 'ui_ux_designer',   userType: 'Senior UI/UX Designer', level: 'Design' },
    { email: 'designer2@wudox.com',   firstName: 'Raza',     lastName: 'Hussain',   role: 'ui_ux_designer',   userType: 'UI/UX Designer',    level: 'Design' },

    // ── Business & Support ─────────────────────────────────────────────────
    { email: 'ba@wudox.com',          firstName: 'Hassan',   lastName: 'Mirza',     role: 'business_analyst', userType: 'Senior Business Analyst', level: 'Support' },
    { email: 'ba2@wudox.com',         firstName: 'Amna',     lastName: 'Sheikh',    role: 'business_analyst', userType: 'Business Analyst',  level: 'Support' },
    { email: 'scrum@wudox.com',       firstName: 'Nabeel',   lastName: 'Akhtar',    role: 'project_manager',  userType: 'Scrum Master',      level: 'Support' },
    { email: 'hr2@wudox.com',         firstName: 'Mehwish',  lastName: 'Asif',      role: 'hr',               userType: 'HR Executive',      level: 'Support' },
    { email: 'accountant@wudox.com',  firstName: 'Saeed',    lastName: 'Butt',      role: 'finance',          userType: 'Accountant',        level: 'Support' },
  ];

  const createdUsers: Record<string, string> = {};

  let currentLevel = '';
  for (const u of USERS) {
    if (u.level !== currentLevel) {
      console.log(`\n  ── ${u.level} ${'─'.repeat(Math.max(0, 40 - u.level.length))}`);
      currentLevel = u.level;
    }
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, userType: u.userType, isActive: true, subCompanyId: cid },
      create: {
        email: u.email, passwordHash: pw,
        firstName: u.firstName, lastName: u.lastName,
        country: 'Pakistan', role: u.role, userType: u.userType,
        subCompanyId: cid, isActive: true,
      },
    });
    createdUsers[u.email] = user.id;
    console.log(`  ✓ ${u.firstName} ${u.lastName.padEnd(12)} ${u.email.padEnd(28)} (${u.userType})`);
  }

  const uid = (email: string) => createdUsers[email]!;

  // ── 3. Leave Types ─────────────────────────────────────────────────────────
  console.log('\n\n📋 Leave types...');
  const LEAVE_TYPES = [
    { name: 'Annual Leave',  daysPerYear: 20, paid: true,  maxCarryOver: 5  },
    { name: 'Sick Leave',    daysPerYear: 10, paid: true,  maxCarryOver: 0  },
    { name: 'Casual Leave',  daysPerYear: 7,  paid: true,  maxCarryOver: 0  },
    { name: 'Unpaid Leave',  daysPerYear: 30, paid: false, maxCarryOver: 0  },
  ];

  const leaveTypeIds: string[] = [];
  const year = new Date().getFullYear();

  for (const lt of LEAVE_TYPES) {
    const existing = await prisma.leaveType.findFirst({ where: { name: lt.name, subCompanyId: cid } });
    const leaveType = existing ?? await prisma.leaveType.create({ data: { ...lt, subCompanyId: cid } });
    leaveTypeIds.push(leaveType.id);
    console.log(`  🗓  ${leaveType.name}`);

    for (const userId of Object.values(createdUsers)) {
      await prisma.leaveBalance.upsert({
        where: { userId_leaveTypeId_year: { userId, leaveTypeId: leaveType.id, year } },
        update: {},
        create: { userId, leaveTypeId: leaveType.id, year, entitled: lt.daysPerYear, used: 0, carriedOver: 0 },
      });
    }
  }

  const [annualId, sickId, casualId] = leaveTypeIds;

  // ── 4. Leave Requests ──────────────────────────────────────────────────────
  console.log('\n🏖  Leave requests...');
  const REQUESTS = [
    { userId: uid('dev1@wudox.com'),      ltId: annualId,  start: daysFromNow(10), end: daysFromNow(14), days: 5,  reason: 'Family vacation',     status: LeaveStatus.pending },
    { userId: uid('dev2@wudox.com'),      ltId: sickId,    start: daysFromNow(-3), end: daysFromNow(-1), days: 3,  reason: 'Flu',                  status: LeaveStatus.approved, approverId: uid('lead@wudox.com') },
    { userId: uid('dev4@wudox.com'),      ltId: casualId,  start: daysFromNow(3),  end: daysFromNow(3),  days: 1,  reason: 'Personal errand',      status: LeaveStatus.pending },
    { userId: uid('dev5@wudox.com'),      ltId: sickId,    start: daysFromNow(-1), end: daysFromNow(-1), days: 1,  reason: 'Not feeling well',     status: LeaveStatus.approved, approverId: uid('lead@wudox.com') },
    { userId: uid('qa@wudox.com'),        ltId: annualId,  start: daysFromNow(20), end: daysFromNow(24), days: 5,  reason: 'Wedding',              status: LeaveStatus.pending },
    { userId: uid('qa2@wudox.com'),       ltId: casualId,  start: daysFromNow(7),  end: daysFromNow(7),  days: 1,  reason: 'Bank appointment',     status: LeaveStatus.approved, approverId: uid('qa.lead@wudox.com') },
    { userId: uid('designer@wudox.com'),  ltId: casualId,  start: daysFromNow(5),  end: daysFromNow(5),  days: 1,  reason: 'Personal work',        status: LeaveStatus.approved, approverId: uid('hr@wudox.com') },
    { userId: uid('designer2@wudox.com'), ltId: annualId,  start: daysFromNow(30), end: daysFromNow(34), days: 5,  reason: 'Holiday trip',         status: LeaveStatus.pending },
    { userId: uid('ba@wudox.com'),        ltId: sickId,    start: daysFromNow(-7), end: daysFromNow(-6), days: 2,  reason: 'Fever',                status: LeaveStatus.approved, approverId: uid('lead@wudox.com') },
    { userId: uid('devops@wudox.com'),    ltId: annualId,  start: daysFromNow(30), end: daysFromNow(34), days: 5,  reason: 'Travel',               status: LeaveStatus.pending },
    { userId: uid('dev3@wudox.com'),      ltId: casualId,  start: daysFromNow(2),  end: daysFromNow(2),  days: 1,  reason: 'Errand',               status: LeaveStatus.rejected, approverId: uid('lead@wudox.com') },
    { userId: uid('lead@wudox.com'),      ltId: annualId,  start: daysFromNow(15), end: daysFromNow(19), days: 5,  reason: 'Vacation',             status: LeaveStatus.pending },
    { userId: uid('pm@wudox.com'),        ltId: annualId,  start: daysFromNow(40), end: daysFromNow(44), days: 5,  reason: 'Conference',           status: LeaveStatus.approved, approverId: uid('cto@wudox.com') },
    { userId: uid('hr2@wudox.com'),       ltId: sickId,    start: daysFromNow(-2), end: daysFromNow(-2), days: 1,  reason: 'Doctor visit',         status: LeaveStatus.approved, approverId: uid('hr@wudox.com') },
    { userId: uid('scrum@wudox.com'),     ltId: annualId,  start: daysFromNow(50), end: daysFromNow(54), days: 5,  reason: 'Family event',         status: LeaveStatus.pending },
  ];

  let leaveCount = 0;
  for (const r of REQUESTS) {
    await prisma.leaveRequest.create({
      data: {
        userId: r.userId, leaveTypeId: r.ltId,
        startDate: r.start, endDate: r.end, days: r.days, reason: r.reason,
        status: r.status,
        approverId: r.approverId ?? null,
        approvedAt: r.approverId ? new Date() : null,
      },
    }).catch(() => {/* already exists */});
    if (r.status === LeaveStatus.approved) {
      await prisma.leaveBalance.updateMany({
        where: { userId: r.userId, leaveTypeId: r.ltId, year },
        data: { used: { increment: r.days } },
      });
    }
    leaveCount++;
  }
  console.log(`  ✅ ${leaveCount} leave requests`);

  // ── 5. Projects ────────────────────────────────────────────────────────────
  console.log('\n📁 Projects...');

  const PROJECT_DEFS = [
    {
      name: 'E-Commerce Platform',
      description: 'Full-stack e-commerce solution with payment gateway, inventory management, and admin panel.',
      status: 'active' as const,
      ownerId: uid('cto@wudox.com'),
      startDate: daysFromNow(-60),
      endDate: daysFromNow(90),
      members: [
        { userId: uid('pm@wudox.com'),        role: 'lead' as const },
        { userId: uid('lead@wudox.com'),       role: 'member' as const },
        { userId: uid('dev1@wudox.com'),       role: 'member' as const },
        { userId: uid('dev2@wudox.com'),       role: 'member' as const },
        { userId: uid('dev4@wudox.com'),       role: 'member' as const },
        { userId: uid('qa@wudox.com'),         role: 'member' as const },
        { userId: uid('designer@wudox.com'),   role: 'member' as const },
        { userId: uid('ba@wudox.com'),         role: 'member' as const },
      ],
      milestones: [
        { title: 'Design Mockups Approved',    dueDate: daysFromNow(-20), done: true  },
        { title: 'Backend API Complete',        dueDate: daysFromNow(10),  done: false },
        { title: 'Payment Gateway Integration', dueDate: daysFromNow(30),  done: false },
        { title: 'UAT Testing',                 dueDate: daysFromNow(60),  done: false },
        { title: 'Production Launch',           dueDate: daysFromNow(90),  done: false },
      ],
      tasks: [
        { title: 'Set up project repo and CI pipeline',  status: 'done'        as const, priority: 'high'   as const, ownerId: uid('devops@wudox.com') },
        { title: 'Design product listing page',          status: 'done'        as const, priority: 'high'   as const, ownerId: uid('designer@wudox.com') },
        { title: 'Design cart and checkout flow',        status: 'in_progress' as const, priority: 'urgent' as const, ownerId: uid('designer2@wudox.com') },
        { title: 'Build user authentication API',        status: 'done'        as const, priority: 'urgent' as const, ownerId: uid('dev1@wudox.com') },
        { title: 'Build product catalog API',            status: 'in_progress' as const, priority: 'high'   as const, ownerId: uid('dev1@wudox.com') },
        { title: 'Integrate Stripe payment gateway',     status: 'to_do'       as const, priority: 'urgent' as const, ownerId: uid('dev2@wudox.com'), dueDate: daysFromNow(8) },
        { title: 'Build order management system',        status: 'to_do'       as const, priority: 'high'   as const, ownerId: uid('dev4@wudox.com'), dueDate: daysFromNow(15) },
        { title: 'Write API integration tests',          status: 'in_progress' as const, priority: 'medium' as const, ownerId: uid('qa@wudox.com') },
        { title: 'Performance testing — product pages',  status: 'to_do'       as const, priority: 'medium' as const, ownerId: uid('qa2@wudox.com'), dueDate: daysFromNow(20) },
        { title: 'Write requirements for admin panel',   status: 'done'        as const, priority: 'medium' as const, ownerId: uid('ba@wudox.com') },
      ],
    },
    {
      name: 'Mobile Banking App',
      description: 'Cross-platform mobile banking application with biometric auth, transfers, and spending analytics.',
      status: 'active' as const,
      ownerId: uid('cto@wudox.com'),
      startDate: daysFromNow(-30),
      endDate: daysFromNow(120),
      members: [
        { userId: uid('scrum@wudox.com'),      role: 'lead' as const },
        { userId: uid('dev2@wudox.com'),        role: 'member' as const },
        { userId: uid('dev3@wudox.com'),        role: 'member' as const },
        { userId: uid('dev5@wudox.com'),        role: 'member' as const },
        { userId: uid('qa@wudox.com'),          role: 'member' as const },
        { userId: uid('qa2@wudox.com'),         role: 'member' as const },
        { userId: uid('designer@wudox.com'),    role: 'member' as const },
        { userId: uid('ba2@wudox.com'),         role: 'member' as const },
      ],
      milestones: [
        { title: 'Requirements & Wireframes',  dueDate: daysFromNow(-10), done: true  },
        { title: 'Core Auth Module',           dueDate: daysFromNow(14),  done: false },
        { title: 'Transfer & Payments Module', dueDate: daysFromNow(45),  done: false },
        { title: 'Analytics Dashboard',        dueDate: daysFromNow(80),  done: false },
        { title: 'App Store Submission',       dueDate: daysFromNow(120), done: false },
      ],
      tasks: [
        { title: 'Define user stories for banking flows',      status: 'done'        as const, priority: 'high'   as const, ownerId: uid('ba2@wudox.com') },
        { title: 'Design onboarding screens',                  status: 'done'        as const, priority: 'high'   as const, ownerId: uid('designer@wudox.com') },
        { title: 'Design dashboard and accounts view',         status: 'in_progress' as const, priority: 'high'   as const, ownerId: uid('designer@wudox.com') },
        { title: 'Implement biometric authentication',         status: 'in_progress' as const, priority: 'urgent' as const, ownerId: uid('dev2@wudox.com'), dueDate: daysFromNow(5) },
        { title: 'Build fund transfer API',                    status: 'to_do'       as const, priority: 'urgent' as const, ownerId: uid('dev3@wudox.com'), dueDate: daysFromNow(14) },
        { title: 'Set up React Native project structure',      status: 'done'        as const, priority: 'medium' as const, ownerId: uid('dev5@wudox.com') },
        { title: 'Write automated test suite for auth',        status: 'to_do'       as const, priority: 'high'   as const, ownerId: uid('qa@wudox.com'), dueDate: daysFromNow(18) },
        { title: 'Security audit — OWASP mobile checklist',   status: 'to_do'       as const, priority: 'urgent' as const, ownerId: uid('qa2@wudox.com'), dueDate: daysFromNow(10) },
      ],
    },
    {
      name: 'CRM Dashboard Revamp',
      description: 'Complete redesign of the internal CRM dashboard with new reporting, analytics, and dark mode.',
      status: 'active' as const,
      ownerId: uid('pm@wudox.com'),
      startDate: daysFromNow(-15),
      endDate: daysFromNow(45),
      members: [
        { userId: uid('lead@wudox.com'),       role: 'lead' as const },
        { userId: uid('dev1@wudox.com'),        role: 'member' as const },
        { userId: uid('dev4@wudox.com'),        role: 'member' as const },
        { userId: uid('design.lead@wudox.com'), role: 'member' as const },
        { userId: uid('designer2@wudox.com'),   role: 'member' as const },
        { userId: uid('qa.lead@wudox.com'),     role: 'member' as const },
      ],
      milestones: [
        { title: 'New Design System Approved', dueDate: daysFromNow(-5), done: true  },
        { title: 'Component Library Done',     dueDate: daysFromNow(10), done: false },
        { title: 'Pages Migration Complete',   dueDate: daysFromNow(30), done: false },
        { title: 'QA Sign-off',               dueDate: daysFromNow(42), done: false },
      ],
      tasks: [
        { title: 'Create new design tokens',            status: 'done'        as const, priority: 'high'   as const, ownerId: uid('design.lead@wudox.com') },
        { title: 'Build new Button & Input components', status: 'done'        as const, priority: 'medium' as const, ownerId: uid('dev1@wudox.com') },
        { title: 'Build new Card & Table components',   status: 'in_progress' as const, priority: 'medium' as const, ownerId: uid('dev4@wudox.com'), dueDate: daysFromNow(7) },
        { title: 'Migrate Dashboard page',              status: 'to_do'       as const, priority: 'high'   as const, ownerId: uid('dev1@wudox.com'), dueDate: daysFromNow(15) },
        { title: 'Migrate Reports page',                status: 'to_do'       as const, priority: 'medium' as const, ownerId: uid('dev4@wudox.com'), dueDate: daysFromNow(25) },
        { title: 'Cross-browser testing',               status: 'to_do'       as const, priority: 'medium' as const, ownerId: uid('qa.lead@wudox.com'), dueDate: daysFromNow(35) },
        { title: 'Dark mode QA pass',                   status: 'to_do'       as const, priority: 'low'    as const, ownerId: uid('qa.lead@wudox.com'), dueDate: daysFromNow(40) },
      ],
    },
    {
      name: 'AI Chatbot Integration',
      description: 'Customer-facing AI chatbot for support automation using GPT-4 with RAG on product docs.',
      status: 'on_hold' as const,
      ownerId: uid('cto@wudox.com'),
      startDate: daysFromNow(-10),
      endDate: daysFromNow(60),
      members: [
        { userId: uid('dev3@wudox.com'),       role: 'lead' as const },
        { userId: uid('ba@wudox.com'),          role: 'member' as const },
        { userId: uid('qa2@wudox.com'),         role: 'member' as const },
        { userId: uid('designer2@wudox.com'),   role: 'member' as const },
      ],
      milestones: [
        { title: 'POC with GPT-4 API',  dueDate: daysFromNow(5),  done: false },
        { title: 'RAG Pipeline Ready',  dueDate: daysFromNow(25), done: false },
        { title: 'User Testing Round 1',dueDate: daysFromNow(45), done: false },
      ],
      tasks: [
        { title: 'Research LLM options — GPT-4 vs Claude', status: 'done'  as const, priority: 'high'   as const, ownerId: uid('ba@wudox.com') },
        { title: 'Set up OpenAI API integration',           status: 'to_do' as const, priority: 'high'   as const, ownerId: uid('dev3@wudox.com'), dueDate: daysFromNow(7) },
        { title: 'Build document ingestion pipeline',       status: 'to_do' as const, priority: 'medium' as const, ownerId: uid('dev3@wudox.com'), dueDate: daysFromNow(20) },
        { title: 'Design chatbot widget UI',                status: 'to_do' as const, priority: 'medium' as const, ownerId: uid('designer2@wudox.com') },
        { title: 'Write test cases for AI responses',       status: 'to_do' as const, priority: 'low'    as const, ownerId: uid('qa2@wudox.com') },
      ],
    },
    {
      name: 'DevOps Pipeline Overhaul',
      description: 'Migrate all services to Kubernetes, CI/CD with GitHub Actions, and implement full monitoring.',
      status: 'done' as const,
      ownerId: uid('cto@wudox.com'),
      startDate: daysFromNow(-90),
      endDate: daysFromNow(-5),
      members: [
        { userId: uid('devops@wudox.com'), role: 'lead' as const },
        { userId: uid('dev1@wudox.com'),   role: 'member' as const },
        { userId: uid('lead@wudox.com'),   role: 'member' as const },
        { userId: uid('dev3@wudox.com'),   role: 'member' as const },
      ],
      milestones: [
        { title: 'K8s Cluster Provisioned',    dueDate: daysFromNow(-70), done: true },
        { title: 'All Services Containerised', dueDate: daysFromNow(-45), done: true },
        { title: 'CI/CD Pipelines Live',       dueDate: daysFromNow(-20), done: true },
        { title: 'Monitoring & Alerts Set Up', dueDate: daysFromNow(-8),  done: true },
      ],
      tasks: [
        { title: 'Provision EKS cluster on AWS',           status: 'done' as const, priority: 'urgent' as const, ownerId: uid('devops@wudox.com') },
        { title: 'Dockerise all microservices',            status: 'done' as const, priority: 'high'   as const, ownerId: uid('devops@wudox.com') },
        { title: 'Set up GitHub Actions CI pipeline',      status: 'done' as const, priority: 'high'   as const, ownerId: uid('devops@wudox.com') },
        { title: 'Configure Helm charts per service',      status: 'done' as const, priority: 'high'   as const, ownerId: uid('dev1@wudox.com') },
        { title: 'Set up Prometheus + Grafana monitoring', status: 'done' as const, priority: 'medium' as const, ownerId: uid('devops@wudox.com') },
        { title: 'Configure PagerDuty alert routing',      status: 'done' as const, priority: 'medium' as const, ownerId: uid('devops@wudox.com') },
        { title: 'Load test post-migration',               status: 'done' as const, priority: 'high'   as const, ownerId: uid('qa@wudox.com') },
      ],
    },
    {
      name: 'Customer Portal v2',
      description: 'Self-service customer portal for account management, invoicing, and support ticket creation.',
      status: 'active' as const,
      ownerId: uid('pm@wudox.com'),
      startDate: daysFromNow(-5),
      endDate: daysFromNow(75),
      members: [
        { userId: uid('dev2@wudox.com'),       role: 'lead' as const },
        { userId: uid('dev5@wudox.com'),        role: 'member' as const },
        { userId: uid('designer@wudox.com'),    role: 'member' as const },
        { userId: uid('ba2@wudox.com'),         role: 'member' as const },
        { userId: uid('qa.lead@wudox.com'),     role: 'member' as const },
      ],
      milestones: [
        { title: 'Wireframes Approved',   dueDate: daysFromNow(7),  done: false },
        { title: 'Auth & Profile Module', dueDate: daysFromNow(25), done: false },
        { title: 'Invoicing Module',      dueDate: daysFromNow(50), done: false },
        { title: 'Support Ticket System', dueDate: daysFromNow(65), done: false },
        { title: 'Beta Launch',           dueDate: daysFromNow(75), done: false },
      ],
      tasks: [
        { title: 'Map current customer pain points',   status: 'done'        as const, priority: 'high'   as const, ownerId: uid('ba2@wudox.com') },
        { title: 'Design portal wireframes',           status: 'in_progress' as const, priority: 'high'   as const, ownerId: uid('designer@wudox.com'), dueDate: daysFromNow(6) },
        { title: 'Set up Next.js project structure',   status: 'done'        as const, priority: 'medium' as const, ownerId: uid('dev2@wudox.com') },
        { title: 'Build user profile management',      status: 'to_do'       as const, priority: 'high'   as const, ownerId: uid('dev2@wudox.com'), dueDate: daysFromNow(20) },
        { title: 'Build invoice download page',        status: 'to_do'       as const, priority: 'medium' as const, ownerId: uid('dev5@wudox.com'), dueDate: daysFromNow(45) },
        { title: 'Implement support ticket creation',  status: 'to_do'       as const, priority: 'medium' as const, ownerId: uid('dev5@wudox.com'), dueDate: daysFromNow(60) },
        { title: 'Write test plan for portal',         status: 'to_do'       as const, priority: 'low'    as const, ownerId: uid('qa.lead@wudox.com') },
      ],
    },
  ];

  for (const proj of PROJECT_DEFS) {
    const { members, milestones, tasks, ...projData } = proj;

    // Skip if project already exists for this company
    const existing = await prisma.project.findFirst({ where: { name: proj.name, subCompanyId: cid } });
    if (existing) {
      console.log(`  ⏭  ${proj.name} (already exists)`);
      continue;
    }

    const project = await prisma.project.create({
      data: { ...projData, subCompanyId: cid },
    });

    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: projData.ownerId, role: 'lead' },
        ...members
          .filter(m => m.userId !== projData.ownerId)
          .map(m => ({ projectId: project.id, userId: m.userId, role: m.role })),
      ],
      skipDuplicates: true,
    });

    await prisma.milestone.createMany({
      data: milestones.map(m => ({ ...m, projectId: project.id })),
    });

    for (const t of tasks) {
      await prisma.task.create({
        data: {
          title: t.title,
          status: t.status,
          priority: t.priority,
          owner: { connect: { id: t.ownerId } },
          assignedBy: { connect: { id: t.ownerId } },
          dueDate: t.dueDate ?? daysFromNow(30),
          project: { connect: { id: project.id } },
          subCompany: { connect: { id: cid } },
        },
      });
    }

    console.log(`  📁 ${project.name} — ${tasks.length} tasks, ${milestones.length} milestones`);
  }

  // ── 6. Summary ─────────────────────────────────────────────────────────────
  console.log('\n\n✅ Demo data ready!\n');
  console.log('═'.repeat(65));
  console.log(' ALL LOGINS  —  password: password123');
  console.log('═'.repeat(65));

  const levels = ['Executive', 'Management', 'Team Lead', 'Developer', 'QA', 'Design', 'Support'];
  for (const level of levels) {
    const group = USERS.filter(u => u.level === level);
    if (!group.length) continue;
    console.log(`\n  ${level}`);
    console.log(`  ${'─'.repeat(60)}`);
    for (const u of group) {
      console.log(`  ${u.email.padEnd(30)} ${u.userType}`);
    }
  }
  console.log('\n' + '═'.repeat(65));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
