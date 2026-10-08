/**
 * Seeds realistic DEMO bulk-email data so the Bulk Mail date / scope filters can be checked by eye.
 *
 * Per agency it creates 15 campaigns sitting exactly on the preset boundaries (today, 6 / 7 / 29 / 30 days
 * ago, the 1st of this month at 02:00 local, mid and last-day-23:30 of last month, two months ago, last
 * December) in every status (sent / scheduled / draft / failed / a legacy "sent" row with no sent date),
 * created by a mix of managers and associates so the Authority / Manager / Team chips change the numbers.
 * Sent campaigns get real recipient rows with engagement timestamps (stats are derived with the same
 * formula as recomputeCampaignStats, so the 30s refresher leaves them unchanged), and a few approved lead
 * requests are added that count as conversions on the Mail Conversion Rate card — plus one that must NOT.
 *
 * Everything it creates is tagged and removable:
 *   campaigns      listId = 'demo-date-filter'
 *   clients        corporateCode 'DEMO-…' (their agency links and contacts cascade)
 *   lead requests  note starts with '[DEMO]'
 *
 * Local dev DB only (refuses a non-local DATABASE_URL unless --force). Dates are the machine's local time,
 * which is also what the browser on this machine uses.
 *
 *   npx tsx scripts/seed-demo-bulk-emails.ts          # remove old demo rows, seed, print the expected numbers
 *   npx tsx scripts/seed-demo-bulk-emails.ts --clean  # only remove the demo rows
 */
import '../src/loadEnv';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type CampaignStatus, type EmailRecipientStatus } from '@prisma/client';

// Local-time date helpers (the backend has no date library). Local time is what the browser on this machine
// uses for its day edges, so these boundaries line up with the page's presets.
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const subDays = (d: Date, n: number) => addDays(d, -n);
const addHours = (d: Date, n: number) => new Date(d.getTime() + n * 3_600_000);
const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
const addMilliseconds = (d: Date, n: number) => new Date(d.getTime() + n);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
/** Month arithmetic only (always the 1st), used to address a previous month. */
const subMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() - n, 1);
const atTime = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
const onDay = (monthRef: Date, day: number, h: number, m = 0) => new Date(monthRef.getFullYear(), monthRef.getMonth(), day, h, m, 0, 0);
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const prisma = new PrismaClient();

const LIST_ID = 'demo-date-filter';
const LIST_NAME = 'Demo list (seeded)';
const CORP_PREFIX = 'DEMO-';
const NOTE_PREFIX = '[DEMO]';
const CLIENTS_PER_AGENCY = 125;

// ─── Campaign templates ───────────────────────────────────────────────────────────────────────────────
type CreatorKey = 'M1' | 'M2' | 'A1' | 'A2' | 'A3';
interface Tpl {
  key: string;
  name: string;
  status: CampaignStatus;
  creator: CreatorKey;
  createdAt: Date;
  scheduledDate: Date;
  sentAt: Date | null;
  recipients: number;
}

function buildTemplates(now: Date): Tpl[] {
  const d0 = startOfDay(now);
  const at = (dayOffset: number, h: number, m = 0) => atTime(addDays(d0, dayOffset), h, m);
  const lastMonth = subMonths(now, 1);
  const sent = (key: string, name: string, creator: CreatorKey, when: Date, recipients: number): Tpl =>
    ({ key, name, status: 'sent', creator, createdAt: addHours(when, -3), scheduledDate: when, sentAt: when, recipients });

  return [
    // 'today' has the most recipients on purpose: client #120 is reached ONLY by it (see the negative conversion case).
    sent('today',    'Fall hiring push — sent today 10:00',                'A1', at(0, 10), 121),
    sent('d1',       'Product update — sent yesterday',                    'M1', at(-1, 11, 30), 80),
    sent('d6',       'Client newsletter — 6 days ago (inside Last 7)',     'A2', at(-6, 9, 15), 110),
    sent('d7',       'Boundary — 7 days ago (outside Last 7)',             'A1', at(-7, 16), 64),
    sent('d29',      'Boundary — 29 days ago (inside Last 30)',            'M2', at(-29, 10), 72),
    sent('d30',      'Boundary — 30 days ago (outside Last 30)',           'A3', at(-30, 10), 58),
    sent('m-02',     'Local-midnight check — 1st of this month 02:00',     'M1', atTime(startOfMonth(now), 2), 90),
    sent('lm-mid',   'Mid last month',                                     'A2', onDay(lastMonth, 15, 11), 100),
    sent('lm-end',   'Last day of last month 23:30',                       'M2', atTime(endOfMonth(lastMonth), 23, 30), 70),
    sent('m-2',      'Two months ago (All Time only)',                     'A1', onDay(subMonths(now, 2), 12, 10), 85),
    sent('ly',       'Last December (All Time only)',                      'M1', new Date(now.getFullYear() - 1, 11, 10, 10, 0, 0, 0), 100),
    { key: 'sched',  name: 'Scheduled — goes out in 3 days',               status: 'scheduled', creator: 'A2', createdAt: at(-1, 15), scheduledDate: at(3, 9),  sentAt: null, recipients: 0 },
    { key: 'draft',  name: 'Draft — created 2 days ago',                   status: 'draft',     creator: 'A3', createdAt: at(-2, 14), scheduledDate: at(-2, 14), sentAt: null, recipients: 0 },
    { key: 'failed', name: 'Failed send — created 5 days ago',             status: 'failed',    creator: 'M1', createdAt: at(-5, 9),  scheduledDate: at(-5, 9),  sentAt: at(-4, 9), recipients: 50 },
    { key: 'legacy', name: 'Legacy sent — no sent date, created 10 days ago', status: 'sent',   creator: 'A1', createdAt: at(-10, 12), scheduledDate: at(-10, 12), sentAt: null, recipients: 0 },
  ];
}

