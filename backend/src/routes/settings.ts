/**
 * Settings routes: allowed industries, allowed tags, industry/tag requests.
 * Manage (list, add, rename, remove): super_admin, director, operations_manager.
 * Create request: any authenticated user. Approve/reject: super_admin, director, operations_manager.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { requireCallScriptsAccess, requireSettingsWrite } from '../middleware/requireSettingsAccess';
import { ensureAccessContext } from '../utils/requestPermission';
import {
  canAccessMultipleAgencies,
  getUserIdsWithPermissionInAgency,
  hasPermission,
} from '../services/accessContext';
import { dispatchNotification, dispatchNotificationToUser } from '../services/notificationDispatch';
import { sendClientEmail, buildSettingsRequestHtml, buildSettingsApprovedHtml, buildSettingsRejectedHtml, getAgencyBranding, sanitizeRichHtml, invalidateAgencyBrandingCache } from '../services/email';
import { env } from '../config/env';
import { ResourceRequestStatus, Prisma } from '@prisma/client';
import { setIdleThresholdCache } from '../services/activitySession';
import { emitToUsers } from '../socket';
import { uploadToR2 } from '../services/r2Storage';
import {
  flushQueuedEmailsNow,
  getEmailSendWindowSetting,
  recomputeQueuedEmailSchedule,
  upsertEmailSendWindowSetting,
} from '../services/emailSendWindow';
import {
  getSigningAuthorities,
  createSigningAuthority,
  updateSigningAuthority,
  setPrimarySigningAuthority,
  deleteSigningAuthority,
} from '../services/signingAuthority';
import { getActiveRoleKeysByScopeLevels, getRoleDisplayName } from '../services/rbac';
import {
  listMergedAgencyRules,
  previewNotification,
  upsertAgencyNotificationRules,
} from '../services/notificationRuleService';
import { getRegistryEntry } from '../services/notificationRegistry';
import { fetchAllAgencyIds, resolveAgencyScope } from '../config/agencyScope';
import { DEFAULT_BRAND_NAME } from '../config/branding';
import {
  buildSignatureHtmlFromConfig,
  migrateSignatureConfigToV2,
  DEFAULT_SIGNATURE_CONFIG,
  type SignatureConfig,
} from '../services/signatureHtml';

async function getEffectiveSubCompanyId(req: Request): Promise<string | null> {
  return resolveAgencyScope(req);
}

function isDatabaseManager(req: Request): boolean {
  return req.user?.role === 'database_manager';
}

function slugForSyntheticId(prefix: string, value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  return `${prefix}-${slug}`;
}

/** Database Manager global adds have no agency — use first org agency only for request records. */
async function resolveSettingsRequestSubCompanyId(req: Request): Promise<string | null> {
  const scoped = await resolveAgencyScope(req);
  if (scoped) return scoped;
  if (!isDatabaseManager(req)) return null;
  const ids = await fetchAllAgencyIds();
  return ids[0] ?? null;
}

async function buildOrgWideIndustriesResponse() {
  const industryCounts = await prisma.client.groupBy({
    by: ['industry'],
    where: { industry: { not: null } },
    _count: { id: true },
  });
  const names = industryCounts
    .map((row) => (row.industry ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const countMap = new Map<string, number>();
  for (const row of industryCounts) {
    const name = (row.industry ?? '').trim();
    if (name) countMap.set(name, row._count.id);
  }
  const data = names.map((name) => ({
    id: slugForSyntheticId('org-industry', name),
    name,
    count: countMap.get(name) ?? 0,
  }));
  const totalCount = data.reduce((s, i) => s + i.count, 0);
  return { data, totalCount };
}

async function buildOrgWideJobTitlesResponse() {
  const titleCounts = await prisma.clientContact.groupBy({
    by: ['title'],
    where: { title: { not: null } },
    _count: { id: true },
  });
  const names = titleCounts
    .map((row) => (row.title ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const countMap = new Map<string, number>();
  for (const row of titleCounts) {
    const name = (row.title ?? '').trim();
    if (name) countMap.set(name, row._count.id);
  }
  const data = names.map((name) => ({
    id: slugForSyntheticId('org-job-title', name),
    name,
    count: countMap.get(name) ?? 0,
  }));
  const totalCount = data.reduce((s, j) => s + j.count, 0);
  return { data, totalCount };
}

async function buildOrgWideTagsResponse() {
  const tagCounts = await prisma.clientTag.groupBy({
    by: ['tag'],
    _count: { clientId: true },
  });
  const names = tagCounts
    .map((row) => row.tag.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const countMap = new Map<string, number>();
  for (const row of tagCounts) {
    const tag = row.tag.trim();
    if (tag) countMap.set(tag, row._count.clientId);
  }
  const data = names.map((tag) => ({
    id: slugForSyntheticId('org-tag', tag),
    tag,
    count: countMap.get(tag) ?? 0,
  }));
  const totalCount = data.reduce((s, t) => s + t.count, 0);
  return { data, totalCount };
}

/** Users who can approve settings requests (settings:write), for notifications. */
async function canSeeCrossAgencySettings(req: Request): Promise<boolean> {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return false;
  return hasPermission(ctx, 'settings:write') && canAccessMultipleAgencies(ctx);
}

async function getAdminUsers(subCompanyId?: string): Promise<{ id: string; subCompanyId: string | null; email: string; firstName: string }[]> {
  if (!subCompanyId) return [];
  const ids = await getUserIdsWithPermissionInAgency(subCompanyId, 'settings:write');
  if (ids.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, subCompanyId: true, email: true, firstName: true },
  });
}

export const settingsRouter = Router();
settingsRouter.use(authenticate);

// ——— Client Visibility Delay (Director/Super Admin) ———
settingsRouter.get(
  '/client-visibility',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const row = await prisma.clientVisibilitySetting.findUnique({
      where: { subCompanyId },
      select: { days: true, updatedAt: true },
    });
    if (!row) return res.json({ days: 7 });
    return res.json({ days: row.days, updatedAt: row.updatedAt });
  }
);

settingsRouter.put(
  '/client-visibility',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = z.object({ days: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const updated = await prisma.clientVisibilitySetting.upsert({
      where: { subCompanyId },
      create: { subCompanyId, days: parsed.data.days },
      update: { days: parsed.data.days },
      select: { days: true, updatedAt: true },
    });

    if (parsed.data.days === 0) {
      await prisma.client.updateMany({
        where: {
          visibility: 'agency',
          clientSubCompanies: { some: { subCompanyId } },
        },
        data: {
          visibility: 'global',
          visibilityPromotedAt: new Date(),
        },
      });
    }

    return res.json(updated);
  }
);

// ——— Allowed Industries ———
settingsRouter.get('/industries', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    if (isDatabaseManager(req)) {
      return res.json(await buildOrgWideIndustriesResponse());
    }
    return res.status(403).json({ error: 'Agency context required' });
  }
  const list = await prisma.allowedIndustry.findMany({
    where: { subCompanyId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const industryCounts = await prisma.client.groupBy({
    by: ['industry'],
    where: { industry: { not: null } },
    _count: { id: true },
  });
  const countMap = new Map<string, number>();
  for (const row of industryCounts) {
    const name = (row.industry ?? '').trim();
    if (name) countMap.set(name, (countMap.get(name) ?? 0) + row._count.id);
  }
  const data = list.map((i) => ({ id: i.id, name: i.name, count: countMap.get(i.name) ?? 0 }));
  const totalCount = data.reduce((s, i) => s + i.count, 0);
  return res.json({ data, totalCount });
});

settingsRouter.post('/industries', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existing = await prisma.allowedIndustry.findUnique({
    where: { subCompanyId_name: { subCompanyId, name } },
  });
  if (existing) {
    return res.status(409).json({ error: 'Industry already exists' });
  }
  const created = await prisma.allowedIndustry.create({
    data: { subCompanyId, name },
  });
  return res.status(201).json(created);
});

settingsRouter.patch('/industries/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existing = await prisma.allowedIndustry.findFirst({
    where: { id: req.params.id, subCompanyId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Industry not found' });
  }
  const updated = await prisma.allowedIndustry.update({
    where: { id: req.params.id },
    data: { name },
  });
  return res.json(updated);
});

settingsRouter.delete('/industries/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const existing = await prisma.allowedIndustry.findFirst({
    where: { id: req.params.id, subCompanyId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Industry not found' });
  }
  await prisma.allowedIndustry.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

// ——— Allowed Tags ———
settingsRouter.get('/tags', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    if (isDatabaseManager(req)) {
      return res.json(await buildOrgWideTagsResponse());
    }
    return res.status(403).json({ error: 'Agency context required' });
  }
  const list = await prisma.allowedTag.findMany({
    where: { subCompanyId },
    orderBy: { tag: 'asc' },
    select: { id: true, tag: true },
  });
  const tagCounts = await prisma.clientTag.groupBy({
    by: ['tag'],
    where: { subCompanyId },
    _count: { clientId: true },
  });
  const countMap = new Map<string, number>();
  for (const row of tagCounts) {
    countMap.set(row.tag, (countMap.get(row.tag) ?? 0) + row._count.clientId);
  }
  const data = list.map((t) => ({ id: t.id, tag: t.tag, count: countMap.get(t.tag) ?? 0 }));
  const totalCount = data.reduce((s, t) => s + t.count, 0);
  return res.json({ data, totalCount });
});

settingsRouter.post('/tags', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = z.object({ tag: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid tag' });
  }
  const tag = parsed.data.tag.trim();
  const existing = await prisma.allowedTag.findUnique({
    where: { subCompanyId_tag: { subCompanyId, tag } },
  });
  if (existing) {
    return res.status(409).json({ error: 'Tag already exists' });
  }
  const created = await prisma.allowedTag.create({
    data: { subCompanyId, tag },
  });
  return res.status(201).json(created);
});

settingsRouter.patch('/tags/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = z.object({ tag: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid tag' });
  }
  const tag = parsed.data.tag.trim();
  const existing = await prisma.allowedTag.findFirst({
    where: { id: req.params.id, subCompanyId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  await prisma.clientTag.updateMany({
    where: { subCompanyId, tag: existing.tag },
    data: { tag },
  });
  const updated = await prisma.allowedTag.update({
    where: { id: req.params.id },
    data: { tag },
  });
  return res.json(updated);
});

settingsRouter.delete('/tags/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const existing = await prisma.allowedTag.findFirst({
    where: { id: req.params.id, subCompanyId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  await prisma.clientTag.deleteMany({ where: { subCompanyId, tag: existing.tag } });
  await prisma.allowedTag.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

// ——— Industry Requests ———
settingsRouter.get('/industry-requests/pending-count', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const canSeeAll = await canSeeCrossAgencySettings(req);
  const where = canSeeAll
    ? { status: 'pending' as ResourceRequestStatus }
    : { subCompanyId, status: 'pending' as ResourceRequestStatus };
  const count = await prisma.industryRequest.count({ where });
  return res.json({ count });
});

settingsRouter.get('/industry-requests', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const canSeeAll = await canSeeCrossAgencySettings(req);
  const where = canSeeAll ? {} : { subCompanyId };
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    (where as { status?: ResourceRequestStatus }).status = status as ResourceRequestStatus;
  }
  const list = await prisma.industryRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      subCompany: { select: { name: true } },
    },
  });
  return res.json({ data: list });
});

