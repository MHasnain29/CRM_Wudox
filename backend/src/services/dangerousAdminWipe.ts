/**
 * CRM wipe used by `scripts/wipe-crm-keep-hassan.ts`.
 * Keeps one super-admin user + system scaffolding (agencies, RBAC, settings).
 */

import prisma from '../config/database';

export const DEFAULT_KEEP_EMAIL = 'hassan@wudox.ca';

/** Tables that must stay so login / agencies / RBAC still work. */
export const WIPE_KEEP_TABLES = new Set([
  '_prisma_migrations',
  'users',
  'sub_companies',
  'locations',
  'rbac_roles',
  'rbac_permissions',
  'role_permissions',
  'role_approval_capabilities',
  'agency_approval_policies',
  'org_approval_policies',
  'pipeline_stages',
  'client_visibility_settings',
  'daily_report_settings',
  'idle_time_settings',
  'proposal_default_settings',
  'proposal_awaiting_client_settings',
  'lead_deadline_settings',
  'email_send_window_settings',
  'proposal_default_files',
  'proposal_type_template_mappings',
  'review_templates',
  'review_template_mappings',
  'phone_agency_configs',
  'phone_numbers',
  'hubstaff_configs',
  'signing_authorities',
  'leave_types',
  'ip_restriction_rules',
  'agency_notification_rules',
]);

export type WipePreview = {
  keepEmail: string;
  keepUserId: string | null;
  keepUserFound: boolean;
  users: number;
  clients: number;
  leads: number;
  pendingImports: number;
  otherUsers: number;
  wipeTableCount: number;
};

export type WipeResult = {
  ok: true;
  keepEmail: string;
  deletedUsers: number;
  truncatedTables: number;
  usersAfter: number;
  clientsAfter: number;
  leadsAfter: number;
  pendingImportsAfter: number;
};

async function listPublicTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  return rows.map((r) => r.tablename);
}

export function normalizeKeepEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function previewCrmWipe(keepEmailInput: string): Promise<WipePreview> {
  const keepEmail = normalizeKeepEmail(keepEmailInput);
  const keepUser = await prisma.user.findFirst({
    where: { email: { equals: keepEmail, mode: 'insensitive' } },
    select: { id: true },
  });

  const [users, clients, leads, pendingImports, allTables] = await Promise.all([
    prisma.user.count(),
    prisma.client.count(),
    prisma.lead.count(),
    prisma.pendingImportedClient.count(),
    listPublicTables(),
  ]);

  const wipeTableCount = allTables.filter((t) => !WIPE_KEEP_TABLES.has(t)).length;

  return {
    keepEmail,
    keepUserId: keepUser?.id ?? null,
    keepUserFound: Boolean(keepUser),
    users,
    clients,
    leads,
    pendingImports,
    otherUsers: keepUser ? Math.max(0, users - 1) : users,
    wipeTableCount,
  };
}

/**
 * Truncate business tables, delete every user except keepEmail, reset client serial.
 */
export async function executeCrmWipe(keepEmailInput: string): Promise<WipeResult> {
  const keepEmail = normalizeKeepEmail(keepEmailInput);
  const keepUser = await prisma.user.findFirst({
    where: { email: { equals: keepEmail, mode: 'insensitive' } },
    select: { id: true, email: true },
  });

  if (!keepUser) {
    throw new Error(`Keep user not found: ${keepEmail}`);
  }

  const allTables = await listPublicTables();
  const wipeTables = allTables.filter((t) => !WIPE_KEEP_TABLES.has(t));

  const BATCH = 40;
  for (let i = 0; i < wipeTables.length; i += BATCH) {
    const chunk = wipeTables.slice(i, i + BATCH);
    const list = chunk.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  const deleted = await prisma.user.deleteMany({
    where: { id: { not: keepUser.id } },
  });

  await prisma.user.update({
    where: { id: keepUser.id },
    data: {
      reportingManagerIds: [],
      emailForwardingToUserId: null,
      offboardingStartedAt: null,
    },
  });

  try {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('clients', 'serial_number'), 1, false)`,
    );
  } catch {
    // serial may not exist on older DBs
  }

  const [usersAfter, clientsAfter, leadsAfter, pendingAfter] = await Promise.all([
    prisma.user.count(),
    prisma.client.count(),
    prisma.lead.count(),
    prisma.pendingImportedClient.count(),
  ]);

  // One audit row that survives the wipe (activity_logs was truncated above).
  const agencyId =
    (
      await prisma.user.findUnique({
        where: { id: keepUser.id },
        select: { subCompanyId: true },
      })
    )?.subCompanyId ??
    (await prisma.subCompany.findFirst({ select: { id: true }, orderBy: { name: 'asc' } }))?.id;

  if (agencyId) {
    await prisma.activityLog.create({
      data: {
        userId: keepUser.id,
        userName: keepUser.email,
        subCompanyId: agencyId,
        type: 'dangerous_admin_wipe',
        description: `Danger Zone wipe completed. Kept user ${keepUser.email}. Deleted ${deleted.count} other user(s); truncated ${wipeTables.length} table(s).`,
        metadata: {
          keepEmail: keepUser.email,
          deletedUsers: deleted.count,
          truncatedTables: wipeTables.length,
        },
      },
    });
  }

  return {
    ok: true,
    keepEmail: keepUser.email,
    deletedUsers: deleted.count,
    truncatedTables: wipeTables.length,
    usersAfter,
    clientsAfter,
    leadsAfter,
    pendingImportsAfter: pendingAfter,
  };
}