// ─── Recipients (deterministic, so every run and every agency produces the same numbers) ─────────────
function lcg(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

interface RecipientRow {
  campaignId: string; clientId: string; clientName: string; email: string; status: EmailRecipientStatus;
  sentAt: Date | null; deliveredAt: Date | null; openedAt: Date | null; clickedAt: Date | null; bouncedAt: Date | null;
  errorMessage: string | null;
}
interface DemoClient { id: string; name: string; email: string }

function buildRecipients(campaignId: string, tpl: Tpl, tplIndex: number, clients: DemoClient[]): RecipientRow[] {
  const rand = lcg(1000 + tplIndex);
  const rows: RecipientRow[] = [];
  for (let i = 0; i < tpl.recipients; i++) {
    const c = clients[i % clients.length];
    const base: RecipientRow = {
      campaignId, clientId: c.id, clientName: c.name, email: c.email, status: 'sent',
      sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null, errorMessage: null,
    };
    if (tpl.status === 'failed' || !tpl.sentAt) {
      rows.push({ ...base, status: 'failed', errorMessage: 'Provider rejected the message (demo)' });
      continue;
    }
    const sentAt = addMilliseconds(tpl.sentAt, i * 1500);
    const r = rand();
    if (r < 0.03) { rows.push({ ...base, status: 'failed', errorMessage: 'Invalid address (demo)' }); continue; }
    if (r < 0.08) { rows.push({ ...base, status: 'bounced', sentAt, bouncedAt: addMinutes(sentAt, 2) }); continue; }
    if (r < 0.11) { rows.push({ ...base, status: 'sent', sentAt }); continue; }
    const deliveredAt = addMinutes(sentAt, 1);
    if (rand() < 0.45) {
      const openedAt = addMinutes(deliveredAt, 30 + Math.floor(rand() * 300));
      if (rand() < 0.3) {
        rows.push({ ...base, status: 'clicked', sentAt, deliveredAt, openedAt, clickedAt: addMinutes(openedAt, 5 + Math.floor(rand() * 35)) });
      } else {
        rows.push({ ...base, status: 'opened', sentAt, deliveredAt, openedAt });
      }
    } else {
      rows.push({ ...base, status: 'delivered', sentAt, deliveredAt });
    }
  }
  return rows;
}

/** Same roll-up as services/campaignStats.ts recomputeCampaignStats. */
function statsOf(rows: RecipientRow[]) {
  return {
    statsSent: rows.filter((r) => r.sentAt).length,
    statsDelivered: rows.filter((r) => r.deliveredAt).length,
    statsOpened: rows.filter((r) => r.openedAt).length,
    statsClicked: rows.filter((r) => r.clickedAt).length,
    statsBounced: rows.filter((r) => r.status === 'bounced').length,
    statsFailed: rows.filter((r) => r.status === 'failed').length,
  };
}

// ─── Lead requests that (do / do not) count as conversions ────────────────────────────────────────────
// A conversion = client assigned to an associate in the period (approved request) who received a qualifying
// email strictly BEFORE that assignment. Client indexes refer to the per-agency demo client list; campaign
// recipients are clients [0 .. recipients-1].
interface RequestTpl { key: string; clientIndex: number; requester: CreatorKey; requestedAt: (t: Record<string, Tpl>) => Date; expectConversion: boolean; label: string }
const REQUESTS: RequestTpl[] = [
  { key: 'r-today-0', clientIndex: 0, requester: 'A1', requestedAt: (t) => addMinutes(t.today.sentAt!, 90), expectConversion: true, label: 'emailed today 10:00 by A1, assigned 11:30' },
  { key: 'r-today-1', clientIndex: 1, requester: 'A1', requestedAt: (t) => addMinutes(t.today.sentAt!, 95), expectConversion: true, label: 'emailed today, assigned today' },
  { key: 'r-today-2', clientIndex: 2, requester: 'A1', requestedAt: (t) => addMinutes(t.today.sentAt!, 100), expectConversion: true, label: 'emailed today, assigned today' },
  { key: 'r-d5-5',    clientIndex: 5, requester: 'A2', requestedAt: (t) => addDays(t.d6.sentAt!, 1),  expectConversion: true, label: 'emailed 6 days ago by A2, assigned 5 days ago' },
  { key: 'r-d5-6',    clientIndex: 6, requester: 'A2', requestedAt: (t) => addDays(t.d6.sentAt!, 1),  expectConversion: true, label: 'emailed 6 days ago by A2, assigned 5 days ago' },
  { key: 'r-d28-9',   clientIndex: 9, requester: 'A3', requestedAt: (t) => addDays(t.d30.sentAt!, 2), expectConversion: true, label: 'emailed 30 days ago by A3, assigned 28 days ago' },
  { key: 'r-lm-20',   clientIndex: 20, requester: 'A2', requestedAt: (t) => addDays(t['lm-mid'].sentAt!, 5), expectConversion: true, label: 'emailed mid last month by A2, assigned 5 days later' },
  { key: 'r-lm-21',   clientIndex: 21, requester: 'A2', requestedAt: (t) => addDays(t['lm-mid'].sentAt!, 5), expectConversion: true, label: 'emailed mid last month by A2, assigned 5 days later' },
  // Negative: client #120 is reached only by the 'today' campaign, which was sent AFTER this assignment.
  { key: 'r-neg-120', clientIndex: 120, requester: 'A1', requestedAt: (t) => addDays(t.today.sentAt!, -3), expectConversion: false, label: 'assigned 3 days ago, only emailed today → must NOT count' },
];

// ─── Expected numbers (what the page should show, computed from the definitions above) ───────────────
type Range = { from: Date; to: Date } | null;
function presetRanges(now: Date): Record<string, Range> {
  const lm = subMonths(now, 1);
  return {
    'Today':        { from: startOfDay(now), to: endOfDay(now) },
    'Last 7 Days':  { from: startOfDay(subDays(now, 6)), to: endOfDay(now) },
    'Last 30 Days': { from: startOfDay(subDays(now, 29)), to: endOfDay(now) },
    'This Month':   { from: startOfMonth(now), to: endOfMonth(now) },
    'Last Month':   { from: startOfMonth(lm), to: endOfMonth(lm) },
    'All Time':     null,
  };
}
const inRange = (d: Date | null, r: Range) => !!d && (!r || (d >= r.from && d <= r.to));
const effectiveDate = (t: Tpl): Date => (t.status === 'sent' ? (t.sentAt ?? t.createdAt) : t.status === 'scheduled' ? t.scheduledDate : t.createdAt);
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '0%');
const QUALIFYING: EmailRecipientStatus[] = ['sent', 'delivered', 'opened', 'clicked'];