settingsRouter.post('/industry-requests', async (req: Request, res: Response) => {
  const subCompanyId = await resolveSettingsRequestSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existingAllowed = await prisma.allowedIndustry.findUnique({
    where: { subCompanyId_name: { subCompanyId, name } },
  });
  if (existingAllowed) {
    return res.status(409).json({ error: 'Industry already in list' });
  }
  const existingRequest = await prisma.industryRequest.findFirst({
    where: { subCompanyId, requestedById: userId, name, status: 'pending' },
  });
  if (existingRequest) {
    return res.status(409).json({ error: 'Request already pending' });
  }
  const request = await prisma.industryRequest.create({
    data: { subCompanyId, requestedById: userId, name, status: 'pending' },
    include: {
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
      subCompany: { select: { name: true } },
    },
  });
  const requesterName = `${request.requestedBy.firstName} ${request.requestedBy.lastName}`.trim();
  const settingsUrl = env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : '';
  const link = settingsUrl ? `${settingsUrl}?tab=requests` : undefined;
  const admins = await getAdminUsers();
  if (admins.length > 0) {
    await dispatchNotification({
      eventKey: 'industry_requested',
      userIds: admins.map((a) => a.id),
      subCompanyId,
      context: { actorName: requesterName, itemName: name },
      link,
      relatedId: request.id,
    });
  }
  if (admins.length > 0) {
    const agency = await getAgencyBranding(subCompanyId);
    const body = `${requesterName} requested a new industry: ${name}`;
    await sendClientEmail({
      to: admins.map((a) => ({ email: a.email, name: a.firstName })),
      from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
      subject: 'New industry request: ' + name,
      text: `${body}${settingsUrl ? `\n\nReview in Settings: ${settingsUrl}` : ''}`,
      html: buildSettingsRequestHtml({ headerColor: '#6d28d9', headerIcon: '🏭', headerTitle: 'New Industry Request', type: 'industry', itemName: name, requesterName, agencyName: request.subCompany.name, settingsUrl: settingsUrl ? `${settingsUrl}?tab=requests` : undefined, agency }),
    });
  }
  return res.status(201).json(request);
});

settingsRouter.patch('/industry-requests/:id/approve', requireSettingsWrite, async (req: Request, res: Response) => {
  const decidedById = req.user?.sub;
  if (!decidedById) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const ir = await prisma.industryRequest.findUnique({
    where: { id: req.params.id },
    include: { requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, subCompanyId: true } } },
  });
  if (!ir || ir.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already decided' });
  }
  await prisma.allowedIndustry.upsert({
    where: { subCompanyId_name: { subCompanyId: ir.subCompanyId, name: ir.name } },
    create: { subCompanyId: ir.subCompanyId, name: ir.name },
    update: {},
  });
  await prisma.industryRequest.update({
    where: { id: req.params.id },
    data: { status: 'approved', decidedById, decidedAt: new Date() },
  });
  const requesterName = `${ir.requestedBy.firstName} ${ir.requestedBy.lastName}`.trim();
  await dispatchNotificationToUser({
    userId: ir.requestedById,
    subCompanyId: ir.subCompanyId,
    eventKey: 'industry_request_approved',
    context: { itemName: ir.name },
    link: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined,
    relatedId: ir.id,
  });
  const agency = await getAgencyBranding(ir.subCompanyId);
  await sendClientEmail({
    to: [{ email: ir.requestedBy.email, name: requesterName }],
    from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
    subject: `Industry request approved: ${ir.name}`,
    text: `Your request to add industry "${ir.name}" was approved. You can now use it when adding clients.`,
    html: buildSettingsApprovedHtml({ toName: requesterName.split(' ')[0], type: 'industry', itemName: ir.name, settingsUrl: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined, agency }),
  });
  return res.json({ status: 'approved' });
});

settingsRouter.patch('/industry-requests/:id/reject', requireSettingsWrite, async (req: Request, res: Response) => {
  const decidedById = req.user?.sub;
  if (!decidedById) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const ir = await prisma.industryRequest.findUnique({
    where: { id: req.params.id },
    include: { requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, subCompanyId: true } } },
  });
  if (!ir || ir.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already decided' });
  }
  await prisma.industryRequest.update({
    where: { id: req.params.id },
    data: { status: 'rejected', decidedById, decidedAt: new Date() },
  });
  const requesterName = `${ir.requestedBy.firstName} ${ir.requestedBy.lastName}`.trim();
  await dispatchNotificationToUser({
    userId: ir.requestedById,
    subCompanyId: ir.subCompanyId,
    eventKey: 'industry_request_rejected',
    context: { itemName: ir.name },
    link: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined,
    relatedId: ir.id,
  });
  const agency = await getAgencyBranding(ir.subCompanyId);
  await sendClientEmail({
    to: [{ email: ir.requestedBy.email, name: requesterName }],
    from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
    subject: `Industry request rejected: ${ir.name}`,
    text: `Your request to add industry "${ir.name}" was rejected. Contact an administrator if you have questions.`,
    html: buildSettingsRejectedHtml({ toName: requesterName.split(' ')[0], type: 'industry', itemName: ir.name, settingsUrl: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined, agency }),
  });
  return res.json({ status: 'rejected' });
});

// ——— Tag Requests (same pattern) ———
settingsRouter.get('/tag-requests/pending-count', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const canSeeAll = await canSeeCrossAgencySettings(req);
  const where = canSeeAll
    ? { status: 'pending' as ResourceRequestStatus }
    : { subCompanyId, status: 'pending' as ResourceRequestStatus };
  const count = await prisma.tagRequest.count({ where });
  return res.json({ count });
});

