import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requireSettingsWrite } from '../middleware/requireSettingsAccess';
import { resolveAgencyScope, resolveAllowedSubCompanyIds } from '../config/agencyScope';
import { buildAccessContext, canAccessMultipleAgencies, hasPermission } from '../services/accessContext';
import { REPORT_PROFILES, type DailyReportPayload, type ReportScope } from '../services/dailyReportTypes';
import { profileResolver } from '../services/dailyReportProfiles';
import { canReadReport, reportAudience, reportUserSelect, userToken, canConfigureReportDelivery, reportRecipientEmail, resolveReportDeliveryTarget } from '../services/dailyReportRecipients';
import { localDateKey, shiftDate } from '../services/reportMetrics';
import { saveReportSnapshot } from '../services/dailyReportBuilder';

export const dailyReportsRouter = Router();
dailyReportsRouter.use(authenticate);
const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  void fn(req, res).catch((error: unknown) => {
    const status = (error as { status?: number })?.status;
    if (status === 400 || status === 403) res.status(status).json({ error: error instanceof Error ? error.message : 'Request unavailable' });
    else { console.error('[dailyReports] Request failed:', error); res.status(500).json({ error: 'Unable to process daily reports. Check that database migrations have been applied.' }); }
  });
};

async function context(req: Request) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: reportUserSelect });
  if (!user?.isActive) throw Object.assign(new Error('Account unavailable'), { status: 403 });
  const allowed = await resolveAllowedSubCompanyIds(userToken(user));
  const explicit = typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId : undefined;
  if (explicit && !allowed.includes(explicit)) throw Object.assign(new Error('Agency is outside your access'), { status: 403 });
  const agencyId = await resolveAgencyScope(req) ?? allowed[0];
  if (!agencyId || !allowed.includes(agencyId)) throw Object.assign(new Error('An accessible agency is required'), { status: 403 });
  const agency = agencyId ? await prisma.subCompany.findUnique({ where: { id: agencyId } }) : null;
  if (!agency) throw Object.assign(new Error('An accessible agency is required'), { status: 400 });
  const orgAgencies = await prisma.subCompany.findMany({ where: { mainOrgId: agency.mainOrgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const access = await buildAccessContext(userToken(user));
  const canManageOrganization = hasPermission(access, 'settings:write') && canAccessMultipleAgencies(access) && orgAgencies.every(a => allowed.includes(a.id));
  const scope: ReportScope = req.query.scope === 'organization' ? 'organization' : 'agency';
  if (scope === 'organization' && !canManageOrganization) throw Object.assign(new Error('Company report settings require access to the whole organization'), { status: 403 });
  return { user, agency, scope, scopeId: scope === 'organization' ? agency.mainOrgId : agency.id, orgAgencies, canManageOrganization, access };
}

async function settingsResponse(req: Request) {
  const c = await context(req);
  const agencies = c.scope === 'organization' ? c.orgAgencies : [{ id: c.agency.id, name: c.agency.name }];
  const agencyIds = agencies.map(a => a.id);
  const [stored, legacy, roles, assignments, resolveProfile] = await Promise.all([
    prisma.dailyReportPolicy.findUnique({ where: { scope_scopeId: { scope: c.scope, scopeId: c.scopeId } } }),
    prisma.dailyReportSetting.findUnique({ where: { subCompanyId: c.agency.id } }),
    prisma.rbacRole.findMany({ where: { isActive: true }, select: { key: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.reportProfileAssignment.findMany({ where: { mainOrgId: c.agency.mainOrgId, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } }),
    profileResolver([c.agency.mainOrgId]),
  ]);
  const audience = await reportAudience(c.user, agencyIds, false, false, c.scope === 'organization');
  const policy = {
    id: stored?.id, scope: c.scope, scopeId: c.scopeId, enabled: stored?.enabled ?? false,
    sendHour: stored?.sendHour ?? (c.scope === 'agency' ? legacy?.sendHour ?? 8 : 8),
    sendMinute: stored?.sendMinute ?? legacy?.sendMinute ?? 0,
    timezone: stored?.timezone ?? legacy?.timezone ?? 'America/Toronto',
    shiftHours: stored?.shiftHours ?? legacy?.shiftHours ?? 8, period: stored?.period ?? 'previous_day',
    recipientEmail: stored?.recipientEmail ?? '', authorizedById: stored?.authorizedById ?? null,
    recipientsConfigured: stored?.recipientsConfigured ?? false, profiles: [...REPORT_PROFILES], agencyIds,
  };
  return {
    policy, members: audience.users.map(person => {
      const assignment = assignments.find(a => a.subjectType === 'user' && a.subjectId === person.id);
      return { ...person, profile: resolveProfile(person, c.agency.mainOrgId), profileOverride: assignment && assignment.profile !== 'default' ? assignment.profile : null };
    }), roles: roles.map(role => ({ ...role, profile: resolveProfile({ id: '', role: role.key }, c.agency.mainOrgId) })),
    agencies, canManageOrganization: c.canManageOrganization,
    canConfigureDelivery: canConfigureReportDelivery(c.access),
    defaultScope: c.canManageOrganization ? 'organization' : 'agency',
  };
}

dailyReportsRouter.get('/settings', requireSettingsWrite, route(async (req, res) => res.json(await settingsResponse(req))));
const policySchema = z.object({
  enabled: z.boolean(), sendHour: z.number().int().min(0).max(23), sendMinute: z.number().int().min(0).max(59),
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Invalid timezone'),
  shiftHours: z.number().int().min(1).max(24), period: z.enum(['today', 'previous_day']),
  recipientEmail: z.union([reportRecipientEmail, z.string().trim().length(0), z.null()]).transform(value => value || null),
}).strict();
dailyReportsRouter.patch('/settings', requireSettingsWrite, route(async (req, res) => {
  const c = await context(req);
  if (!canConfigureReportDelivery(c.access)) return res.status(403).json({ error: 'Configuring a combined report requires access to all users and their CRM and Hubstaff work in this scope' });
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid report settings', details: parsed.error.flatten() });
  if (parsed.data.enabled && !parsed.data.recipientEmail) return res.status(400).json({ error: 'Enter the email address that should receive the combined report' });
  const data = { ...parsed.data, authorizedById: c.user.id, recipientUserIds: [], sendToManagers: false,
    recipientsConfigured: !!parsed.data.recipientEmail, profiles: [...REPORT_PROFILES],
    agencyIds: c.scope === 'agency' ? [c.agency.id] : c.orgAgencies.map(a => a.id) };
  await prisma.$transaction(async tx => {
    await tx.dailyReportPolicy.upsert({ where: { scope_scopeId: { scope: c.scope, scopeId: c.scopeId } },
      create: { scope: c.scope, scopeId: c.scopeId, ...data }, update: data });
    if (c.scope === 'agency') {
      const legacy = { enabled: data.enabled, sendHour: data.sendHour, sendMinute: data.sendMinute, timezone: data.timezone, shiftHours: data.shiftHours };
      await tx.dailyReportSetting.upsert({ where: { subCompanyId: c.agency.id }, create: { subCompanyId: c.agency.id, ...legacy }, update: legacy });
    }
  });
  return res.json(await settingsResponse(req));
}));

dailyReportsRouter.patch('/profiles', requireSettingsWrite, route(async (req, res) => {
  const c = await context(req);
  const parsed = z.object({ subjectType: z.enum(['user', 'role']), subjectId: z.string().min(1), profile: z.enum(REPORT_PROFILES).nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid work profile' });
  const { subjectType, subjectId, profile } = parsed.data;
  if (subjectType === 'role' && (!c.canManageOrganization || profile === null)) return res.status(403).json({ error: 'Role defaults require organization settings access and a profile' });
  if (subjectType === 'user') {
    const audience = await reportAudience(c.user, c.orgAgencies.map(a => a.id), false, false, c.canManageOrganization);
    if (!audience.users.some(u => u.id === subjectId)) return res.status(403).json({ error: 'Employee is outside your access' });
  } else if (!await prisma.rbacRole.findUnique({ where: { key: subjectId } })) return res.status(404).json({ error: 'Role not found' });
  await prisma.reportProfileAssignment.create({ data: { mainOrgId: c.agency.mainOrgId, subjectType, subjectId, profile: profile ?? 'default', changedById: c.user.id } });
  return res.json({ ok: true });
}));

dailyReportsRouter.post('/preview', requireSettingsWrite, route(async (req, res) => {
  const c = await context(req);
  if (!canConfigureReportDelivery(c.access)) return res.status(403).json({ error: 'Combined report access is required' });
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid preview request' });
  const policy = await prisma.dailyReportPolicy.findUnique({ where: { scope_scopeId: { scope: c.scope, scopeId: c.scopeId } } });
  if (!policy?.recipientsConfigured) return res.status(400).json({ error: 'Save a report email address before generating a preview' });
  const target = await resolveReportDeliveryTarget(policy);
  if (!target) return res.status(403).json({ error: 'Report authorization changed. Save settings again with an authorized account.' });
  const date = parsed.data.date ?? shiftDate(localDateKey(new Date(), policy.timezone), policy.period === 'previous_day' ? -1 : 0);
  try {
    const result = await saveReportSnapshot({ ...policy, agencyIds: target.agencyIds, profiles: [...REPORT_PROFILES] }, target.user, date, true, false);
    if (!await canReadReport(c.user, result.report)) {
      await prisma.dailyReportSnapshot.delete({ where: { id: result.id } });
      return res.status(403).json({ error: 'This recipient can see information outside your own report access' });
    }
    return res.json(result);
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to generate preview' }); }
}));

dailyReportsRouter.get('/history', requireSettingsWrite, route(async (req, res) => {
  const c = await context(req);
  const rows = await prisma.dailyReportDelivery.findMany({ where: { snapshot: { policy: { scope: c.scope, scopeId: c.scopeId } } }, include: { snapshot: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  return res.json({ data: rows.map(row => ({ id: row.id, snapshotId: row.snapshotId, recipientName: (row.snapshot.payload as unknown as DailyReportPayload).recipient.name, recipientEmail: row.recipientEmail, reportDate: row.snapshot.reportDate, status: row.status, attempts: row.attempts, lastError: row.lastError, acceptedAt: row.acceptedAt, createdAt: row.createdAt })) });
}));

dailyReportsRouter.get('/snapshots/:id', route(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: reportUserSelect });
  const snapshot = await prisma.dailyReportSnapshot.findUnique({ where: { id: req.params.id } });
  if (!snapshot) return res.status(404).json({ error: 'Report not found' });
  const payload = snapshot.payload as unknown as DailyReportPayload;
  if (!user || !await canReadReport(user, payload)) return res.status(403).json({ error: 'You no longer have access to all information in this report' });
  return res.json(payload);
}));

dailyReportsRouter.post('/deliveries/:id/retry', requireSettingsWrite, route(async (req, res) => {
  const c = await context(req);
  const delivery = await prisma.dailyReportDelivery.findUnique({ where: { id: req.params.id }, include: { snapshot: { include: { policy: true } } } });
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  const targetPolicy = delivery.snapshot.policy;
  const managesPolicy = targetPolicy.scope === 'organization'
    ? c.canManageOrganization && targetPolicy.scopeId === c.agency.mainOrgId
    : targetPolicy.scope === 'agency' && targetPolicy.scopeId === c.agency.id;
  if (!managesPolicy) return res.status(403).json({ error: 'Report policy is outside your settings access' });
  if (!canConfigureReportDelivery(c.access)) return res.status(403).json({ error: 'Combined report access is required' });
  const target = await resolveReportDeliveryTarget(targetPolicy);
  if (!target || target.email !== delivery.recipientEmail || target.user.id !== delivery.recipientId) return res.status(409).json({ error: 'The recipient email or report authorization changed; this saved delivery cannot be retried' });
  if (delivery.status !== 'failed') return res.status(409).json({ error: 'Only confirmed failed deliveries may be retried' });
  if (!await canReadReport(c.user, delivery.snapshot.payload as unknown as DailyReportPayload)) return res.status(403).json({ error: 'Report is outside your access' });
  if (!delivery.snapshot.policy.enabled) return res.status(409).json({ error: 'Enable this report policy before retrying' });
  await prisma.dailyReportDelivery.updateMany({ where: { id: delivery.id, status: 'failed' }, data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  return res.json({ ok: true });
}));
