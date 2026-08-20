/**
 * Software house — rich dummy data layer.
 * Adds: personal tasks, task comments, notifications, activity logs, team conversations/messages.
 * Safe to re-run: checks for existing data before inserting.
 * Run: npx tsx prisma/seed-sw-dummy.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log('🚀 Seeding software house dummy data...\n');

  const company = await prisma.subCompany.findFirst({
    where: { name: { in: ['Wudox CRM', 'Wudox - Mississauga'] } },
  });
  if (!company) { console.error('❌ No company found. Run prisma:seed first.'); process.exit(1); }
  const cid = company.id;

  // Load all software house users
  const SW_EMAILS = [
    'cto@wudox.ca', 'pm@wudox.ca', 'hr@wudox.ca', 'finance@wudox.ca',
    'lead@wudox.ca', 'qa.lead@wudox.ca', 'design.lead@wudox.ca', 'devops@wudox.ca',
    'dev1@wudox.ca', 'dev2@wudox.ca', 'dev3@wudox.ca', 'dev4@wudox.ca', 'dev5@wudox.ca',
    'qa@wudox.ca', 'qa2@wudox.ca',
    'designer@wudox.ca', 'designer2@wudox.ca',
    'ba@wudox.ca', 'ba2@wudox.ca', 'scrum@wudox.ca', 'hr2@wudox.ca', 'accountant@wudox.ca',
  ];

  const users = await prisma.user.findMany({ where: { email: { in: SW_EMAILS } } });
  const byEmail: Record<string, typeof users[0]> = {};
  for (const u of users) byEmail[u.email] = u;

  const uid  = (e: string) => byEmail[e]!.id;
  const uname = (e: string) => `${byEmail[e]!.firstName} ${byEmail[e]!.lastName}`;

  // ── 1. Personal Tasks ──────────────────────────────────────────────────────
  console.log('📋 Personal tasks...');

  // Only seed if the user has fewer than 4 non-project tasks
  const existingPersonal = await prisma.task.groupBy({
    by: ['ownerId'],
    where: { subCompanyId: cid, projectId: null },
    _count: true,
  });
  const alreadyHasPersonal = new Set(
    existingPersonal.filter(r => r._count >= 4).map(r => r.ownerId)
  );

  const PERSONAL_TASKS: Array<{
    ownerId: string; assignedById: string;
    title: string; description: string;
    priority: 'urgent'|'high'|'medium'|'low';
    status: 'to_do'|'in_progress'|'done';
    dueDate: Date;
  }> = [
    // CTO
    { ownerId: uid('cto@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Q3 budget review with finance', description: 'Review Q3 actuals vs forecast, approve headcount requests.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(3) },
    { ownerId: uid('cto@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Evaluate AWS cost optimisation report', description: 'DevOps submitted the report. Approve or defer recommendations.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(7) },
    { ownerId: uid('cto@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Update tech roadmap for Q4', description: 'Align with PM and team leads on priorities.', priority: 'high', status: 'to_do', dueDate: daysFromNow(14) },
    { ownerId: uid('cto@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Review engineering hiring plan', description: 'Approve JDs for 2 senior dev openings.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(10) },
    { ownerId: uid('cto@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: '1:1 feedback sessions with all team leads', description: 'Monthly 1:1s — schedule and complete.', priority: 'medium', status: 'in_progress', dueDate: daysFromNow(5) },

    // Project Manager
    { ownerId: uid('pm@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Prepare sprint 14 planning deck', description: 'Include velocity, risks, and carry-over items.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(2) },
    { ownerId: uid('pm@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Update project RAID log', description: 'Add new risks identified in last standup.', priority: 'high', status: 'to_do', dueDate: daysFromNow(1) },
    { ownerId: uid('pm@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Client demo prep — E-Commerce Platform', description: 'Prepare demo script and test environment.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(4) },
    { ownerId: uid('pm@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Write monthly project status report', description: 'Cover all 6 active projects, RAG status.', priority: 'high', status: 'to_do', dueDate: daysFromNow(6) },
    { ownerId: uid('pm@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Review and approve team timesheets', description: 'Validate hours for billing and payroll.', priority: 'medium', status: 'done', dueDate: daysFromNow(-2) },

    // HR Manager
    { ownerId: uid('hr@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Process 3 pending leave applications', description: 'Bilal, Fatima, and Kamran have pending requests.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(1) },
    { ownerId: uid('hr@wudox.ca'), assignedById: uid('hr@wudox.ca'), title: 'Schedule Q3 performance reviews', description: 'Book calendar slots for all 22 team members.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(7) },
    { ownerId: uid('hr@wudox.ca'), assignedById: uid('hr@wudox.ca'), title: 'Onboarding checklist for new junior dev', description: 'Prepare accounts, equipment, and buddy assignment.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(5) },
    { ownerId: uid('hr@wudox.ca'), assignedById: uid('hr@wudox.ca'), title: 'Update employee handbook — remote work policy', description: 'Reflect new hybrid guidelines approved by CTO.', priority: 'low', status: 'to_do', dueDate: daysFromNow(14) },
    { ownerId: uid('hr@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Post 2 senior developer job openings', description: 'LinkedIn and Indeed. Get JDs approved by lead first.', priority: 'high', status: 'to_do', dueDate: daysFromNow(3) },

    // Finance Manager
    { ownerId: uid('finance@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Prepare Q3 financial summary', description: 'Revenue, expenses, and profit by project.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(4) },
    { ownerId: uid('finance@wudox.ca'), assignedById: uid('finance@wudox.ca'), title: 'Invoice client — E-Commerce Platform milestone 2', description: 'Milestone 2 completed. Raise invoice for 40% payment.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(1) },
    { ownerId: uid('finance@wudox.ca'), assignedById: uid('finance@wudox.ca'), title: 'Reconcile August vendor payments', description: 'AWS, GitHub, Figma, Linear subscriptions.', priority: 'medium', status: 'done', dueDate: daysFromNow(-3) },
    { ownerId: uid('finance@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Forecast Q4 project revenue', description: 'Based on current contracts and pipeline.', priority: 'high', status: 'to_do', dueDate: daysFromNow(10) },

    // Dev Team Lead
    { ownerId: uid('lead@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Review and merge 4 open pull requests', description: 'PRs from dev1 and dev2 waiting for review.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('lead@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Conduct code quality audit — E-Commerce repo', description: 'Check for tech debt and flag for sprint 15.', priority: 'high', status: 'to_do', dueDate: daysFromNow(5) },
    { ownerId: uid('lead@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Sprint 14 daily standup facilitation', description: 'Run standups this week while scrum master is away.', priority: 'medium', status: 'in_progress', dueDate: daysFromNow(4) },
    { ownerId: uid('lead@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Write technical spec — order management module', description: 'Design DB schema and API contracts.', priority: 'high', status: 'to_do', dueDate: daysFromNow(7) },

    // QA Lead
    { ownerId: uid('qa.lead@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Finalise sprint 14 test plan', description: 'Cover auth, catalog, and checkout test cases.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(2) },
    { ownerId: uid('qa.lead@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Set up Playwright E2E test suite', description: 'Install, configure, and write first 10 scenarios.', priority: 'high', status: 'to_do', dueDate: daysFromNow(8) },
    { ownerId: uid('qa.lead@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Review qa2 test cases for Mobile Banking', description: 'Danish submitted 20 test cases for review.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(3) },
    { ownerId: uid('qa.lead@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Regression test — CRM Dashboard v1.2', description: 'Smoke test all updated components.', priority: 'high', status: 'done', dueDate: daysFromNow(-1) },

    // Design Lead
    { ownerId: uid('design.lead@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Review and approve sprint 14 design specs', description: 'Check Zara and Raza\'s screens before dev handoff.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('design.lead@wudox.ca'), assignedById: uid('design.lead@wudox.ca'), title: 'Establish design system component library', description: 'Tokens, atoms, and molecules in Figma.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(10) },
    { ownerId: uid('design.lead@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Define brand guidelines for Customer Portal', description: 'Colors, typography, and tone of voice.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(6) },

    // DevOps
    { ownerId: uid('devops@wudox.ca'), assignedById: uid('cto@wudox.ca'), title: 'Set up staging environment for Mobile Banking', description: 'Mirror prod infra. Enable auto-deploy from develop branch.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(2) },
    { ownerId: uid('devops@wudox.ca'), assignedById: uid('devops@wudox.ca'), title: 'Rotate all production secrets and API keys', description: 'Monthly rotation. Update in AWS Secrets Manager.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(1) },
    { ownerId: uid('devops@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Investigate memory leak in prod — user-service', description: 'P99 latency spiking every 6h. Pod restarts workaround for now.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('devops@wudox.ca'), assignedById: uid('devops@wudox.ca'), title: 'Optimise Docker image sizes', description: 'Several images exceed 800MB. Target < 200MB with multi-stage builds.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(9) },

    // dev1
    { ownerId: uid('dev1@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Fix checkout total calculation bug', description: 'Discount not applied when coupon + loyalty points used together.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('dev1@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Add pagination to product search API', description: 'Currently returns all results. Limit 20 per page with cursor.', priority: 'high', status: 'to_do', dueDate: daysFromNow(4) },
    { ownerId: uid('dev1@wudox.ca'), assignedById: uid('dev1@wudox.ca'), title: 'Write unit tests for auth service', description: 'Target 80% coverage on login, refresh, and logout flows.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(6) },
    { ownerId: uid('dev1@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Code review — Hamza\'s product catalog PR', description: 'Review PR #47 before end of day.', priority: 'high', status: 'done', dueDate: daysFromNow(-1) },

    // dev2
    { ownerId: uid('dev2@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Implement Stripe webhook handler', description: 'Handle payment_intent.succeeded and charge.failed events.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(2) },
    { ownerId: uid('dev2@wudox.ca'), assignedById: uid('dev2@wudox.ca'), title: 'Refactor biometric auth module', description: 'Separate platform code (iOS/Android) into adapters.', priority: 'high', status: 'to_do', dueDate: daysFromNow(5) },
    { ownerId: uid('dev2@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Fix crash on iOS 17 — face ID screen', description: 'Reproduced consistently on iPhone 15. Logs attached in Jira.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(1) },
    { ownerId: uid('dev2@wudox.ca'), assignedById: uid('dev2@wudox.ca'), title: 'Document payment API endpoints', description: 'Add OpenAPI annotations and update Postman collection.', priority: 'low', status: 'to_do', dueDate: daysFromNow(10) },

    // dev3
    { ownerId: uid('dev3@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Build fund transfer API endpoint', description: 'POST /api/transfers — validate, authorise, record transaction.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(3) },
    { ownerId: uid('dev3@wudox.ca'), assignedById: uid('dev3@wudox.ca'), title: 'Spike: OpenAI embeddings for chatbot RAG', description: 'Test text-embedding-3-small vs 3-large on our doc corpus.', priority: 'medium', status: 'in_progress', dueDate: daysFromNow(5) },
    { ownerId: uid('dev3@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Fix broken deep link on Android', description: 'Clicking notification doesn\'t navigate to correct screen.', priority: 'high', status: 'to_do', dueDate: daysFromNow(2) },
    { ownerId: uid('dev3@wudox.ca'), assignedById: uid('dev3@wudox.ca'), title: 'Optimise React Native list rendering', description: 'Transaction list stutters on 500+ items. Use FlashList.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(8) },

    // dev4
    { ownerId: uid('dev4@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Build product catalogue frontend components', description: 'Grid view, filter sidebar, sort dropdown.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(4) },
    { ownerId: uid('dev4@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Add skeleton loading states', description: 'Cover product grid, cart, and checkout pages.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(7) },
    { ownerId: uid('dev4@wudox.ca'), assignedById: uid('dev4@wudox.ca'), title: 'Fix mobile responsiveness on checkout page', description: 'Payment form overflows on 375px screens.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('dev4@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Integrate toast notifications', description: 'Replace alert() calls. Use Sonner across all forms.', priority: 'low', status: 'done', dueDate: daysFromNow(-2) },

    // dev5
    { ownerId: uid('dev5@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Set up React Native navigation structure', description: 'Tab nav + stack nav for Banking App. Use Expo Router.', priority: 'high', status: 'done', dueDate: daysFromNow(-3) },
    { ownerId: uid('dev5@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Implement account balance screen', description: 'Fetch from /api/accounts/:id, show balance and recent txns.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(5) },
    { ownerId: uid('dev5@wudox.ca'), assignedById: uid('dev5@wudox.ca'), title: 'Learn Zustand — state management for Banking App', description: 'Replace Context API. Check shared patterns with Bilal.', priority: 'medium', status: 'done', dueDate: daysFromNow(-5) },
    { ownerId: uid('dev5@wudox.ca'), assignedById: uid('lead@wudox.ca'), title: 'Add error boundary components', description: 'Catch runtime errors gracefully — show fallback UI.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(9) },

    // QA
    { ownerId: uid('qa@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Execute regression suite — auth module', description: '42 test cases. Log failures in Linear.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('qa@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Write test plan for payment flows', description: 'Cover happy path, refund, and failure scenarios.', priority: 'high', status: 'to_do', dueDate: daysFromNow(4) },
    { ownerId: uid('qa@wudox.ca'), assignedById: uid('qa@wudox.ca'), title: 'Report and document 3 UI bugs from last build', description: 'Screenshots and steps to reproduce ready.', priority: 'medium', status: 'done', dueDate: daysFromNow(-1) },
    { ownerId: uid('qa@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Validate API responses against OpenAPI spec', description: 'Use Spectral or Postman runner to flag discrepancies.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(6) },

    // QA2
    { ownerId: uid('qa2@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Write 20 test cases for mobile onboarding', description: 'Cover registration, KYC, and account activation flows.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(3) },
    { ownerId: uid('qa2@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Test biometric auth on Android 14', description: 'Fingerprint and face unlock. Verify fallback to PIN.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(2) },
    { ownerId: uid('qa2@wudox.ca'), assignedById: uid('qa2@wudox.ca'), title: 'Exploratory testing — Banking App build 0.3.1', description: '2h time-boxed session. Log findings in test report.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(4) },
    { ownerId: uid('qa2@wudox.ca'), assignedById: uid('qa.lead@wudox.ca'), title: 'Set up device farm on BrowserStack', description: '10 iOS + 10 Android devices for automated runs.', priority: 'low', status: 'to_do', dueDate: daysFromNow(12) },

    // Designer
    { ownerId: uid('designer@wudox.ca'), assignedById: uid('design.lead@wudox.ca'), title: 'Design checkout success + error states', description: 'Post-payment screens for E-Commerce. Micro-animations welcome.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(3) },
    { ownerId: uid('designer@wudox.ca'), assignedById: uid('design.lead@wudox.ca'), title: 'Finalise mobile app icon and splash screen', description: 'Banking App assets. 3 variants for stakeholder sign-off.', priority: 'high', status: 'to_do', dueDate: daysFromNow(5) },
    { ownerId: uid('designer@wudox.ca'), assignedById: uid('designer@wudox.ca'), title: 'User research synthesis — customer interviews', description: 'Cluster insights from 8 interviews into themes.', priority: 'medium', status: 'done', dueDate: daysFromNow(-4) },
    { ownerId: uid('designer@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Create presentation deck for client demo', description: 'E-Commerce milestone 2 review. 15 slides max.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(2) },

    // Designer2
    { ownerId: uid('designer2@wudox.ca'), assignedById: uid('design.lead@wudox.ca'), title: 'Design chatbot widget UI — 3 variants', description: 'Floating button, sidebar panel, and inline embed. Mobile-first.', priority: 'medium', status: 'in_progress', dueDate: daysFromNow(6) },
    { ownerId: uid('designer2@wudox.ca'), assignedById: uid('design.lead@wudox.ca'), title: 'Handoff CRM Dashboard new components', description: 'Export annotated Figma frames to Zeplin.', priority: 'high', status: 'to_do', dueDate: daysFromNow(4) },
    { ownerId: uid('designer2@wudox.ca'), assignedById: uid('designer2@wudox.ca'), title: 'Create icon set for portal navigation', description: '16 icons, 24px base, SVG format. Follow existing style.', priority: 'low', status: 'to_do', dueDate: daysFromNow(10) },
    { ownerId: uid('designer2@wudox.ca'), assignedById: uid('design.lead@wudox.ca'), title: 'A/B test designs for portal landing page', description: 'Prepare 2 hero section variants for usability test.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(8) },

    // BA
    { ownerId: uid('ba@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Write BRD for order management module', description: 'Business requirements doc. Review with PM by Friday.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(3) },
    { ownerId: uid('ba@wudox.ca'), assignedById: uid('ba@wudox.ca'), title: 'Analyse competitor portals — 5 top players', description: 'Feature comparison matrix. Feed into Customer Portal v2 scope.', priority: 'high', status: 'done', dueDate: daysFromNow(-2) },
    { ownerId: uid('ba@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Facilitate requirements workshop — AI Chatbot', description: 'Prepare agenda, run 2h session with dev3 and CTO.', priority: 'high', status: 'to_do', dueDate: daysFromNow(6) },
    { ownerId: uid('ba@wudox.ca'), assignedById: uid('ba@wudox.ca'), title: 'Document API contracts for payment service', description: 'Request/response shapes, error codes, rate limits.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(8) },

    // BA2
    { ownerId: uid('ba2@wudox.ca'), assignedById: uid('ba@wudox.ca'), title: 'Create user stories for customer portal auth', description: 'Registration, login, SSO, and forgot-password flows.', priority: 'high', status: 'in_progress', dueDate: daysFromNow(4) },
    { ownerId: uid('ba2@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Map as-is vs to-be customer journey', description: 'Visualise current pain points and proposed improvements.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(7) },
    { ownerId: uid('ba2@wudox.ca'), assignedById: uid('ba2@wudox.ca'), title: 'Prepare data dictionary for banking app', description: 'Define all entities, fields, and relationships.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(9) },

    // Scrum Master
    { ownerId: uid('scrum@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Facilitate sprint 14 retrospective', description: 'Gather team feedback, update action items in Jira.', priority: 'high', status: 'to_do', dueDate: daysFromNow(5) },
    { ownerId: uid('scrum@wudox.ca'), assignedById: uid('scrum@wudox.ca'), title: 'Update sprint velocity tracker', description: 'Add sprint 13 actuals. Update 6-sprint rolling average.', priority: 'medium', status: 'done', dueDate: daysFromNow(-1) },
    { ownerId: uid('scrum@wudox.ca'), assignedById: uid('pm@wudox.ca'), title: 'Identify and resolve 2 team blockers', description: 'Dev2 blocked on Stripe sandbox access. Dev3 needs OpenAI credits.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(1) },
    { ownerId: uid('scrum@wudox.ca'), assignedById: uid('scrum@wudox.ca'), title: 'Prepare sprint 14 burndown chart', description: 'Share with PM and CTO in weekly sync.', priority: 'medium', status: 'to_do', dueDate: daysFromNow(3) },

    // HR2
    { ownerId: uid('hr2@wudox.ca'), assignedById: uid('hr@wudox.ca'), title: 'Send offer letter to selected candidate', description: 'Junior dev candidate. Letter drafted and approved.', priority: 'urgent', status: 'to_do', dueDate: daysFromNow(1) },
    { ownerId: uid('hr2@wudox.ca'), assignedById: uid('hr@wudox.ca'), title: 'Update leave balance records for August', description: 'Reconcile approved leaves with balance sheet.', priority: 'medium', status: 'in_progress', dueDate: daysFromNow(2) },
    { ownerId: uid('hr2@wudox.ca'), assignedById: uid('hr2@wudox.ca'), title: 'Organise team building event logistics', description: 'Venue, date, catering for 22 people. Budget: PKR 50k.', priority: 'low', status: 'to_do', dueDate: daysFromNow(14) },

    // Accountant
    { ownerId: uid('accountant@wudox.ca'), assignedById: uid('finance@wudox.ca'), title: 'Process August payroll', description: 'Verify hours, deductions, and bank transfers for all 22 staff.', priority: 'urgent', status: 'in_progress', dueDate: daysFromNow(2) },
    { ownerId: uid('accountant@wudox.ca'), assignedById: uid('finance@wudox.ca'), title: 'Record 3 vendor invoices in accounting system', description: 'AWS, Figma Pro, and office rent for August.', priority: 'high', status: 'to_do', dueDate: daysFromNow(3) },
    { ownerId: uid('accountant@wudox.ca'), assignedById: uid('accountant@wudox.ca'), title: 'Prepare tax provision estimate for Q3', description: 'Based on current P&L. Share with finance manager by EOW.', priority: 'high', status: 'to_do', dueDate: daysFromNow(5) },
    { ownerId: uid('accountant@wudox.ca'), assignedById: uid('finance@wudox.ca'), title: 'Update fixed asset register', description: 'Add 3 new laptops purchased in August.', priority: 'low', status: 'done', dueDate: daysFromNow(-3) },
  ];

  let taskCount = 0;
  for (const t of PERSONAL_TASKS) {
    if (alreadyHasPersonal.has(t.ownerId)) continue;
    await prisma.task.create({
      data: {
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate,
        completedAt: t.status === 'done' ? daysFromNow(-1) : null,
        owner: { connect: { id: t.ownerId } },
        assignedBy: { connect: { id: t.assignedById } },
        subCompany: { connect: { id: cid } },
      },
    });
    taskCount++;
  }
  console.log(`  ✅ ${taskCount} personal tasks created`);

  // ── 2. Task Comments on project tasks ─────────────────────────────────────
  console.log('\n💬 Task comments...');
  const projectTasks = await prisma.task.findMany({
    where: { subCompanyId: cid, projectId: { not: null } },
    include: { _count: { select: { comments: true } } },
    take: 30,
    orderBy: { createdAt: 'asc' },
  });

  const COMMENT_TEMPLATES = [
    { email: 'lead@wudox.ca',   comment: 'Picked this up. Will have a draft ready by tomorrow EOD.' },
    { email: 'pm@wudox.ca',     comment: 'This is blocking the milestone. Please prioritise.' },
    { email: 'qa@wudox.ca',     comment: 'Found 2 edge cases not covered. Adding test cases now.' },
    { email: 'cto@wudox.ca',    comment: 'Reviewed. Approach looks good. Proceed with implementation.' },
    { email: 'dev1@wudox.ca',   comment: 'PR raised — please review when you get a chance.' },
    { email: 'dev2@wudox.ca',   comment: 'Blocked on API sandbox access. Pinged devops.' },
    { email: 'designer@wudox.ca', comment: 'Design updated based on last feedback. Figma link in description.' },
    { email: 'ba@wudox.ca',     comment: 'Requirements clarified. Updated the BRD section 3.2.' },
    { email: 'devops@wudox.ca', comment: 'Environment is ready. Secrets added to AWS Secrets Manager.' },
    { email: 'scrum@wudox.ca',  comment: 'Added to sprint 14 board. ETA confirmed with team.' },
    { email: 'lead@wudox.ca',   comment: 'Merged to develop. CI passed. Deployed to staging.' },
    { email: 'qa.lead@wudox.ca', comment: 'QA sign-off done. No blocker issues found.' },
  ];

  let commentCount = 0;
  for (let i = 0; i < Math.min(projectTasks.length, 20); i++) {
    const task = projectTasks[i];
    if (task._count.comments > 0) continue;
    const numComments = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < numComments; j++) {
      const tmpl = COMMENT_TEMPLATES[(i + j) % COMMENT_TEMPLATES.length];
      const commenter = byEmail[tmpl.email];
      if (!commenter) continue;
      await prisma.taskComment.create({
        data: {
          taskId: task.id,
          userId: commenter.id,
          userName: `${commenter.firstName} ${commenter.lastName}`,
          content: tmpl.comment,
        },
      });
      commentCount++;
    }
  }
  console.log(`  ✅ ${commentCount} task comments added`);

  // ── 3. Notifications ───────────────────────────────────────────────────────
  console.log('\n🔔 Notifications...');
  const existingNotifs = await prisma.notification.groupBy({
    by: ['userId'],
    where: { subCompanyId: cid },
    _count: true,
  });
  const alreadyHasNotifs = new Set(
    existingNotifs.filter(r => r._count >= 3).map(r => r.userId)
  );

  const NOTIFS: Array<{
    email: string; type: string; title: string; body: string; readAt?: Date | null;
  }> = [
    // CTO
    { email: 'cto@wudox.ca', type: 'task_reminder',    title: 'Task due tomorrow',             body: 'Q3 budget review is due tomorrow.',                          readAt: null },
    { email: 'cto@wudox.ca', type: 'leave_request',     title: 'Leave request — Bilal Ahmad',  body: 'Bilal has requested 5 days annual leave from Aug 27.',        readAt: null },
    { email: 'cto@wudox.ca', type: 'milestone_reached', title: 'Milestone completed',          body: 'Design Mockups Approved — E-Commerce Platform ✓',              readAt: new Date() },
    { email: 'cto@wudox.ca', type: 'system',            title: 'Sprint 14 started',            body: 'Scrum master has kicked off sprint 14. 34 story points planned.',readAt: new Date() },

    // PM
    { email: 'pm@wudox.ca', type: 'task_assigned',      title: 'New task assigned to you',     body: 'Write monthly project status report — due in 6 days.',        readAt: null },
    { email: 'pm@wudox.ca', type: 'task_reminder',      title: 'Task overdue',                 body: 'Client demo prep is due today. Please update status.',         readAt: null },
    { email: 'pm@wudox.ca', type: 'leave_request',      title: 'Leave request — Kamran Ali',   body: 'Kamran has requested 5 days annual leave from Sep 17.',       readAt: null },
    { email: 'pm@wudox.ca', type: 'milestone_reached',  title: 'Milestone at risk',            body: 'Backend API Complete is due in 10 days — 4 tasks still open.', readAt: new Date() },

    // HR
    { email: 'hr@wudox.ca', type: 'leave_request',      title: 'Leave request — Fatima Noor',  body: 'Fatima has requested 5 days annual leave from Sep 7.',        readAt: null },
    { email: 'hr@wudox.ca', type: 'leave_request',      title: 'Leave request — Hamza Qureshi',body: 'Hamza has requested 1 day casual leave on Aug 20.',           readAt: null },
    { email: 'hr@wudox.ca', type: 'task_assigned',      title: 'New task assigned to you',     body: 'Post 2 senior developer job openings — due in 3 days.',       readAt: null },
    { email: 'hr@wudox.ca', type: 'system',             title: 'Performance review period open',body: 'Q3 performance reviews are now open. Schedule sessions.',     readAt: new Date() },

    // Finance
    { email: 'finance@wudox.ca', type: 'task_assigned', title: 'New task assigned to you',     body: 'Invoice client — E-Commerce Platform milestone 2.',           readAt: null },
    { email: 'finance@wudox.ca', type: 'task_reminder', title: 'Task due today',               body: 'Invoice for milestone 2 is due today.',                        readAt: null },
    { email: 'finance@wudox.ca', type: 'system',        title: 'Payroll processed',            body: 'August payroll confirmed. 22 transfers initiated.',            readAt: new Date() },

    // Team Lead
    { email: 'lead@wudox.ca', type: 'task_assigned',    title: 'PR review requested',          body: 'Bilal Ahmad requested review on PR #47 — product catalog.',   readAt: null },
    { email: 'lead@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',     body: 'Sprint 14 daily standup facilitation — starts today.',         readAt: null },
    { email: 'lead@wudox.ca', type: 'task_reminder',    title: 'Task due tomorrow',            body: 'Review and merge 4 open PRs is due tomorrow.',                 readAt: null },
    { email: 'lead@wudox.ca', type: 'system',           title: 'Incident alert',               body: 'Memory leak detected in user-service prod. DevOps investigating.', readAt: null },

    // QA Lead
    { email: 'qa.lead@wudox.ca', type: 'task_assigned', title: 'New task assigned to you',     body: 'Review qa2 test cases for Mobile Banking.',                   readAt: null },
    { email: 'qa.lead@wudox.ca', type: 'system',        title: 'Build deployed to staging',    body: 'Mobile Banking App build 0.3.1 is ready for QA on staging.',  readAt: null },
    { email: 'qa.lead@wudox.ca', type: 'task_reminder', title: 'Sprint 14 test plan due',      body: 'Finalise sprint 14 test plan by end of day.',                  readAt: null },

    // Design Lead
    { email: 'design.lead@wudox.ca', type: 'task_assigned', title: 'Design specs ready for review', body: 'Zara submitted checkout screens for approval.',         readAt: null },
    { email: 'design.lead@wudox.ca', type: 'system',        title: 'Figma library updated',         body: 'Raza updated the icon set. Please review before publish.',readAt: new Date() },

    // DevOps
    { email: 'devops@wudox.ca', type: 'system',         title: '🔴 Production alert — high memory', body: 'user-service pod restarted 3 times in last 2 hours.',    readAt: null },
    { email: 'devops@wudox.ca', type: 'task_assigned',  title: 'New task assigned to you',     body: 'Rotate all production secrets — due today.',                   readAt: null },
    { email: 'devops@wudox.ca', type: 'system',         title: 'Staging environment ready',    body: 'Mobile Banking App staging deployed successfully.',            readAt: new Date() },

    // Developers
    { email: 'dev1@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',     body: 'Fix checkout total calculation bug — urgent, due tomorrow.',   readAt: null },
    { email: 'dev1@wudox.ca', type: 'task_reminder',    title: 'PR review requested',          body: 'Omar Sheikh requested review on PR #51.',                      readAt: new Date() },
    { email: 'dev2@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',     body: 'Fix crash on iOS 17 — face ID screen. Urgent.',                readAt: null },
    { email: 'dev2@wudox.ca', type: 'system',           title: 'Stripe sandbox access granted',body: 'DevOps has granted your Stripe test account access.',           readAt: null },
    { email: 'dev3@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',     body: 'Fix broken deep link on Android — due in 2 days.',             readAt: null },
    { email: 'dev3@wudox.ca', type: 'system',           title: 'OpenAI credits added',         body: '$50 added to the team OpenAI account. Check Slack for key.',   readAt: new Date() },
    { email: 'dev4@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',     body: 'Fix mobile responsiveness on checkout — due tomorrow.',         readAt: null },
    { email: 'dev5@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',     body: 'Implement account balance screen — due in 5 days.',            readAt: null },
    { email: 'dev5@wudox.ca', type: 'system',           title: 'Welcome to the team!',         body: 'Your accounts are ready. Check with HR for your onboarding.',  readAt: new Date() },

    // QA
    { email: 'qa@wudox.ca',  type: 'task_assigned',    title: 'New task assigned to you',      body: 'Execute regression suite — auth module. Due today.',           readAt: null },
    { email: 'qa@wudox.ca',  type: 'system',           title: 'New build on staging',          body: 'E-Commerce Platform build 2.1.4 deployed. Start regression.',  readAt: null },
    { email: 'qa2@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',      body: 'Test biometric auth on Android 14 — due in 2 days.',          readAt: null },
    { email: 'qa2@wudox.ca', type: 'task_reminder',    title: 'Task due tomorrow',             body: 'Write 20 test cases for mobile onboarding — due tomorrow.',    readAt: null },

    // Design
    { email: 'designer@wudox.ca',  type: 'task_assigned', title: 'New task assigned to you',  body: 'Create presentation deck for client demo — urgent.',          readAt: null },
    { email: 'designer@wudox.ca',  type: 'system',        title: 'Design feedback from client',body: 'Client reviewed product listing page. 2 change requests.',    readAt: null },
    { email: 'designer2@wudox.ca', type: 'task_assigned', title: 'New task assigned to you',  body: 'Design chatbot widget UI — 3 variants needed.',               readAt: null },

    // BA
    { email: 'ba@wudox.ca',  type: 'task_assigned',    title: 'New task assigned to you',      body: 'Write BRD for order management module — due in 3 days.',      readAt: null },
    { email: 'ba@wudox.ca',  type: 'system',           title: 'Workshop scheduled',            body: 'AI Chatbot requirements workshop on Aug 23 at 10am.',          readAt: new Date() },
    { email: 'ba2@wudox.ca', type: 'task_assigned',    title: 'New task assigned to you',      body: 'Create user stories for customer portal auth.',                readAt: null },

    // Support
    { email: 'scrum@wudox.ca',    type: 'task_assigned', title: 'Blocker to resolve',          body: 'Dev2 blocked on Stripe sandbox. Escalate to DevOps.',          readAt: null },
    { email: 'scrum@wudox.ca',    type: 'system',        title: 'Sprint 14 velocity alert',    body: 'Team is at 60% velocity. 2 items at risk of carry-over.',      readAt: null },
    { email: 'hr2@wudox.ca',      type: 'task_assigned', title: 'New task assigned to you',    body: 'Send offer letter to selected candidate — due today.',         readAt: null },
    { email: 'accountant@wudox.ca', type: 'task_assigned', title: 'New task assigned to you',  body: 'Process August payroll — due in 2 days.',                      readAt: null },
    { email: 'accountant@wudox.ca', type: 'system',      title: 'Invoice received',            body: 'AWS invoice for August received. PKR 127,000. Awaiting approval.', readAt: null },
  ];

  let notifCount = 0;
  for (const n of NOTIFS) {
    const u = byEmail[n.email];
    if (!u || alreadyHasNotifs.has(u.id)) continue;
    await prisma.notification.create({
      data: {
        userId: u.id,
        subCompanyId: cid,
        type: n.type,
        title: n.title,
        body: n.body,
        readAt: n.readAt,
      },
    });
    notifCount++;
  }
  console.log(`  ✅ ${notifCount} notifications created`);

  // ── 4. Activity Logs ───────────────────────────────────────────────────────
  console.log('\n📊 Activity logs...');
  const existingLogs = await prisma.activityLog.groupBy({
    by: ['userId'],
    where: { subCompanyId: cid },
    _count: true,
  });
  const alreadyHasLogs = new Set(
    existingLogs.filter(r => r._count >= 3).map(r => r.userId)
  );

  const LOGS: Array<{ email: string; type: string; description: string; hoursAgo: number }> = [
    { email: 'cto@wudox.ca',       type: 'task_update',    description: 'Updated task: Q3 budget review — status changed to in_progress', hoursAgo: 2 },
    { email: 'cto@wudox.ca',       type: 'leave_review',   description: 'Approved leave request for Sarah Khan (5 days annual leave)',     hoursAgo: 5 },
    { email: 'cto@wudox.ca',       type: 'task_create',    description: 'Created task: Update tech roadmap for Q4',                       hoursAgo: 24 },
    { email: 'pm@wudox.ca',        type: 'task_update',    description: 'Marked task done: Review and approve team timesheets',           hoursAgo: 3 },
    { email: 'pm@wudox.ca',        type: 'task_create',    description: 'Created task: Client demo prep — E-Commerce Platform',           hoursAgo: 6 },
    { email: 'pm@wudox.ca',        type: 'task_assign',    description: 'Assigned task to Bilal Ahmad: Fix checkout total calculation bug',hoursAgo: 8 },
    { email: 'lead@wudox.ca',      type: 'task_update',    description: 'Merged PR #47 — product catalog component',                     hoursAgo: 1 },
    { email: 'lead@wudox.ca',      type: 'comment_add',    description: 'Commented on task: Build product catalog API',                  hoursAgo: 4 },
    { email: 'lead@wudox.ca',      type: 'task_update',    description: 'Updated task status: Review and merge PRs → in_progress',       hoursAgo: 7 },
    { email: 'devops@wudox.ca',    type: 'task_update',    description: 'Updated task: Set up staging — status in_progress',             hoursAgo: 2 },
    { email: 'devops@wudox.ca',    type: 'task_complete',  description: 'Completed task: Provision EKS cluster on AWS',                  hoursAgo: 24 },
    { email: 'devops@wudox.ca',    type: 'system_event',   description: 'Deployed Mobile Banking App 0.3.1 to staging',                 hoursAgo: 3 },
    { email: 'dev1@wudox.ca',      type: 'task_update',    description: 'Updated task: Fix checkout bug — started working',              hoursAgo: 1 },
    { email: 'dev1@wudox.ca',      type: 'task_complete',  description: 'Completed task: Code review — Hamza\'s PR',                    hoursAgo: 5 },
    { email: 'dev1@wudox.ca',      type: 'comment_add',    description: 'Commented on task: Build product catalog API',                  hoursAgo: 3 },
    { email: 'dev2@wudox.ca',      type: 'task_update',    description: 'Updated task: Implement Stripe webhook handler → in_progress',  hoursAgo: 2 },
    { email: 'dev2@wudox.ca',      type: 'comment_add',    description: 'Commented on task: Integrate Stripe payment gateway',           hoursAgo: 6 },
    { email: 'dev3@wudox.ca',      type: 'task_update',    description: 'Updated task: Spike — OpenAI embeddings → in_progress',        hoursAgo: 3 },
    { email: 'dev4@wudox.ca',      type: 'task_update',    description: 'Updated task: Product catalogue components → in_progress',     hoursAgo: 4 },
    { email: 'dev4@wudox.ca',      type: 'task_complete',  description: 'Completed task: Integrate toast notifications',                 hoursAgo: 10 },
    { email: 'dev5@wudox.ca',      type: 'task_complete',  description: 'Completed task: Set up React Native navigation structure',      hoursAgo: 15 },
    { email: 'dev5@wudox.ca',      type: 'task_update',    description: 'Updated task: Implement account balance screen → in_progress', hoursAgo: 5 },
    { email: 'qa@wudox.ca',        type: 'task_update',    description: 'Updated task: Regression suite — started execution',           hoursAgo: 2 },
    { email: 'qa@wudox.ca',        type: 'task_complete',  description: 'Completed task: Report 3 UI bugs from last build',             hoursAgo: 8 },
    { email: 'qa2@wudox.ca',       type: 'task_update',    description: 'Updated task: Write 20 test cases → in_progress',             hoursAgo: 3 },
    { email: 'qa.lead@wudox.ca',   type: 'task_complete',  description: 'Completed task: Regression test — CRM Dashboard v1.2',        hoursAgo: 6 },
    { email: 'qa.lead@wudox.ca',   type: 'task_update',    description: 'Updated task: Sprint 14 test plan → in_progress',             hoursAgo: 2 },
    { email: 'designer@wudox.ca',  type: 'task_complete',  description: 'Completed task: User research synthesis',                      hoursAgo: 12 },
    { email: 'designer@wudox.ca',  type: 'task_update',    description: 'Updated task: Design checkout screens → in_progress',          hoursAgo: 4 },
    { email: 'designer2@wudox.ca', type: 'task_update',    description: 'Updated task: Design chatbot widget → in_progress',            hoursAgo: 5 },
    { email: 'design.lead@wudox.ca', type: 'task_update',  description: 'Updated task: Design system component library → in_progress', hoursAgo: 3 },
    { email: 'ba@wudox.ca',        type: 'task_complete',  description: 'Completed task: Analyse competitor portals',                   hoursAgo: 10 },
    { email: 'ba@wudox.ca',        type: 'task_update',    description: 'Updated task: Write BRD → in_progress',                        hoursAgo: 2 },
    { email: 'ba2@wudox.ca',       type: 'task_update',    description: 'Updated task: Create user stories for portal auth → in_progress', hoursAgo: 4 },
    { email: 'scrum@wudox.ca',     type: 'task_complete',  description: 'Completed task: Update sprint velocity tracker',               hoursAgo: 8 },
    { email: 'scrum@wudox.ca',     type: 'task_update',    description: 'Updated task: Identify and resolve team blockers → in_progress', hoursAgo: 3 },
    { email: 'hr@wudox.ca',        type: 'task_update',    description: 'Updated task: Schedule Q3 performance reviews → in_progress',  hoursAgo: 5 },
    { email: 'hr@wudox.ca',        type: 'leave_review',   description: 'Approved leave request for Zara Ahmed (1 day casual)',         hoursAgo: 7 },
    { email: 'hr2@wudox.ca',       type: 'task_update',    description: 'Updated task: Update leave balance records → in_progress',     hoursAgo: 3 },
    { email: 'finance@wudox.ca',   type: 'task_complete',  description: 'Completed task: Reconcile August vendor payments',             hoursAgo: 15 },
    { email: 'finance@wudox.ca',   type: 'task_update',    description: 'Updated task: Q3 financial summary → in_progress',            hoursAgo: 4 },
    { email: 'accountant@wudox.ca',type: 'task_complete',  description: 'Completed task: Update fixed asset register',                  hoursAgo: 20 },
    { email: 'accountant@wudox.ca',type: 'task_update',    description: 'Updated task: Process August payroll → in_progress',          hoursAgo: 2 },
  ];

  let logCount = 0;
  for (const l of LOGS) {
    const u = byEmail[l.email];
    if (!u || alreadyHasLogs.has(u.id)) continue;
    const ts = new Date();
    ts.setHours(ts.getHours() - l.hoursAgo);
    await prisma.activityLog.create({
      data: {
        type: l.type,
        userId: u.id,
        userName: uname(l.email),
        subCompanyId: cid,
        description: l.description,
        timestamp: ts,
      },
    });
    logCount++;
  }
  console.log(`  ✅ ${logCount} activity logs created`);

  // ── 5. Team Conversations + Messages ──────────────────────────────────────
  console.log('\n💬 Team conversations...');
  const existingConvos = await prisma.conversation.count({ where: { subCompanyId: cid } });
  if (existingConvos >= 5) {
    console.log('  ⏭  Conversations already exist, skipping');
  } else {
    const CONVERSATIONS = [
      {
        name: 'Dev Team',
        participants: ['lead@wudox.ca','dev1@wudox.ca','dev2@wudox.ca','dev3@wudox.ca','dev4@wudox.ca','dev5@wudox.ca','devops@wudox.ca'],
        messages: [
          { email: 'lead@wudox.ca',   text: 'Morning team 👋 standup in 10 mins' },
          { email: 'dev1@wudox.ca',   text: 'On my way, just finishing the auth PR' },
          { email: 'dev2@wudox.ca',   text: 'Still blocked on Stripe sandbox — Kamran any update?' },
          { email: 'devops@wudox.ca', text: 'Just granted access. Check your email for the creds' },
          { email: 'dev2@wudox.ca',   text: 'Got it, thanks! Starting the webhook handler now' },
          { email: 'dev3@wudox.ca',   text: 'Deep link fix is harder than expected. Android back stack issue. Will need today to debug' },
          { email: 'lead@wudox.ca',   text: 'Noted, flag if you need a second pair of eyes' },
          { email: 'dev4@wudox.ca',   text: 'Checkout page mobile fix is done — pushed to dev branch' },
          { email: 'dev5@wudox.ca',   text: 'Account balance screen looking good. Should be ready for review by 3pm' },
          { email: 'dev1@wudox.ca',   text: 'PR #47 is up — product catalog with pagination. Please review 🙏' },
          { email: 'lead@wudox.ca',   text: 'On it, will review after standup' },
          { email: 'devops@wudox.ca', text: 'Heads up — user-service memory spike in prod. Investigating now. Not user-impacting yet' },
        ],
      },
      {
        name: 'QA Team',
        participants: ['qa.lead@wudox.ca','qa@wudox.ca','qa2@wudox.ca'],
        messages: [
          { email: 'qa.lead@wudox.ca', text: 'New build 2.1.4 on staging. Let\'s start regression on auth module first' },
          { email: 'qa@wudox.ca',       text: 'On it. Found 2 issues already — login redirect after password reset is broken' },
          { email: 'qa.lead@wudox.ca', text: 'Log it in Linear with steps to repro. Mark as P1' },
          { email: 'qa2@wudox.ca',      text: 'I\'ll cover the mobile onboarding tests. Starting with Android 14 biometric' },
          { email: 'qa@wudox.ca',       text: 'Session timeout is also behaving odd — logging out after 2 mins instead of 30' },
          { email: 'qa.lead@wudox.ca', text: 'Good catch. That might be a config issue. Ping devops' },
          { email: 'qa2@wudox.ca',      text: 'Biometric tests passing on Android 14 ✅ iOS 17 face ID is still flaky' },
          { email: 'qa.lead@wudox.ca', text: 'Dev2 is working on that. We\'ll retest once the fix is in' },
        ],
      },
      {
        name: 'Design Team',
        participants: ['design.lead@wudox.ca','designer@wudox.ca','designer2@wudox.ca','pm@wudox.ca'],
        messages: [
          { email: 'design.lead@wudox.ca', text: 'Zara, can you share the checkout screens? Dev needs handoff by tomorrow' },
          { email: 'designer@wudox.ca',    text: 'Almost done — just adding the loading and error states. Will share in 2h' },
          { email: 'designer2@wudox.ca',   text: 'Icon set updated. 16 icons done. Figma link in the design channel' },
          { email: 'design.lead@wudox.ca', text: 'Raza nice work. I\'ll review and approve by EOD' },
          { email: 'pm@wudox.ca',          text: 'Reminder — client demo is in 4 days. Presentation deck needs to be ready by Wed' },
          { email: 'designer@wudox.ca',    text: 'On it. Zara is on the deck too. We\'ll have a draft by Tue for review' },
          { email: 'designer2@wudox.ca',   text: 'Chatbot widget variants ready — 3 options attached. Which direction do we go?' },
          { email: 'design.lead@wudox.ca', text: 'Let\'s go with option 2 — the sidebar panel. Cleaner for mobile' },
        ],
      },
      {
        name: 'Sprint Planning',
        participants: ['cto@wudox.ca','pm@wudox.ca','scrum@wudox.ca','lead@wudox.ca','qa.lead@wudox.ca','design.lead@wudox.ca','devops@wudox.ca'],
        messages: [
          { email: 'scrum@wudox.ca', text: 'Sprint 14 planning deck is ready. 34 story points across 3 projects' },
          { email: 'pm@wudox.ca',    text: 'Looks good. Main focus is payment gateway and mobile auth this sprint' },
          { email: 'lead@wudox.ca',  text: 'Dev team is at capacity. Any new items need to go to backlog' },
          { email: 'cto@wudox.ca',   text: 'Agreed. The AI Chatbot is on hold anyway. Focus on E-Commerce launch' },
          { email: 'qa.lead@wudox.ca', text: 'QA needs 2 days buffer after dev freeze. Build the test window into the sprint' },
          { email: 'scrum@wudox.ca', text: 'Updated the timeline. Dev freeze Aug 28, QA Aug 29-30, release Sep 1' },
          { email: 'devops@wudox.ca', text: 'Staging is ready. I\'ll coordinate the deployment window with PM' },
          { email: 'pm@wudox.ca',    text: 'Perfect. Sprint 14 officially starts now. Let\'s go 🚀' },
          { email: 'cto@wudox.ca',   text: 'Great work everyone. Daily standups at 9am. Let\'s ship this!' },
        ],
      },
      {
        name: 'Management',
        participants: ['cto@wudox.ca','pm@wudox.ca','hr@wudox.ca','finance@wudox.ca'],
        messages: [
          { email: 'hr@wudox.ca',      text: 'Sana here — 3 leave requests pending. Bilal, Fatima, and Kamran. Need approvals by EOD' },
          { email: 'cto@wudox.ca',     text: 'Approved Bilal and Kamran. Fatima\'s dates conflict with release week — please check' },
          { email: 'hr@wudox.ca',      text: 'Got it. Will reach out to Fatima and suggest alt dates' },
          { email: 'finance@wudox.ca', text: 'Q3 financials look healthy. Revenue up 18% QoQ. Sharing report in the drive' },
          { email: 'cto@wudox.ca',     text: 'Great news 💪 Can you prepare the investor summary slide too?' },
          { email: 'finance@wudox.ca', text: 'On it. Will have it ready by Thursday' },
          { email: 'pm@wudox.ca',      text: 'E-Commerce client demo is this Friday. Should we invite the CTO to present?' },
          { email: 'cto@wudox.ca',     text: 'Yes I\'ll join for the first 15 mins then hand over to you and the team' },
          { email: 'hr@wudox.ca',      text: 'Junior dev offer accepted! Starting Sep 1. Onboarding checklist in progress' },
          { email: 'cto@wudox.ca',     text: 'Excellent! Great hiring work Sana 👏' },
        ],
      },
    ];

    let convoCount = 0;
    for (const c of CONVERSATIONS) {
      const participants = c.participants.filter(e => byEmail[e]);
      if (participants.length < 2) continue;

      const convo = await prisma.conversation.create({
        data: { subCompanyId: cid },
      });

      await prisma.conversationParticipant.createMany({
        data: participants.map(e => ({
          conversationId: convo.id,
          userId: uid(e),
        })),
        skipDuplicates: true,
      });

      for (const msg of c.messages) {
        const sender = byEmail[msg.email];
        if (!sender) continue;
        await prisma.message.create({
          data: {
            conversationId: convo.id,
            senderId: sender.id,
            text: msg.text,
            type: 'text',
          },
        });
      }

      // Mark all messages as read for all participants
      await prisma.conversationParticipant.updateMany({
        where: { conversationId: convo.id },
        data: { lastReadAt: new Date() },
      });

      // Leave a few messages unread for realism — reset lastReadAt for some
      const firstParticipant = byEmail[participants[participants.length - 1]];
      if (firstParticipant) {
        await prisma.conversationParticipant.update({
          where: { conversationId_userId: { conversationId: convo.id, userId: firstParticipant.id } },
          data: { lastReadAt: daysFromNow(-1) },
        });
      }

      console.log(`  💬 "${c.name}" — ${participants.length} members, ${c.messages.length} messages`);
      convoCount++;
    }
    console.log(`  ✅ ${convoCount} conversations created`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\n✅ Dummy data seeded!\n');
  console.log('  Personal tasks:    ~' + taskCount);
  console.log('  Task comments:     ~' + commentCount);
  console.log('  Notifications:     ~' + notifCount);
  console.log('  Activity logs:     ~' + logCount);
  console.log('  Team chat convos:   5 (Dev, QA, Design, Sprint Planning, Management)\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