function printExpectations(now: Date, tpls: Tpl[], recipientsByKey: Record<string, RecipientRow[]>, requestTimes: Record<string, Date>, clientIdsByIndex: string[]) {
  const byKey = Object.fromEntries(tpls.map((t) => [t.key, t]));
  const rows: Record<string, string | number>[] = [];
  for (const [preset, range] of Object.entries(presetRanges(now))) {
    const inP = tpls.filter((t) => inRange(effectiveDate(t), range));
    const sentC = inP.filter((t) => t.status === 'sent');
    const s = sentC.reduce((acc, t) => {
      const st = statsOf(recipientsByKey[t.key] ?? []);
      for (const k of Object.keys(st) as (keyof typeof st)[]) acc[k] += st[k];
      return acc;
    }, { statsSent: 0, statsDelivered: 0, statsOpened: 0, statsClicked: 0, statsBounced: 0, statsFailed: 0 });
    // Card denominator: qualifying recipient rows whose sentAt is in the period (any campaign).
    const emailsSent = Object.values(recipientsByKey).flat().filter((r) => QUALIFYING.includes(r.status) && inRange(r.sentAt, range)).length;
    // Card numerator: requests in the period whose client got a qualifying email strictly before.
    let conversions = 0;
    for (const req of REQUESTS) {
      const at = requestTimes[req.key];
      if (!inRange(at, range)) continue;
      const clientId = clientIdsByIndex[req.clientIndex];
      const before = Object.values(recipientsByKey).flat().some((r) => r.clientId === clientId && QUALIFYING.includes(r.status) && r.sentAt && r.sentAt < at);
      if (before) conversions++;
    }
    rows.push({
      Preset: preset,
      Campaigns: inP.length,
      'Drafts/Sched/Sent/Failed': `${inP.filter((t) => t.status === 'draft').length}/${inP.filter((t) => t.status === 'scheduled').length}/${sentC.length}/${inP.filter((t) => t.status === 'failed').length}`,
      'Delivery': pct(s.statsDelivered, s.statsSent),
      'Open': pct(s.statsOpened, s.statsDelivered),
      'Click': pct(s.statsClicked, s.statsOpened),
      'Bounce': pct(s.statsBounced, s.statsSent),
      'Failed': pct(s.statsFailed, s.statsSent),
      'Card: emails sent': emailsSent,
      'Card: conversions': conversions,
    });
  }
  console.log('\nExpected on the Bulk Mail page for EACH agency (no owner chips selected), as of ' + fmt(now) + ':');
  console.table(rows);

  const perCreator: Record<string, number> = {};
  for (const t of tpls) perCreator[t.creator] = (perCreator[t.creator] ?? 0) + 1;
  console.log('Campaigns per creator (All Time) — pick that person in the Managers / Team chips to see only theirs:');
  console.table(Object.entries(perCreator).map(([creator, n]) => ({ Creator: creator, Campaigns: n, Keys: tpls.filter((t) => t.creator === creator).map((t) => t.key).join(', ') })));
  console.log('Lead requests seeded (conversions on the card):');
  console.table(REQUESTS.map((r) => ({ Requester: r.requester, 'Assigned at': fmt(requestTimes[r.key]), Counts: r.expectConversion ? 'yes' : 'NO', Why: r.label })));
  void byKey;
}