settingsRouter.get('/tag-requests', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const canSeeAll = await canSeeCrossAgencySettings(req);
  const where = canSeeAll ? {} : { subCompanyId };
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    (where as { status?: ResourceRequestStatus }).status = status as ResourceRequestStatus;
  }
  const list = await prisma.tagRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      subCompany: { select: { name: true } },
    },
  });
  return res.json({ data: list });
});

settingsRouter.post('/tag-requests', async (req: Request, res: Response) => {
  const subCompanyId = await resolveSettingsRequestSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existingAllowed = await prisma.allowedTag.findUnique({
    where: { subCompanyId_tag: { subCompanyId, tag: name } },
  });
  if (existingAllowed) {
    return res.status(409).json({ error: 'Tag already in list' });
  }
  const existingRequest = await prisma.tagRequest.findFirst({
    where: { subCompanyId, requestedById: userId, name, status: 'pending' },
  });
  if (existingRequest) {
    return res.status(409).json({ error: 'Request already pending' });
  }
  const request = await prisma.tagRequest.create({
    data: { subCompanyId, requestedById: userId, name, status: 'pending' },
    include: {
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
      subCompany: { select: { name: true } },
    },
  });
  const requesterName = `${request.requestedBy.firstName} ${request.requestedBy.lastName}`.trim();
  const settingsUrl = env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : '';
  const link = settingsUrl ? `${settingsUrl}?tab=requests` : undefined;
  const admins = await getAdminUsers();
  if (admins.length > 0) {
    await dispatchNotification({
      eventKey: 'tag_requested',
      userIds: admins.map((a) => a.id),
      subCompanyId,
      context: { actorName: requesterName, itemName: name },
      link,
      relatedId: request.id,
    });
  }
  if (admins.length > 0) {
    const agency = await getAgencyBranding(subCompanyId);
    const body = `${requesterName} requested a new tag: ${name}`;
    await sendClientEmail({
      to: admins.map((a) => ({ email: a.email, name: a.firstName })),
      from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
      subject: `New tag request: ${name}`,
      text: `${body}${settingsUrl ? `\n\nReview in Settings: ${settingsUrl}` : ''}`,
      html: buildSettingsRequestHtml({ headerColor: '#b45309', headerIcon: '🏷️', headerTitle: 'New Tag Request', type: 'tag', itemName: name, requesterName, agencyName: request.subCompany.name, settingsUrl: settingsUrl ? `${settingsUrl}?tab=requests` : undefined, agency }),
    });
  }
  return res.status(201).json(request);
});

settingsRouter.patch('/tag-requests/:id/approve', requireSettingsWrite, async (req: Request, res: Response) => {
  const decidedById = req.user?.sub;
  if (!decidedById) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const tr = await prisma.tagRequest.findUnique({
    where: { id: req.params.id },
    include: { requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, subCompanyId: true } } },
  });
  if (!tr || tr.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already decided' });
  }
  await prisma.allowedTag.upsert({
    where: { subCompanyId_tag: { subCompanyId: tr.subCompanyId, tag: tr.name } },
    create: { subCompanyId: tr.subCompanyId, tag: tr.name },
    update: {},
  });
  await prisma.tagRequest.update({
    where: { id: req.params.id },
    data: { status: 'approved', decidedById, decidedAt: new Date() },
  });
  const requesterName = `${tr.requestedBy.firstName} ${tr.requestedBy.lastName}`.trim();
  await dispatchNotificationToUser({
    userId: tr.requestedById,
    subCompanyId: tr.subCompanyId,
    eventKey: 'tag_request_approved',
    context: { itemName: tr.name },
    link: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined,
    relatedId: tr.id,
  });
  const agency = await getAgencyBranding(tr.subCompanyId);
  await sendClientEmail({
    to: [{ email: tr.requestedBy.email, name: requesterName }],
    from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
    subject: `Tag request approved: ${tr.name}`,
    text: `Your request to add tag "${tr.name}" was approved.`,
    html: buildSettingsApprovedHtml({ toName: requesterName.split(' ')[0], type: 'tag', itemName: tr.name, settingsUrl: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined, agency }),
  });
  return res.json({ status: 'approved' });
});

settingsRouter.patch('/tag-requests/:id/reject', requireSettingsWrite, async (req: Request, res: Response) => {
  const decidedById = req.user?.sub;
  if (!decidedById) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const tr = await prisma.tagRequest.findUnique({
    where: { id: req.params.id },
    include: { requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, subCompanyId: true } } },
  });
  if (!tr || tr.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already decided' });
  }
  await prisma.tagRequest.update({
    where: { id: req.params.id },
    data: { status: 'rejected', decidedById, decidedAt: new Date() },
  });
  const requesterName = `${tr.requestedBy.firstName} ${tr.requestedBy.lastName}`.trim();
  await dispatchNotificationToUser({
    userId: tr.requestedById,
    subCompanyId: tr.subCompanyId,
    eventKey: 'tag_request_rejected',
    context: { itemName: tr.name },
    link: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined,
    relatedId: tr.id,
  });
  const agency = await getAgencyBranding(tr.subCompanyId);
  await sendClientEmail({
    to: [{ email: tr.requestedBy.email, name: requesterName }],
    from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
    subject: `Tag request rejected: ${tr.name}`,
    text: `Your request to add tag "${tr.name}" was rejected.`,
    html: buildSettingsRejectedHtml({ toName: requesterName.split(' ')[0], type: 'tag', itemName: tr.name, settingsUrl: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined, agency }),
  });
  return res.json({ status: 'rejected' });
});

// ——— Allowed Job Titles ———
settingsRouter.get('/job-titles', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    if (isDatabaseManager(req)) {
      return res.json(await buildOrgWideJobTitlesResponse());
    }
    return res.status(403).json({ error: 'Agency context required' });
  }
  const list = await prisma.allowedJobTitle.findMany({
    where: { subCompanyId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const titleCounts = await prisma.clientContact.groupBy({
    by: ['title'],
    where: { title: { not: null } },
    _count: { id: true },
  });
  const countMap = new Map<string, number>();
  for (const row of titleCounts) {
    const name = (row.title ?? '').trim();
    if (name) countMap.set(name, (countMap.get(name) ?? 0) + row._count.id);
  }
  const data = list.map((j) => ({ id: j.id, name: j.name, count: countMap.get(j.name) ?? 0 }));
  const totalCount = data.reduce((s, j) => s + j.count, 0);
  return res.json({ data, totalCount });
});

settingsRouter.post('/job-titles', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existing = await prisma.allowedJobTitle.findUnique({
    where: { subCompanyId_name: { subCompanyId, name } },
  });
  if (existing) {
    return res.status(409).json({ error: 'Job title already exists' });
  }
  const created = await prisma.allowedJobTitle.create({
    data: { subCompanyId, name },
  });
  return res.status(201).json(created);
});

settingsRouter.patch('/job-titles/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existing = await prisma.allowedJobTitle.findFirst({
    where: { id: req.params.id, subCompanyId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Job title not found' });
  }
  const updated = await prisma.allowedJobTitle.update({
    where: { id: req.params.id },
    data: { name },
  });
  return res.json(updated);
});

settingsRouter.delete('/job-titles/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const existing = await prisma.allowedJobTitle.findFirst({
    where: { id: req.params.id, subCompanyId },
  });
  if (!existing) {
    return res.status(404).json({ error: 'Job title not found' });
  }
  await prisma.allowedJobTitle.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

