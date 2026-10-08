/**
 * One-time industry normalization for the reviewed Wudox-Mississauga export.
 *
 * Dry run (default):
 *   npx tsx scripts/industry-cleanup.ts --plan=/private/path/industry-cleanup-plan.json
 *
 * Apply only after verifying a real PostgreSQL backup and the dry-run result:
 *   npx tsx scripts/industry-cleanup.ts --plan=... --apply \
 *     --backup-file=/private/path/backup.dump \
 *     --expected-db-host=actual-db-host \
 *     --expected-db-name=actual-db-name \
 *     --receipt=/private/path/industry-cleanup-receipt.json
 *
 * This changes Client.industry only. It never deletes/recreates clients or
 * touches mailing-list membership, contacts, unsubscribes, or campaign history.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';

dotenv.config({ path: resolve(__dirname, '..', '.env') });

type PlanRow = {
  clientId: string;
  originalIndustry: string;
  proposedIndustry: string;
  sourceUpdatedAt: string;
};
type Plan = {
  version: 1;
  agencyId: string;
  agencyName: string;
  sourceExportedAt: string;
  sourceClientCount: number;
  rows: PlanRow[];
};

const SOURCE_LABELS: Record<string, Set<string>> = {
  Salon: new Set([
    'Barber Shop 2', 'Barbershop', 'Barbershop 1', 'Barbershop 123',
    'Barbershop monteral', 'Barbershop torronto', 'Hair salon', 'Hair Salon',
  ]),
  'Staffing & Recruitment': new Set([
    'Blue-collar staffing', 'Employment & staffing solutions',
    'High-volume staffing & recruitment', 'Professional & executive recruitment',
    'Recruitment & HR advisory', 'Recruitment & staffing',
    'Recruitment & temporary staffing', 'Recruitment agency',
    'Staffing & Recruiting', 'Staffing & Recruiting Alberta',
    'Staffing & Recruiting manitoba', 'Staffing & Recruiting Nova_Scotia',
    'Staffing & Recruiting Saskatchewan', 'Staffing & recruitment',
    'Staffing & Recruitment New_Brunswick', 'Staffing & Recruitment Newfoundland',
    'Staffing & workforce solutions', 'Temporary & permanent staffing',
    'Temporary labour staffing', 'Temporary staffing',
  ]),
  'Truck Driving School': new Set([
    'Truck academy', 'Truck academy 1', 'Truck Driver Training m',
    'Truck Driver Training School', 'Truck Driver Training School 2',
    'Truck Driving School & Acadmey 1', 'Truck Driving School 2',
  ]),
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parsePlan(file: string): { plan: Plan; sha256: string } {
  const bytes = readFileSync(file);
  const plan: Plan = JSON.parse(bytes.toString('utf8'));
  if (plan.version !== 1 || !UUID.test(plan.agencyId) || !Array.isArray(plan.rows)) {
    throw new Error('Invalid plan header');
  }
  if (plan.agencyId !== '1ddfea6e-bd48-4016-9dff-86d06a66b1fd') {
    throw new Error('Plan is for a different agency');
  }
  if (plan.sourceClientCount !== 2082 || plan.rows.length !== 1290) {
    throw new Error('Unexpected export or change count; review and regenerate the plan');
  }
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const row of plan.rows) {
    if (!UUID.test(row.clientId) || seen.has(row.clientId)) throw new Error('Invalid or duplicate client ID');
    if (!SOURCE_LABELS[row.proposedIndustry]?.has(row.originalIndustry)) {
      throw new Error(`Invalid industry change for ${row.clientId}`);
    }
    if (Number.isNaN(Date.parse(row.sourceUpdatedAt)) || new Date(row.sourceUpdatedAt).toISOString() !== row.sourceUpdatedAt) {
      throw new Error(`Invalid source timestamp for ${row.clientId}`);
    }
    seen.add(row.clientId);
    counts[row.proposedIndustry] = (counts[row.proposedIndustry] ?? 0) + 1;
  }
  if (counts.Salon !== 799 || counts['Staffing & Recruitment'] !== 290 || counts['Truck Driving School'] !== 201) {
    throw new Error('Plan totals differ from the reviewed proposal');
  }
  return { plan, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function writeReceipt(file: string, receipt: object, newFile: boolean): void {
  const contents = `${JSON.stringify(receipt, null, 2)}\n`;
  if (newFile) {
    writeFileSync(file, contents, { flag: 'wx', mode: 0o600 });
  } else {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  }
}

async function main(): Promise<void> {
  const planFile = option('--plan');
  const applying = process.argv.includes('--apply');
  const backupFile = option('--backup-file');
  const expectedHost = option('--expected-db-host');
  const expectedName = option('--expected-db-name');
  const receiptFile = option('--receipt');
  if (!planFile) throw new Error('Pass --plan=/path/to/industry-cleanup-plan.json');
  const { plan, sha256 } = parsePlan(resolve(planFile));

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is missing');
  const parsedDbUrl = new URL(dbUrl);
  const dbHost = parsedDbUrl.hostname;
  const dbName = decodeURIComponent(parsedDbUrl.pathname.slice(1));
  if (applying) {
    if (!backupFile || !expectedHost || !expectedName || !receiptFile) {
      throw new Error('--apply requires --backup-file, --expected-db-host, --expected-db-name, and --receipt');
    }
    if (dbHost !== expectedHost) throw new Error(`Database host is ${dbHost}, not ${expectedHost}`);
    if (dbName !== expectedName) throw new Error(`Database name is ${dbName}, not ${expectedName}`);
    const backup = statSync(resolve(backupFile));
    if (!backup.isFile() || backup.size === 0) throw new Error('Backup file is missing or empty');
    const backupDescriptor = openSync(resolve(backupFile), 'r');
    const backupHeader = Buffer.alloc(64);
    try {
      readSync(backupDescriptor, backupHeader, 0, backupHeader.length, 0);
    } finally {
      closeSync(backupDescriptor);
    }
    if (/^[\s\uFEFF]*[\[{]/.test(backupHeader.toString('utf8'))) {
      throw new Error('The browser JSON export is not a PostgreSQL backup');
    }
    if (!existsSync(dirname(resolve(receiptFile)))) throw new Error('Receipt directory does not exist');
    if (existsSync(resolve(receiptFile))) throw new Error('Receipt path already exists');
  }

  const prisma = new PrismaClient();
  try {
    const current = new Map<string, { industry: string | null; updatedAt: Date }>();
    for (const batch of chunks(plan.rows, 200)) {
      const found = await prisma.client.findMany({
        where: { id: { in: batch.map((row) => row.clientId) } },
        select: { id: true, industry: true, updatedAt: true },
      });
      for (const row of found) current.set(row.id, row);
    }
    const mismatches = plan.rows.filter((row) => {
      const found = current.get(row.clientId);
      return !found || found.industry !== row.originalIndustry || found.updatedAt.toISOString() !== row.sourceUpdatedAt;
    });
    console.log(`Plan: ${plan.rows.length} industry updates for ${plan.agencyName}`);
    console.log(`Database: ${dbHost}/${dbName}; plan SHA-256: ${sha256}`);
    console.log('Salon: 799; Staffing & Recruitment: 290; Truck Driving School: 201');
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} client(s) are missing or changed since the export. First IDs: ${mismatches.slice(0, 10).map((r) => r.clientId).join(', ')}`);
      throw new Error('Preflight failed; no rows changed. Refresh the export and review');
    }
    const allowed = await prisma.allowedIndustry.findMany({
      where: { subCompanyId: plan.agencyId },
      select: { name: true },
    });
    const allowedNames = new Set(allowed.map((row) => row.name));
    const missingOptions = Object.keys(SOURCE_LABELS).filter((name) => !allowedNames.has(name));
    if (missingOptions.length > 0) {
      console.warn(`Missing Add Client industry options: ${missingOptions.join(', ')}`);
      if (applying) throw new Error('Add the canonical industry options in Settings before applying; no rows changed');
    }
    if (!applying) {
      console.log('Dry run passed. No rows changed.');
      return;
    }

    const receipt = {
      status: 'prepared',
      planSha256: sha256,
      databaseHost: dbHost,
      databaseName: dbName,
      agencyId: plan.agencyId,
      preparedAt: new Date().toISOString(),
      rows: plan.rows.map(({ clientId, originalIndustry, proposedIndustry, sourceUpdatedAt }) => ({
        clientId,
        originalIndustry,
        proposedIndustry,
        sourceUpdatedAt,
      })),
    };
    writeReceipt(resolve(receiptFile!), receipt, true);
    await prisma.$transaction(async (tx) => {
      for (const row of plan.rows) {
        const result = await tx.client.updateMany({
          where: {
            id: row.clientId,
            industry: row.originalIndustry,
            updatedAt: new Date(row.sourceUpdatedAt),
          },
          data: { industry: row.proposedIndustry },
        });
        if (result.count !== 1) throw new Error(`Client changed during apply: ${row.clientId}`);
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 300_000 });

    writeReceipt(resolve(receiptFile!), { ...receipt, status: 'applied', appliedAt: new Date().toISOString() }, false);
    console.log(`Applied ${plan.rows.length} industry updates. Receipt: ${resolve(receiptFile!)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