// ─── DB work ──────────────────────────────────────────────────────────────────────────────────────────
async function clean() {
  const req = await prisma.leadRequest.deleteMany({ where: { note: { startsWith: NOTE_PREFIX } } });
  const camp = await prisma.emailCampaign.deleteMany({ where: { listId: LIST_ID } }); // recipients cascade
  const cli = await prisma.client.deleteMany({ where: { corporateCode: { startsWith: CORP_PREFIX } } }); // links + contacts cascade
  console.log(`Removed demo rows: ${req.count} lead requests, ${camp.count} campaigns, ${cli.count} clients`);
}

const WORDS_A = ['Maple', 'Northern', 'Harbour', 'Summit', 'Granite', 'Lakeside', 'Prairie', 'Cedar', 'Beacon', 'Atlas', 'Birch', 'Compass', 'Evergreen'];
const WORDS_B = ['Logistics', 'Dental', 'Construction', 'Foods', 'Software', 'Clinics', 'Staffing', 'Retail', 'Energy', 'Hospitality'];

async function seedAgency(agency: { id: string; name: string }, now: Date, tpls: Tpl[]) {
  const short = agency.name.replace(/^Wudox\s*-\s*/i, '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'AGY';
  const users = await prisma.user.findMany({
    where: { subCompanyId: agency.id, isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  const full = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
  const managers = users.filter((u) => u.role === 'sales_manager' || u.role === 'team_lead');
  const associates = users.filter((u) => u.role === 'sales_associate');
  const byName = (re: RegExp, pool: typeof users) => pool.find((u) => re.test(full(u)));
  if (managers.length === 0 || associates.length === 0) {
    console.warn(`  ! ${agency.name}: needs at least one manager and one associate — skipped`);
    return;
  }
  const creators: Record<CreatorKey, typeof users[number]> = {
    M1: byName(/Manager 1/i, managers) ?? managers[0],
    M2: byName(/Manager 2/i, managers) ?? managers[1] ?? managers[0],
    A1: byName(/M1 Member 1/i, associates) ?? associates[0],
    A2: byName(/M2 Member 1/i, associates) ?? associates[1] ?? associates[0],
    A3: byName(/M3 Member 1/i, associates) ?? associates[2] ?? associates[0],
  };

  // Clients (+ agency link + primary contact)
  const clients: DemoClient[] = Array.from({ length: CLIENTS_PER_AGENCY }, (_, i) => {
    const company = `${WORDS_A[i % WORDS_A.length]} ${WORDS_B[Math.floor(i / WORDS_A.length) % WORDS_B.length]}${i >= WORDS_A.length * WORDS_B.length ? ` ${i}` : ''}`;
    return { id: randomUUID(), name: `[DEMO] ${company} (${short})`, email: `demo.${short.toLowerCase()}.${String(i + 1).padStart(3, '0')}@example.com` };
  });
  await prisma.client.createMany({
    data: clients.map((c, i) => ({
      id: c.id, name: c.name, status: 'contacted', corporateCode: `${CORP_PREFIX}${short}-${String(i + 1).padStart(3, '0')}`,
      industry: WORDS_B[Math.floor(i / WORDS_A.length) % WORDS_B.length], location: short, createdAt: subDays(now, 400),
    })),
  });
  await prisma.clientSubCompany.createMany({ data: clients.map((c) => ({ clientId: c.id, subCompanyId: agency.id, status: 'contacted' })) });
  await prisma.clientContact.createMany({ data: clients.map((c) => ({ clientId: c.id, name: 'Demo Contact', email: c.email, isPrimary: true })) });

  // Campaigns + recipients
  const recipientsByKey: Record<string, RecipientRow[]> = {};
  const campaignRows = tpls.map((t, i) => {
    const id = randomUUID();
    const rows = buildRecipients(id, t, i, clients);
    recipientsByKey[t.key] = rows;
    const st = statsOf(rows);
    return {
      id, subCompanyId: agency.id, name: `[DEMO] ${t.name}`, listId: LIST_ID, listName: LIST_NAME,
      subject: `${t.name} — ${agency.name}`,
      body: `<p>Demo campaign "${t.name}" for ${agency.name}. Seeded for filter verification.</p>`,
      templateId: null, scheduledDate: t.scheduledDate, status: t.status, sentAt: t.sentAt,
      totalRecipients: rows.length, createdAt: t.createdAt, createdById: creators[t.creator].id, ...st,
    };
  });
  await prisma.emailCampaign.createMany({ data: campaignRows });
  const allRecipients = Object.values(recipientsByKey).flat();
  for (let i = 0; i < allRecipients.length; i += 500) {
    await prisma.emailCampaignRecipient.createMany({ data: allRecipients.slice(i, i + 500) });
  }

  // Lead requests (conversions)
  const byKey = Object.fromEntries(tpls.map((t) => [t.key, t]));
  const requestTimes: Record<string, Date> = {};
  await prisma.leadRequest.createMany({
    data: REQUESTS.map((r) => {
      const at = r.requestedAt(byKey);
      requestTimes[r.key] = at;
      return {
        clientId: clients[r.clientIndex].id, requestedById: creators[r.requester].id, managerId: creators.M1.id,
        note: `${NOTE_PREFIX} seeded lead request — ${r.label}`, status: 'approved',
        reviewedById: creators.M1.id, reviewedAt: addHours(at, 1), subCompanyId: agency.id, requestedAt: at,
      };
    }),
  });

  console.log(`  ✓ ${agency.name}: ${clients.length} clients, ${campaignRows.length} campaigns, ${allRecipients.length} recipients, ${REQUESTS.length} lead requests`);
  console.log(`    creators → M1 ${full(creators.M1)} · M2 ${full(creators.M2)} · A1 ${full(creators.A1)} · A2 ${full(creators.A2)} · A3 ${full(creators.A3)}`);
  return { recipientsByKey, requestTimes, clientIds: clients.map((c) => c.id) };
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (!local && !process.argv.includes('--force')) {
    console.error('Refusing: DATABASE_URL is not a local database (pass --force to override).');
    process.exit(2);
  }
  await clean();
  if (process.argv.includes('--clean')) return;

  const now = new Date();
  const tpls = buildTemplates(now);
  const agencies = await prisma.subCompany.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const ownRoles = await prisma.rbacRole.findMany({ where: { isActive: true, scopeLevel: 'own' }, select: { key: true } });
  if (!ownRoles.some((r) => r.key === 'sales_associate')) {
    console.warn('  ! sales_associate is not an own-scope RBAC role here; conversions on the card may read 0.');
  }

  console.log(`Seeding ${agencies.length} agencies…`);
  let sample: Awaited<ReturnType<typeof seedAgency>> | undefined;
  for (const agency of agencies) sample = (await seedAgency(agency, now, tpls)) ?? sample;
  if (sample) printExpectations(now, tpls, sample.recipientsByKey, sample.requestTimes, sample.clientIds);
  console.log('\nRemove everything again with: npx tsx scripts/seed-demo-bulk-emails.ts --clean');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