/** POST /settings/sync-from-clients — populate allowed industries, tags, job titles from current client data for this agency. */
settingsRouter.post('/sync-from-clients', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const clientIdsInAgency = await prisma.clientSubCompany
    .findMany({ where: { subCompanyId }, select: { clientId: true } })
    .then((rows) => rows.map((r) => r.clientId));

  const [industries, clientTags, titles] = await Promise.all([
    prisma.client.findMany({
      distinct: ['industry'],
      select: { industry: true },
      where: { id: { in: clientIdsInAgency }, industry: { not: null } },
    }),
    prisma.clientTag.findMany({
      where: { subCompanyId },
      distinct: ['tag'],
      select: { tag: true },
    }),
    prisma.clientContact.findMany({
      distinct: ['title'],
      select: { title: true },
      where: { clientId: { in: clientIdsInAgency }, title: { not: null } },
    }),
  ]);

  const industryNames = new Set(industries.map((r) => (r.industry ?? '').trim()).filter(Boolean));
  const tagNames = new Set(clientTags.map((r) => r.tag.trim()).filter(Boolean));
  const jobTitleNames = new Set(titles.map((r) => (r.title ?? '').trim()).filter(Boolean));

  const defaultIndustries = ['Technology', 'Healthcare', 'Finance', 'Manufacturing', 'Retail', 'Construction', 'Professional Services', 'Other'];
  const defaultTags = [
    'High Priority',
    'Follow-up',
    'Hot Lead',
    'Key Account',
    'Prospect',
    'VIP',
    'Decision Maker',
    'Champion',
    'New Lead',
    'Nurture',
    'At Risk',
    'Contract',
    'Temp',
    'Inactive',
    'Closed Won',
    'Do Not Contact',
  ];
  const defaultJobTitles = ['CEO', 'President', 'Director', 'Manager', 'HR Manager', 'Recruiter', 'Other'];
  defaultIndustries.forEach((n) => industryNames.add(n));
  defaultTags.forEach((t) => tagNames.add(t));
  defaultJobTitles.forEach((n) => jobTitleNames.add(n));

  const agencyExists = await prisma.subCompany.findUnique({ where: { id: subCompanyId }, select: { id: true } });
  if (!agencyExists) {
    return res.status(400).json({ error: 'Agency not found' });
  }

  await Promise.all([
    ...Array.from(industryNames).map((name) =>
      prisma.allowedIndustry.upsert({
        where: { subCompanyId_name: { subCompanyId, name } },
        create: { subCompanyId, name },
        update: {},
      })
    ),
    ...Array.from(tagNames).map((tag) =>
      prisma.allowedTag.upsert({
        where: { subCompanyId_tag: { subCompanyId, tag } },
        create: { subCompanyId, tag },
        update: {},
      })
    ),
    ...Array.from(jobTitleNames).map((name) =>
      prisma.allowedJobTitle.upsert({
        where: { subCompanyId_name: { subCompanyId, name } },
        create: { subCompanyId, name },
        update: {},
      })
    ),
  ]);

  return res.json({
    industriesAdded: industryNames.size,
    tagsAdded: tagNames.size,
    jobTitlesAdded: jobTitleNames.size,
  });
});

// ——— Job Title Requests ———
settingsRouter.get('/job-title-requests/pending-count', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const canSeeAll = await canSeeCrossAgencySettings(req);
  const where = canSeeAll
    ? { status: 'pending' as ResourceRequestStatus }
    : { subCompanyId, status: 'pending' as ResourceRequestStatus };
  const count = await prisma.jobTitleRequest.count({ where });
  return res.json({ count });
});

settingsRouter.get('/job-title-requests', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const canSeeAll = await canSeeCrossAgencySettings(req);
  const where = canSeeAll ? {} : { subCompanyId };
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    (where as { status?: ResourceRequestStatus }).status = status as ResourceRequestStatus;
  }
  const list = await prisma.jobTitleRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      subCompany: { select: { name: true } },
    },
  });
  return res.json({ data: list });
});

settingsRouter.post('/job-title-requests', async (req: Request, res: Response) => {
  const subCompanyId = await resolveSettingsRequestSubCompanyId(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  const name = parsed.data.name.trim();
  const existingAllowed = await prisma.allowedJobTitle.findUnique({
    where: { subCompanyId_name: { subCompanyId, name } },
  });
  if (existingAllowed) {
    return res.status(409).json({ error: 'Job title already in list' });
  }
  const existingRequest = await prisma.jobTitleRequest.findFirst({
    where: { subCompanyId, requestedById: userId, name, status: 'pending' },
  });
  if (existingRequest) {
    return res.status(409).json({ error: 'Request already pending' });
  }
  const request = await prisma.jobTitleRequest.create({
    data: { subCompanyId, requestedById: userId, name, status: 'pending' },
    include: {
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
      subCompany: { select: { name: true } },
    },
  });
  const requesterName = `${request.requestedBy.firstName} ${request.requestedBy.lastName}`.trim();
  const settingsUrl = env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : '';
  const link = settingsUrl ? `${settingsUrl}?tab=requests` : undefined;
  const admins = await getAdminUsers();
  if (admins.length > 0) {
    await dispatchNotification({
      eventKey: 'job_title_requested',
      userIds: admins.map((a) => a.id),
      subCompanyId,
      context: { actorName: requesterName, itemName: name },
      link,
      relatedId: request.id,
    });
  }
  if (admins.length > 0) {
    const agency = await getAgencyBranding(subCompanyId);
    const body = `${requesterName} requested a new job title: ${name}`;
    await sendClientEmail({
      to: admins.map((a) => ({ email: a.email, name: a.firstName })),
      from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
      subject: `New job title request: ${name}`,
      text: `${body}${settingsUrl ? `\n\nReview in Settings: ${settingsUrl}` : ''}`,
      html: buildSettingsRequestHtml({ headerColor: '#0e7490', headerIcon: '💼', headerTitle: 'New Job Title Request', type: 'job title', itemName: name, requesterName, agencyName: request.subCompany.name, settingsUrl: settingsUrl ? `${settingsUrl}?tab=requests` : undefined, agency }),
    });
  }
  return res.status(201).json(request);
});

settingsRouter.patch('/job-title-requests/:id/approve', requireSettingsWrite, async (req: Request, res: Response) => {
  const decidedById = req.user?.sub;
  if (!decidedById) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const jr = await prisma.jobTitleRequest.findUnique({
    where: { id: req.params.id },
    include: { requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, subCompanyId: true } } },
  });
  if (!jr || jr.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already decided' });
  }
  await prisma.allowedJobTitle.upsert({
    where: { subCompanyId_name: { subCompanyId: jr.subCompanyId, name: jr.name } },
    create: { subCompanyId: jr.subCompanyId, name: jr.name },
    update: {},
  });
  await prisma.jobTitleRequest.update({
    where: { id: req.params.id },
    data: { status: 'approved', decidedById, decidedAt: new Date() },
  });
  const requesterName = `${jr.requestedBy.firstName} ${jr.requestedBy.lastName}`.trim();
  await dispatchNotificationToUser({
    userId: jr.requestedById,
    subCompanyId: jr.subCompanyId,
    eventKey: 'job_title_request_approved',
    context: { itemName: jr.name },
    link: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined,
    relatedId: jr.id,
  });
  const agency = await getAgencyBranding(jr.subCompanyId);
  await sendClientEmail({
    to: [{ email: jr.requestedBy.email, name: requesterName }],
    from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
    subject: `Job title request approved: ${jr.name}`,
    text: `Your request to add job title "${jr.name}" was approved. You can now use it for contacts.`,
    html: buildSettingsApprovedHtml({ toName: requesterName.split(' ')[0], type: 'job title', itemName: jr.name, settingsUrl: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined, agency }),
  });
  return res.json({ status: 'approved' });
});

settingsRouter.patch('/job-title-requests/:id/reject', requireSettingsWrite, async (req: Request, res: Response) => {
  const decidedById = req.user?.sub;
  if (!decidedById) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const jr = await prisma.jobTitleRequest.findUnique({
    where: { id: req.params.id },
    include: { requestedBy: { select: { id: true, firstName: true, lastName: true, email: true, subCompanyId: true } } },
  });
  if (!jr || jr.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already decided' });
  }
  await prisma.jobTitleRequest.update({
    where: { id: req.params.id },
    data: { status: 'rejected', decidedById, decidedAt: new Date() },
  });
  const requesterName = `${jr.requestedBy.firstName} ${jr.requestedBy.lastName}`.trim();
  await dispatchNotificationToUser({
    userId: jr.requestedById,
    subCompanyId: jr.subCompanyId,
    eventKey: 'job_title_request_rejected',
    context: { itemName: jr.name },
    link: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined,
    relatedId: jr.id,
  });
  const agency = await getAgencyBranding(jr.subCompanyId);
  await sendClientEmail({
    to: [{ email: jr.requestedBy.email, name: requesterName }],
    from: { email: agency?.emailFromAddress || '', name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME },
    subject: `Job title request rejected: ${jr.name}`,
    text: `Your request to add job title "${jr.name}" was rejected.`,
    html: buildSettingsRejectedHtml({ toName: requesterName.split(' ')[0], type: 'job title', itemName: jr.name, settingsUrl: env.FRONTEND_URL ? `${env.FRONTEND_URL}/settings` : undefined, agency }),
  });
  return res.json({ status: 'rejected' });
});

// ——— Bug report email recipients (super_admin only) ———
settingsRouter.get('/bug-report-recipients', requireSettingsWrite, async (_req: Request, res: Response) => {
  const list = await prisma.bugReportRecipient.findMany({
    orderBy: { email: 'asc' },
    select: { id: true, email: true, createdAt: true },
  });
  return res.json({ data: list });
});

