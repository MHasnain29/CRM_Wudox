/**
 * seedAll.ts — Full demo seed for client presentations.
 *
 * Runs in two phases:
 *   1. Staffing / Sales CRM  (seed.ts)   — wipes DB, creates staffing users + all sales data
 *   2. Software House CRM    (seed-demo-software.ts) — adds SW users, projects, leave on top
 *
 * Run:
 *   cd backend
 *   npx tsx prisma/seedAll.ts
 *
 * Or via npm:
 *   npm run prisma:seed-all
 */

import { execSync } from 'child_process';
import * as path from 'path';

const root = path.resolve(__dirname, '..');

function run(label: string, script: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}\n`);
  execSync(`npx tsx ${script}`, { stdio: 'inherit', cwd: root });
}

async function main() {
  const start = Date.now();

  console.log('\n🚀  WUDOX FULL DEMO SEED');
  console.log('   Password for all accounts: password123\n');

  // Phase 1 — wipes DB, seeds staffing CRM (users, clients, leads, jobs, etc.)
  run('Phase 1 — Staffing / Sales CRM', 'prisma/seed.ts');

  // Phase 2 — adds software house users + projects, tasks, leave (safe upserts, no wipe)
  run('Phase 2 — Software House CRM', 'prisma/seed-demo-software.ts');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ✅  DEMO SEED COMPLETE');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total time: ${elapsed}s\n`);

  console.log('  STAFFING CRM  (@wudox.ca)');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  hassan@wudox.ca              super_admin');
  console.log('  director@wudox.ca             director');
  console.log('  company.director@wudox.ca     company_director');
  console.log('  manager1@wudox.ca             sales_manager');
  console.log('  associate1@wudox.ca           sales_associate');
  console.log('  associate2@wudox.ca           sales_associate');
  console.log('  marketing@wudox.ca            marketing');
  console.log('  recruiter1@wudox.ca           recruiter');
  console.log('  pakistan@wudox.ca             recruiter');
  console.log('  recruitment.manager@wudox.ca  recruitment_manager');
  console.log('  executive@wudox.ca            sales_executive');
  console.log('  sr.recruiter@wudox.ca         sr_recruiter');
  console.log('  dataentry@wudox.ca            data_entry_specialist');
  console.log('  db.manager@wudox.ca           database_manager');
  console.log('  operations@wudox.ca           operations_manager');
  console.log('  it@wudox.ca                   it\n');

  console.log('  SOFTWARE HOUSE  (@wudox.ca)');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  cto@wudox.ca                 cto');
  console.log('  pm@wudox.ca                  project_manager');
  console.log('  scrum@wudox.ca               project_manager');
  console.log('  hr@wudox.ca                  hr');
  console.log('  hr2@wudox.ca                 hr');
  console.log('  finance@wudox.ca             finance');
  console.log('  accountant@wudox.ca          finance');
  console.log('  lead@wudox.ca                team_lead');
  console.log('  qa.lead@wudox.ca             team_lead');
  console.log('  design.lead@wudox.ca         team_lead');
  console.log('  dev1@wudox.ca                developer');
  console.log('  dev2@wudox.ca                developer');
  console.log('  dev3@wudox.ca                developer');
  console.log('  dev4@wudox.ca                developer');
  console.log('  dev5@wudox.ca                developer');
  console.log('  qa@wudox.ca                  qa_engineer');
  console.log('  qa2@wudox.ca                 qa_engineer');
  console.log('  designer@wudox.ca            ui_ux_designer');
  console.log('  designer2@wudox.ca           ui_ux_designer');
  console.log('  ba@wudox.ca                  business_analyst');
  console.log('  ba2@wudox.ca                 business_analyst');
  console.log('  devops@wudox.ca              devops_engineer');
  console.log(`\n  ${'═'.repeat(58)}\n`);
}

main().catch((e) => {
  console.error('\n❌ Seed failed:', e.message ?? e);
  process.exit(1);
});