settingsRouter.post('/bug-report-recipients', requireSettingsWrite, async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email().max(255) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.bugReportRecipient.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already in list' });
  }
  const created = await prisma.bugReportRecipient.create({ data: { email } });
  return res.status(201).json(created);
});

settingsRouter.delete('/bug-report-recipients/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  await prisma.bugReportRecipient.deleteMany({ where: { id: req.params.id } });
  return res.status(204).send();
});

// ─── Daily Report Email Settings ────────────────────────────────────────────

// ——— Idle Time Threshold ———

/** GET /settings/idle-time — get idle time threshold for current user's agency (any authenticated user) */
settingsRouter.get('/idle-time', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId ?? null;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const setting = await prisma.idleTimeSetting.findUnique({
    where: { subCompanyId },
  });

  return res.json({
    thresholdMinutes: setting?.thresholdMinutes ?? 5,
  });
});

const idleTimeSchema = z.object({
  thresholdMinutes: z.number().int().min(1).max(60),
});

/** PUT /settings/idle-time — update idle time threshold (director/super_admin/ops_manager only) */
settingsRouter.put('/idle-time', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = idleTimeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const setting = await prisma.idleTimeSetting.upsert({
    where: { subCompanyId },
    update: { thresholdMinutes: parsed.data.thresholdMinutes },
    create: { subCompanyId, thresholdMinutes: parsed.data.thresholdMinutes },
  });

  // Push new value to Redis immediately — all server instances pick it up on next heartbeat
  await setIdleThresholdCache(subCompanyId, setting.thresholdMinutes);

  return res.json({
    thresholdMinutes: setting.thresholdMinutes,
  });
});

/** GET /settings/daily-report — get daily report email settings for current agency */
settingsRouter.get('/daily-report', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const setting = await prisma.dailyReportSetting.findUnique({
    where: { subCompanyId },
  });

  return res.json({
    enabled: setting?.enabled ?? false,
    sendHour: setting?.sendHour ?? 18,
    sendMinute: setting?.sendMinute ?? 0,
    timezone: setting?.timezone ?? 'America/Toronto',
    shiftHours: setting?.shiftHours ?? 8,
  });
});

const dailyReportSchema = z.object({
  enabled: z.boolean().optional(),
  sendHour: z.number().int().min(0).max(23).optional(),
  sendMinute: z.number().int().min(0).max(59).optional(),
  timezone: z.string().min(1).max(100).optional(),
  shiftHours: z.number().int().min(1).max(24).optional(),
});

/** PATCH /settings/daily-report — update daily report email settings */
settingsRouter.patch('/daily-report', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = dailyReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  // Validate timezone is a real IANA timezone
  if (parsed.data.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timezone });
    } catch {
      return res.status(400).json({ error: 'Invalid timezone' });
    }
  }

  const updated = await prisma.dailyReportSetting.upsert({
    where: { subCompanyId },
    create: {
      subCompanyId,
      enabled: parsed.data.enabled ?? false,
      sendHour: parsed.data.sendHour ?? 18,
      sendMinute: parsed.data.sendMinute ?? 0,
      timezone: parsed.data.timezone ?? 'America/Toronto',
      shiftHours: parsed.data.shiftHours ?? 8,
    },
    update: parsed.data,
  });

  return res.json({
    enabled: updated.enabled,
    sendHour: updated.sendHour,
    sendMinute: updated.sendMinute,
    timezone: updated.timezone,
    shiftHours: updated.shiftHours,
  });
});

// ─── Email Send Window (cutoff/start time) ──────────────────────────────────────

const emailSendWindowSchema = z.object({
  enabled: z.boolean(),
  startMinuteOfDay: z.number().int().min(0).max(1439).nullable(),
  cutoffMinuteOfDay: z.number().int().min(0).max(1439).nullable(),
  timezone: z.string().min(1).max(100).optional(),
});

settingsRouter.get('/email-send-window', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const row = await getEmailSendWindowSetting(subCompanyId);
  if (!row) {
    return res.json({
      enabled: false,
      startMinuteOfDay: null,
      cutoffMinuteOfDay: null,
      timezone: 'America/Toronto',
    });
  }
  return res.json({
    enabled: row.enabled,
    startMinuteOfDay: row.startMinuteOfDay,
    cutoffMinuteOfDay: row.cutoffMinuteOfDay,
    timezone: row.timezone,
  });
});

settingsRouter.put('/email-send-window', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = emailSendWindowSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const { enabled, startMinuteOfDay, cutoffMinuteOfDay } = parsed.data;
  if (enabled) {
    if (startMinuteOfDay == null || cutoffMinuteOfDay == null) {
      return res.status(400).json({ error: 'startMinuteOfDay and cutoffMinuteOfDay are required when enabled' });
    }
    if (startMinuteOfDay >= cutoffMinuteOfDay) {
      return res.status(400).json({ error: 'Start time must be before cutoff time (overnight windows are not supported)' });
    }
  } else if ((startMinuteOfDay == null) !== (cutoffMinuteOfDay == null)) {
    return res.status(400).json({ error: 'startMinuteOfDay and cutoffMinuteOfDay must be set together' });
  }

  const timezone = parsed.data.timezone ?? 'America/Toronto';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return res.status(400).json({ error: 'Invalid timezone' });
  }

  const updated = await upsertEmailSendWindowSetting({
    subCompanyId,
    enabled,
    startMinuteOfDay: enabled ? startMinuteOfDay : null,
    cutoffMinuteOfDay: enabled ? cutoffMinuteOfDay : null,
    timezone,
  });

  if (!enabled) {
    await flushQueuedEmailsNow(subCompanyId);
  } else {
    await recomputeQueuedEmailSchedule(subCompanyId);
  }

  return res.json({
    enabled: updated.enabled,
    startMinuteOfDay: updated.startMinuteOfDay,
    cutoffMinuteOfDay: updated.cutoffMinuteOfDay,
    timezone: updated.timezone,
  });
});

settingsRouter.delete('/email-send-window', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const updated = await upsertEmailSendWindowSetting({
    subCompanyId,
    enabled: false,
    startMinuteOfDay: null,
    cutoffMinuteOfDay: null,
    timezone: 'America/Toronto',
  });
  await flushQueuedEmailsNow(subCompanyId);

  return res.json({
    enabled: updated.enabled,
    startMinuteOfDay: updated.startMinuteOfDay,
    cutoffMinuteOfDay: updated.cutoffMinuteOfDay,
    timezone: updated.timezone,
  });
});

// ─── Call Scripts CRUD ──────────────────────────────────────────────────────────

const callScriptBodySchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  clientStatus: z.string().max(50).optional().nullable(),
  isActive: z.boolean().optional(),
});

/** GET /settings/call-scripts — list all call scripts for the agency. */
settingsRouter.get('/call-scripts', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const scripts = await prisma.callScript.findMany({
    where: { subCompanyId },
    orderBy: { name: 'asc' },
  });

  return res.json({ data: scripts });
});

/** POST /settings/call-scripts — create a new call script. */
settingsRouter.post('/call-scripts', requireCallScriptsAccess, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = callScriptBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.flatten() });

  const existing = await prisma.callScript.findUnique({
    where: { subCompanyId_name: { subCompanyId, name: parsed.data.name } },
  });
  if (existing) return res.status(409).json({ error: 'A script with this name already exists' });

  const script = await prisma.callScript.create({
    data: {
      subCompanyId,
      name: parsed.data.name,
      content: parsed.data.content,
      clientStatus: parsed.data.clientStatus ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  });

  return res.status(201).json({ data: script });
});

/** PATCH /settings/call-scripts/:id — update a call script. */
settingsRouter.patch('/call-scripts/:id', requireCallScriptsAccess, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const { id } = req.params;
  const record = await prisma.callScript.findFirst({ where: { id, subCompanyId } });
  if (!record) return res.status(404).json({ error: 'Script not found' });

  const parsed = callScriptBodySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data', details: parsed.error.flatten() });

  if (parsed.data.name && parsed.data.name !== record.name) {
    const dup = await prisma.callScript.findUnique({
      where: { subCompanyId_name: { subCompanyId, name: parsed.data.name } },
    });
    if (dup) return res.status(409).json({ error: 'A script with this name already exists' });
  }

  const updated = await prisma.callScript.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.content !== undefined && { content: parsed.data.content }),
      ...(parsed.data.clientStatus !== undefined && { clientStatus: parsed.data.clientStatus }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  });

  return res.json({ data: updated });
});

/** DELETE /settings/call-scripts/:id — delete a call script. */
settingsRouter.delete('/call-scripts/:id', requireCallScriptsAccess, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const { id } = req.params;
  const record = await prisma.callScript.findFirst({ where: { id, subCompanyId } });
  if (!record) return res.status(404).json({ error: 'Script not found' });

  await prisma.callScript.delete({ where: { id } });
  return res.status(204).end();
});

// ——— Proposal Default Files ———

/** GET /settings/lead-deadline */
settingsRouter.get('/lead-deadline', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const row = await prisma.leadDeadlineSetting.findUnique({ where: { subCompanyId } });
  return res.json({ days: row?.days ?? 7 });
});

/** PUT /settings/lead-deadline */
settingsRouter.put('/lead-deadline', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const parsed = z.object({ days: z.number().int().min(0).max(365) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  const row = await prisma.leadDeadlineSetting.upsert({
    where: { subCompanyId },
    create: { subCompanyId, days: parsed.data.days },
    update: { days: parsed.data.days },
    select: { days: true, updatedAt: true },
  });
  return res.json(row);
});

/** GET /settings/proposal-awaiting-client */
settingsRouter.get('/proposal-awaiting-client', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const row = await prisma.proposalAwaitingClientSetting.findUnique({ where: { subCompanyId } });
  return res.json({ days: row?.days ?? 7 });
});

/** PUT /settings/proposal-awaiting-client */
settingsRouter.put('/proposal-awaiting-client', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const parsed = z.object({ days: z.number().int().min(0).max(365) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

  const row = await prisma.proposalAwaitingClientSetting.upsert({
    where: { subCompanyId },
    create: { subCompanyId, days: parsed.data.days },
    update: { days: parsed.data.days },
    select: { days: true, updatedAt: true },
  });
  return res.json(row);
});

/** GET /settings/proposal-default-setting */
settingsRouter.get('/proposal-default-setting', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const row = await prisma.proposalDefaultSetting.findUnique({ where: { subCompanyId } });
  return res.json({ maxFiles: row?.maxFiles ?? 5 });
});

/** PUT /settings/proposal-default-setting */
settingsRouter.put('/proposal-default-setting', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const parsed = z.object({ maxFiles: z.number().int().min(1).max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'maxFiles must be between 1 and 20' });
  const row = await prisma.proposalDefaultSetting.upsert({
    where: { subCompanyId },
    create: { subCompanyId, maxFiles: parsed.data.maxFiles },
    update: { maxFiles: parsed.data.maxFiles },
  });
  return res.json({ maxFiles: row.maxFiles });
});

/** GET /settings/proposal-default-files */
settingsRouter.get('/proposal-default-files', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const files = await prisma.proposalDefaultFile.findMany({
    where: { subCompanyId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, fileUrl: true, mimeType: true, createdAt: true },
  });
  return res.json({ data: files });
});

/** POST /settings/proposal-default-files — upload a default file (base64). Max 5 per agency. */
settingsRouter.post('/proposal-default-files', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = z.object({
    name: z.string().min(1).max(255),
    fileBase64: z.string().min(1),
    mimeType: z.string().max(128).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

  const [count, setting] = await Promise.all([
    prisma.proposalDefaultFile.count({ where: { subCompanyId } }),
    prisma.proposalDefaultSetting.findUnique({ where: { subCompanyId } }),
  ]);
  const maxFiles = setting?.maxFiles ?? 5;
  if (count >= maxFiles) {
    return res.status(409).json({ error: `Maximum of ${maxFiles} default files allowed` });
  }

  const maxSize = parseInt(env.MAX_FILE_SIZE ?? '10485760', 10);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(parsed.data.fileBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64' });
  }
  if (buffer.length > maxSize) {
    return res.status(413).json({ error: 'File too large' });
  }

  const ext = parsed.data.name.includes('.') ? parsed.data.name.split('.').pop() : 'bin';
  const key = `proposal-defaults/${subCompanyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType = parsed.data.mimeType ?? 'application/octet-stream';

  const fileUrl = await uploadToR2(key, buffer, contentType);
  if (!fileUrl) return res.status(500).json({ error: 'File upload failed' });

  const file = await prisma.proposalDefaultFile.create({
    data: { subCompanyId, name: parsed.data.name, fileUrl, mimeType: parsed.data.mimeType ?? null },
    select: { id: true, name: true, fileUrl: true, mimeType: true, createdAt: true },
  });

  return res.status(201).json({ data: file });
});

/** DELETE /settings/proposal-default-files/:id */
settingsRouter.delete('/proposal-default-files/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const record = await prisma.proposalDefaultFile.findFirst({ where: { id: req.params.id, subCompanyId } });
  if (!record) return res.status(404).json({ error: 'File not found' });

  await prisma.proposalDefaultFile.delete({ where: { id: req.params.id } });
  return res.status(204).end();
});

// ——— Proposal Type Template Mappings ———

/** GET /settings/proposal-type-templates — readable by all authenticated users */
settingsRouter.get('/proposal-type-templates', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.json({ tempTemplateId: null, tempTemplateName: null, directTemplateId: null, directTemplateName: null, bothTemplateId: null, bothTemplateName: null, employeeOnboardingTemplateId: null, employeeOnboardingTemplateName: null });

  const row = await prisma.proposalTypeTemplateMapping.findUnique({ where: { subCompanyId } });
  return res.json({
    tempTemplateId: row?.tempTemplateId ?? null,
    tempTemplateName: row?.tempTemplateName ?? null,
    directTemplateId: row?.directTemplateId ?? null,
    directTemplateName: row?.directTemplateName ?? null,
    bothTemplateId: row?.bothTemplateId ?? null,
    bothTemplateName: row?.bothTemplateName ?? null,
    employeeOnboardingTemplateId: row?.employeeOnboardingTemplateId ?? null,
    employeeOnboardingTemplateName: row?.employeeOnboardingTemplateName ?? null,
  });
});

/** PUT /settings/proposal-type-templates — director/super_admin/operations_manager only */
settingsRouter.put('/proposal-type-templates', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = z.object({
    tempTemplateId: z.string().nullable().optional(),
    tempTemplateName: z.string().nullable().optional(),
    directTemplateId: z.string().nullable().optional(),
    directTemplateName: z.string().nullable().optional(),
    bothTemplateId: z.string().nullable().optional(),
    bothTemplateName: z.string().nullable().optional(),
    employeeOnboardingTemplateId: z.string().nullable().optional(),
    employeeOnboardingTemplateName: z.string().nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

  const data = {
    tempTemplateId: parsed.data.tempTemplateId ?? null,
    tempTemplateName: parsed.data.tempTemplateName ?? null,
    directTemplateId: parsed.data.directTemplateId ?? null,
    directTemplateName: parsed.data.directTemplateName ?? null,
    bothTemplateId: parsed.data.bothTemplateId ?? null,
    bothTemplateName: parsed.data.bothTemplateName ?? null,
    employeeOnboardingTemplateId: parsed.data.employeeOnboardingTemplateId ?? null,
    employeeOnboardingTemplateName: parsed.data.employeeOnboardingTemplateName ?? null,
  };

  const row = await prisma.proposalTypeTemplateMapping.upsert({
    where: { subCompanyId },
    create: { subCompanyId, ...data },
    update: data,
    select: { tempTemplateId: true, tempTemplateName: true, directTemplateId: true, directTemplateName: true, bothTemplateId: true, bothTemplateName: true, employeeOnboardingTemplateId: true, employeeOnboardingTemplateName: true },
  });
  return res.json(row);
});

// ——— My Performance Target (any authenticated user) ———

/**
 * GET /settings/my-performance-target
 * Returns the active target for the caller's own role so associates can see
 * their daily targets on their dashboard. No elevated role required.
 */
settingsRouter.get('/my-performance-target', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  const role = req.user?.role;
  if (!subCompanyId || !role) return res.status(403).json({ error: 'Auth context required' });

  const today = new Date();
  const t = await prisma.performanceTarget.findFirst({
    where: { subCompanyId, role, effectiveFrom: { lte: today } },
    orderBy: { effectiveFrom: 'desc' },
    select: { emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true },
  });

  return res.json(t ?? null);
});

// ——— Performance Targets (Director / Super Admin / Operations Manager) ———

async function getMeasuredRoleKeysForTargets(): Promise<string[]> {
  const keys = await getActiveRoleKeysByScopeLevels(['own']);
  return keys.length > 0 ? keys : ['sales_associate'];
}

const performanceTargetSchema = z.object({
  role: z.string().min(1).max(80),
  emailsTarget: z.number().int().min(0).max(9999),
  callsTarget: z.number().int().min(0).max(9999),
  meetingScheduleCountTarget: z.number().int().min(0).max(9999),
  // Deprecated — ignored if sent by older clients; kept for backward-compatible API bodies.
  tasksTarget: z.number().int().min(0).max(9999).optional(),
  followUpsTarget: z.number().int().min(0).max(9999).optional(),
});

/**
 * GET /settings/performance-targets
 * Returns the current (as-of today) targets for each measured role in the agency.
 * Query: ?subCompanyId=...&asOf=YYYY-MM-DD (optional)
 * Response: { roles: [{ role, label, target | null }] }
 */
settingsRouter.get(
  '/performance-targets',
  requirePermission('settings:read'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const asOfRaw = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
    const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
    if (isNaN(asOf.getTime())) return res.status(400).json({ error: 'Invalid asOf date' });

    const measuredRoles = await getMeasuredRoleKeysForTargets();
    const results = await Promise.all(
      measuredRoles.map(async (role) => {
        const t = await prisma.performanceTarget.findFirst({
          where: { subCompanyId, role, effectiveFrom: { lte: asOf } },
          orderBy: { effectiveFrom: 'desc' },
          select: { emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true },
        });
        const label = await getRoleDisplayName(role);
        return { role, label, target: t ?? null };
      }),
    );

    return res.json({ roles: results });
  },
);

/**
 * PUT /settings/performance-targets
 * Inserts a new role-level snapshot (append-only). Effective from today UTC.
 * Body: { role, emailsTarget, callsTarget, meetingScheduleCountTarget }
 */
settingsRouter.put(
  '/performance-targets',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = performanceTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const { role, emailsTarget, callsTarget, meetingScheduleCountTarget } = parsed.data;
    const measuredRoles = await getMeasuredRoleKeysForTargets();
    if (!measuredRoles.includes(role)) {
      return res.status(400).json({ error: 'Performance targets apply only to own-scope roles' });
    }
    const createdById: string = req.user!.sub;

    const today = new Date();
    const effectiveFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const record = await prisma.performanceTarget.create({
      data: { subCompanyId, role, emailsTarget, callsTarget, meetingScheduleCountTarget, effectiveFrom, createdById },
      select: {
        id: true, subCompanyId: true, role: true,
        emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true,
        effectiveFrom: true, createdAt: true,
      },
    });

    // Sync all users of this role to the new targets — awaited so navigating away and back
    // immediately shows fresh data (DB is committed before the response lands on the client).
    await prisma.user.updateMany({
      where: { subCompanyId, role: role as never },
      data: { dailyCallsTarget: callsTarget, dailyEmailsTarget: emailsTarget, dailyMeetingScheduleTarget: meetingScheduleCountTarget },
    });

    // Push real-time update to all connected agency members (fire-and-forget — DB is already updated).
    prisma.user.findMany({ where: { subCompanyId, isActive: true }, select: { id: true } })
      .then((agencyUsers) => {
        const userIds = agencyUsers.map((u) => u.id);
        if (userIds.length > 0) {
          emitToUsers(userIds, 'targets:refresh', {
            subCompanyId,
            role,
            target: { callsTarget, emailsTarget, meetingScheduleCountTarget },
          });
        }
      })
      .catch(() => {});

    return res.status(201).json(record);
  },
);

/**
 * GET /settings/performance-targets/history
 * Audit trail of all snapshots. Query: ?role=...&subCompanyId=...
 */
settingsRouter.get(
  '/performance-targets/history',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const role = typeof req.query.role === 'string' ? req.query.role : undefined;

    const rows = await prisma.performanceTarget.findMany({
      where: { subCompanyId, ...(role ? { role } : {}) },
      orderBy: { effectiveFrom: 'desc' },
      select: {
        id: true, role: true,
        emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true,
        effectiveFrom: true, createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    return res.json(rows);
  },
);

const approvalWorkflowPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('bypass') }),
  z.object({
    mode: z.literal('route'),
    route: z.array(z.string().min(1)).min(1).max(5),
  }),
]);

const putApprovalPolicySchema = z.object({
  subCompanyId: z.string().uuid().optional(),
  allowLeadSelfAssign: z.boolean(),
  workflows: z.record(approvalWorkflowPolicySchema),
});

/** GET /settings/approval-policy — per-agency approval route config */
settingsRouter.get(
  '/approval-policy',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
    const { getAgencyApprovalPolicy } = await import('../services/approvalPolicy');
    const policy = await getAgencyApprovalPolicy(subCompanyId);
    return res.json({ data: policy });
  },
);

const resetApprovalPolicySchema = z.object({
  subCompanyId: z.string().uuid().optional(),
});

/** POST /settings/approval-policy/reset — restore agency default approval routes */
settingsRouter.post(
  '/approval-policy/reset',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const parsed = resetApprovalPolicySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const subCompanyId =
      parsed.data.subCompanyId ?? (await getEffectiveSubCompanyId(req));
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const { resetAgencyApprovalPolicyToDefaults } = await import('../services/approvalPolicy');
    try {
      const policy = await resetAgencyApprovalPolicyToDefaults(subCompanyId);
      return res.json({ data: policy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reset failed';
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return res.status(status).json({ error: message });
    }
  },
);

/** PUT /settings/approval-policy — director/super_admin per agency */
settingsRouter.put(
  '/approval-policy',
  requireSettingsWrite,
  async (req: Request, res: Response) => {
    const parsed = putApprovalPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const subCompanyId =
      parsed.data.subCompanyId ?? (await getEffectiveSubCompanyId(req));
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const { upsertAgencyApprovalPolicy } = await import('../services/approvalPolicy');
    try {
      const policy = await upsertAgencyApprovalPolicy(subCompanyId, {
        workflows: parsed.data.workflows as import('../types/approval').AgencyWorkflowsConfig,
        allowLeadSelfAssign: parsed.data.allowLeadSelfAssign,
      });
      return res.json({ data: policy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return res.status(status).json({ error: message });
    }
  },
);

const orgApprovalWorkflowPolicySchema = z.union([
  z.object({ mode: z.literal('bypass') }),
  z.object({ mode: z.literal('route'), route: z.array(z.string().min(1)).min(1).max(5) }),
]);

const putOrgApprovalPolicySchema = z.object({
  workflows: z.object({
    database_client_add: orgApprovalWorkflowPolicySchema,
    database_client_import: orgApprovalWorkflowPolicySchema,
    database_contact_import: orgApprovalWorkflowPolicySchema,
  }),
  databaseImportDestination: z.enum(['global', 'agency', 'both']).optional(),
  superUserClientDestination: z.enum(['global', 'agency', 'both']).optional(),
});

/** GET /settings/org-approval-policy — org-wide global database approval routes */
settingsRouter.get('/org-approval-policy', requirePermission('settings:read'), async (_req: Request, res: Response) => {
  const { getOrgApprovalPolicy } = await import('../services/approvalPolicy');
  const policy = await getOrgApprovalPolicy();
  return res.json({ data: policy });
});

/** PUT /settings/org-approval-policy */
settingsRouter.put('/org-approval-policy', requireSettingsWrite, async (req: Request, res: Response) => {
  const parsed = putOrgApprovalPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { upsertOrgApprovalPolicy } = await import('../services/approvalPolicy');
  try {
    const policy = await upsertOrgApprovalPolicy({
      workflows: parsed.data.workflows,
      databaseImportDestination: parsed.data.databaseImportDestination,
      superUserClientDestination: parsed.data.superUserClientDestination,
    });
    return res.json({ data: policy });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed';
    const status = (err as { statusCode?: number }).statusCode ?? 400;
    return res.status(status).json({ error: message });
  }
});

/** POST /settings/org-approval-policy/reset */
settingsRouter.post('/org-approval-policy/reset', requireSettingsWrite, async (_req: Request, res: Response) => {
  const { resetOrgApprovalPolicyToDefaults } = await import('../services/approvalPolicy');
  try {
    const policy = await resetOrgApprovalPolicyToDefaults();
    return res.json({ data: policy });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reset failed';
    return res.status(400).json({ error: message });
  }
});

// ——— Notification rules (agency templates + enable/disable) ———

const notificationRuleItemSchema = z.object({
  eventKey: z.string().min(1),
  enabled: z.boolean().optional(),
  titleTemplate: z.string().nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
});

settingsRouter.get('/notification-rules', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const rules = await listMergedAgencyRules(subCompanyId);
  return res.json({ data: rules });
});

settingsRouter.put('/notification-rules', requireSettingsWrite, async (req: Request, res: Response) => {
  const parsed = z
    .object({
      subCompanyId: z.string().uuid().optional(),
      rules: z.array(notificationRuleItemSchema).min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

  const subCompanyId = parsed.data.subCompanyId ?? (await getEffectiveSubCompanyId(req));
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  try {
    await upsertAgencyNotificationRules(subCompanyId, parsed.data.rules);
    const rules = await listMergedAgencyRules(subCompanyId);
    return res.json({ data: rules });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save notification rules';
    return res.status(400).json({ error: message });
  }
});

settingsRouter.post('/notification-rules/preview', requireSettingsWrite, async (req: Request, res: Response) => {
  const parsed = z
    .object({
      eventKey: z.string().min(1),
      titleTemplate: z.string().nullable().optional(),
      bodyTemplate: z.string().nullable().optional(),
      context: z.record(z.string()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

  const entry = getRegistryEntry(parsed.data.eventKey);
  if (!entry) return res.status(404).json({ error: 'Unknown notification event' });

  const preview = previewNotification(
    parsed.data.eventKey,
    parsed.data.context ?? entry.sampleContext,
    parsed.data.titleTemplate,
    parsed.data.bodyTemplate,
  );
  if (!preview) return res.status(404).json({ error: 'Unknown notification event' });
  return res.json({ data: preview });
});

// ——— Agency Email Signature Template + Visual Config ———

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const signatureFieldKey = z.enum([
  'name', 'title', 'agency', 'phone', 'email', 'contact_row', 'website_bar', 'divider',
]);
const signatureConfigSchema = z.object({
  version: z.literal(2),
  layout: z.enum(['logo-left', 'logo-right', 'no-logo']),
  preset: z.enum(['executive', 'compact', 'minimal']).optional(),
  agencyColor: hexColor,
  nameColor: hexColor.nullable(),
  detailColor: hexColor,
  logoLabelColor: hexColor,
  logoSize: z.union([z.literal(40), z.literal(48), z.literal(56), z.literal(64)]),
  showLogoLabel: z.boolean(),
  showTagline: z.boolean(),
  showVerticalDivider: z.boolean(),
  showNameUnderline: z.boolean(),
  showWebsiteBar: z.boolean(),
  showTopRule: z.boolean(),
  showContactIcons: z.boolean(),
  websiteUrl: z.string().max(500).nullable(),
  textPosition: z.object({
    verticalAlign: z.enum(['top', 'middle', 'bottom']),
    horizontalAlign: z.enum(['left', 'center', 'right']),
    logoGap: z.union([z.literal(8), z.literal(12), z.literal(16), z.literal(20), z.literal(24)]),
    paddingTop: z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12), z.literal(16), z.literal(24)]),
    paddingBottom: z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12), z.literal(16), z.literal(24)]),
    paddingInline: z.union([z.literal(12), z.literal(16), z.literal(18), z.literal(20), z.literal(24)]),
  }),
  fields: z.array(z.object({
    key: signatureFieldKey,
    enabled: z.boolean(),
    order: z.number().int().min(0).max(20),
    bold: z.boolean().optional(),
    fontSize: z.number().int().min(11).max(20).optional(),
    color: hexColor.nullable().optional(),
  })).min(1).max(20),
});

settingsRouter.get('/email-signature', requirePermission('settings:read'), async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  try {
    const sc = await prisma.subCompany.findUnique({
      where: { id: subCompanyId },
      select: { emailSignatureTemplate: true, emailSignatureConfig: true, agencyLogoUrl: true },
    });
    const rawConfig = sc?.emailSignatureConfig ?? null;
    const hasSaved =
      rawConfig != null || !!(sc?.emailSignatureTemplate && sc.emailSignatureTemplate.trim());
    const emailSignatureConfig = rawConfig != null
      ? migrateSignatureConfigToV2(rawConfig)
      : DEFAULT_SIGNATURE_CONFIG;
    const emailSignatureTemplate = sc?.emailSignatureTemplate?.trim()
      ? sc.emailSignatureTemplate
      : buildSignatureHtmlFromConfig(DEFAULT_SIGNATURE_CONFIG);
    return res.json({
      emailSignatureTemplate,
      emailSignatureConfig,
      agencyLogoUrl: sc?.agencyLogoUrl ?? null,
      isLegacy: !rawConfig && !!(sc?.emailSignatureTemplate?.trim()),
      usingDefault: !hasSaved,
    });
  } catch (err) {
    console.error('[email-signature GET]', err);
    // Never 500 on bad JSON — return universal default
    return res.json({
      emailSignatureTemplate: buildSignatureHtmlFromConfig(DEFAULT_SIGNATURE_CONFIG),
      emailSignatureConfig: DEFAULT_SIGNATURE_CONFIG,
      agencyLogoUrl: null,
      isLegacy: false,
      usingDefault: true,
    });
  }
});

settingsRouter.patch(
  '/email-signature',
  requirePermission('email:configure_signature'),
  async (req: Request, res: Response) => {
    const subCompanyId = await getEffectiveSubCompanyId(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const body = req.body ?? {};

    // Visual builder path: config → machine HTML (skip sanitizeRichHtml)
    if (body.emailSignatureConfig !== undefined) {
      if (body.emailSignatureConfig === null) {
        // Reset to default executive
        const config = { ...DEFAULT_SIGNATURE_CONFIG };
        const html = buildSignatureHtmlFromConfig(config);
        await prisma.subCompany.update({
          where: { id: subCompanyId },
          data: {
            emailSignatureConfig: config as object,
            emailSignatureTemplate: html,
          },
        });
        invalidateAgencyBrandingCache(subCompanyId);
        return res.json({
          emailSignatureTemplate: html,
          emailSignatureConfig: config,
          isLegacy: false,
        });
      }

      const parsed = signatureConfigSchema.safeParse(body.emailSignatureConfig);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid signature config', details: parsed.error.flatten() });
      }
      // Reject javascript: website via migrate/normalize (schema allows string; builder drops bad urls)
      const config = migrateSignatureConfigToV2(parsed.data) as SignatureConfig;
      if (config.websiteUrl && /^\s*javascript:/i.test(config.websiteUrl)) {
        return res.status(400).json({ error: 'Invalid website URL' });
      }
      const html = buildSignatureHtmlFromConfig(config);
      await prisma.subCompany.update({
        where: { id: subCompanyId },
        data: {
          emailSignatureConfig: config as object,
          emailSignatureTemplate: html,
        },
      });
      invalidateAgencyBrandingCache(subCompanyId);
      return res.json({
        emailSignatureTemplate: html,
        emailSignatureConfig: config,
        isLegacy: false,
      });
    }

    // Legacy raw HTML path (convert / manual) — still sanitized
    const parsed = z.object({
      emailSignatureTemplate: z.string().max(50000).nullable(),
    }).safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

    const sanitized = parsed.data.emailSignatureTemplate
      ? sanitizeRichHtml(parsed.data.emailSignatureTemplate)
      : null;

    await prisma.subCompany.update({
      where: { id: subCompanyId },
      data: {
        emailSignatureTemplate: sanitized,
        emailSignatureConfig: Prisma.DbNull,
      },
    });

    invalidateAgencyBrandingCache(subCompanyId);

    return res.json({
      emailSignatureTemplate: sanitized,
      emailSignatureConfig: null,
      isLegacy: !!(sanitized?.trim()),
    });
  }
);

// ─── Signing Authorities ───────────────────────────────────────────────────

const signingAuthoritySchema = z.object({
  name: z.string().min(1).max(200).trim(),
  signatureData: z.string().min(1).max(524288), // 512 KB cap — SVGs are small
  fontFamily: z.string().min(1).max(100).trim(),
});

function isNotFound(err: unknown) {
  return (err as any)?.code === 'P2025';
}

settingsRouter.get('/signing-authorities', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const list = await getSigningAuthorities(subCompanyId);
  return res.json(list);
});

settingsRouter.post('/signing-authorities', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const parsed = signingAuthoritySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  const record = await createSigningAuthority(subCompanyId, req.user!.sub, parsed.data);
  return res.json(record);
});

settingsRouter.put('/signing-authorities/:id', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  const parsed = signingAuthoritySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  try {
    const record = await updateSigningAuthority(req.params.id, subCompanyId, parsed.data);
    return res.json(record);
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'Signing authority not found' });
    throw err;
  }
});

settingsRouter.patch('/signing-authorities/:id/primary', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  try {
    await setPrimarySigningAuthority(req.params.id, subCompanyId);
    return res.json({ ok: true });
  } catch (err) {
    if (isNotFound(err)) return res.status(404).json({ error: 'Signing authority not found' });
    throw err;
  }
});

settingsRouter.delete('/signing-authorities/:id', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
  await deleteSigningAuthority(req.params.id, subCompanyId);
  return res.json({ ok: true });
});
