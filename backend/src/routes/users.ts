import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import prisma from '../config/database';
import { uploadToR2, getR2Stream } from '../services/r2Storage';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import {
  canAccessMultipleAgencies,
  canAccessUserHierarchy,
  canViewTeamData,
  hasPermission,
  isTeamScopeManagerOnly,
  resolveEffectiveScopeLevel,
} from '../services/accessContext';
import { ensureAccessContext } from '../utils/requestPermission';
import { getPermissionsForRole } from '../config/permissions';
import { getUserRoleTitleSync } from '../services/rbac';
import { resolveAllowedSubCompanyIds, clearAgencyScopeCache } from '../config/agencyScope';
import { isAgencyIndependentRole } from '../config/agencyIndependentRoles';
import jwt from 'jsonwebtoken';
import { hashPassword, validatePasswordFormat, generateTemporaryPassword } from '../services/auth';
import { getResetExpiresIn } from '../services/auth';
import { sendWelcomeWithPassword, sendPasswordResetEmail, getAgencyBranding, invalidateAgencyBrandingCache } from '../services/email';
import { isGlobalSendAsUser } from '../services/globalSendAsEligibility';
import { getSendGridAuthenticatedDomains } from '../services/sendgridAuthenticatedDomains';
import { isSenderDomainError } from '../services/senderDomainErrors';
import { env } from '../config/env';
import { agencyPublicSelect, safeSubCompanyForClient } from '../utils/safeSubCompany';
import { buildReportingTree, fetchScopeFilterMembers, type TeamTreeNode } from '../services/teamScope';
import { Country } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { getActiveRbacRoleByKey, getOwnScopeChildRoleKeys, getDataScopeLevelForRoleKey, getEffectivePermissionKeysForRoleKey } from '../services/rbac';
import { ensureStaffExtensionForUser } from '../services/staffExtensions';
import {
  resolveSalesManagerReportingIds,
  validateSalesManagerReporting,
  resolveCompanyDirectorReportingIds,
  validateNewCompanyDirectorForAgency,
  repointSalesManagersToCompanyDirector,
} from '../services/companyDirectorReporting';

const UserRoleKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Invalid role key');

const CountryEnum = z.nativeEnum(Country);

const createUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  country: CountryEnum,
  role: UserRoleKeySchema,
  userType: z.string().min(1),
  subCompanyId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  reportingManagerIds: z.array(z.string().uuid()).optional(),
  dailyCallsTarget: z.number().int().min(0).optional(),
  dailyEmailsTarget: z.number().int().min(0).optional(),
  dailyMeetingScheduleTarget: z.number().int().min(0).optional(),
  dailyTasksTarget: z.number().int().min(0).optional(),
  dailyFollowUpsTarget: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  workEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

const updateUserBody = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  country: CountryEnum.optional(),
  role: UserRoleKeySchema.optional(),
  userType: z.string().min(1).optional(),
  subCompanyId: z.string().uuid().optional(),
  locationId: z.string().uuid().nullable().optional(),
  reportingManagerIds: z.array(z.string().uuid()).optional(),
  dailyCallsTarget: z.number().int().min(0).optional(),
  dailyEmailsTarget: z.number().int().min(0).optional(),
  dailyMeetingScheduleTarget: z.number().int().min(0).optional(),
  dailyTasksTarget: z.number().int().min(0).optional(),
  dailyFollowUpsTarget: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(1).optional(),
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  workEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  sendAsEmail: z.string().email().nullable().optional(),
  sendAsDisabled: z.boolean().optional(),
  canActAsAdmin: z.boolean().optional(),
});

const allowedDomains = (env.SEND_AS_ALLOWED_DOMAINS ?? '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function isAllowedEmailDomain(email: string): boolean {
  if (allowedDomains.length === 0) return true; // feature off — no restriction
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && allowedDomains.includes(domain);
}

async function domainsForSendAs(role: string | null | undefined, agencyDomain: string | null): Promise<string[]> {
  const base = agencyDomain
    ? [agencyDomain.toLowerCase()]
    : [...allowedDomains];
  if (!isGlobalSendAsUser(role)) return base;
  try {
    const sg = await getSendGridAuthenticatedDomains();
    return [...new Set([...base, ...sg])];
  } catch (err) {
    if (isSenderDomainError(err)) {
      console.warn('[users] SendGrid domains unavailable for allowlist:', err.message);
      return base;
    }
    throw err;
  }
}

export const userRouter = Router();

/** GET /users/sub-companies/:id/logo — public proxy: redirects if full URL, streams from R2 if raw key */
userRouter.get('/sub-companies/:id/logo', async (req: Request, res: Response) => {
  try {
    const agency = await prisma.subCompany.findUnique({ where: { id: req.params.id }, select: { agencyLogoUrl: true } });
    if (!agency?.agencyLogoUrl) return res.status(404).json({ error: 'No logo set' });
    const url = agency.agencyLogoUrl;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.redirect(302, url);
    }
    const result = await getR2Stream(url);
    if (!result) return res.status(404).json({ error: 'Logo not found in storage' });
    res.setHeader('Content-Type', result.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    (result.stream as NodeJS.ReadableStream).pipe(res);
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

userRouter.use(authenticate);

userRouter.get('/allowed-email-domains', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  const agencyDomain = subCompanyId
    ? (await getAgencyBranding(subCompanyId))?.emailSendAsDomain ?? null
    : null;
  const domains = await domainsForSendAs(req.user?.role, agencyDomain);
  return res.json({ domains });
});

userRouter.get('/me', async (req: Request, res: Response) => {
  const userId = req.user?.sub ?? '';
  const full = await prisma.user.findUnique({
    where: { id: userId },
    include: { subCompany: true, location: true },
  });
  if (!full) {
    return res.status(404).json({ error: 'User not found' });
  }
  const { passwordHash, subCompany: sc, ...userRest } = full;
  void passwordHash;

  // OM-only: per-agency sending emails for compose From auto-select (self-scoped).
  let managedAgencies: Array<{ subCompanyId: string; name: string; agencyEmail: string | null }> = [];
  if (full.role === 'operations_manager') {
    const links = await prisma.operationsManagerSubCompany.findMany({
      where: { userId },
      select: {
        subCompanyId: true,
        agencyEmail: true,
        subCompany: { select: { name: true } },
      },
      orderBy: { subCompanyId: 'asc' },
    });
    managedAgencies = links.map((l) => ({
      subCompanyId: l.subCompanyId,
      name: l.subCompany.name,
      agencyEmail: l.agencyEmail,
    }));
  }

  return res.json({
    ...userRest,
    subCompany: safeSubCompanyForClient(sc),
    roleLabel: getUserRoleTitleSync(full),
    permissions: getPermissionsForRole(full.role),
    managedAgencies,
  });
});

const createSubCompanyBody = z.object({
  name: z.string().min(1, 'Name is required'),
  mainOrgId: z.string().min(1, 'Main org ID is required'),
});

const updateSubCompanyBody = z.object({
  name: z.string().min(1).optional(),
  mainOrgId: z.string().min(1).optional(),
  emailFooterText: z.string().max(200).nullable().optional(),
  emailTagline: z.string().max(300).nullable().optional(),
  /** Company brand image: public login + in-app for super_admin / director only */
  logoUrl: z.string().max(2048).nullable().optional(),
  /** Agency mark: sidebar for all staff; emails use this image when set */
  agencyLogoUrl: z.string().max(2048).nullable().optional(),
  /** Agency contact email (optional) */
  agencyEmail: z.string().max(254).nullable().optional(),
  /** Agency phone (optional) */
  agencyPhone: z.string().max(40).nullable().optional(),
  /** CRM / login display name; null or empty clears override (agency `name` is used) */
  appProjectName: z.string().max(120).nullable().optional(),
  /** Per-agency From address for outbound emails (must be a SendGrid-authenticated sender). */
  emailFromAddress: z.string().email().max(254).nullable().optional(),
  /** Display name for the From field (e.g. "Acme Staffing"). */
  emailFromName: z.string().max(100).nullable().optional(),
  /** Domain for per-user Send-As (e.g. "acme.com"). Must be SendGrid-authenticated. */
  emailSendAsDomain: z.string().max(253).nullable().optional(),
  /** Domain configured in SendGrid Inbound Parse for reply threading (e.g. "nacrm-reply.acme.com"). */
  emailInboundDomain: z.string().max(253).nullable().optional(),
  /** Local-part for the inbound reply-to address (e.g. "subscriptions"). */
  emailInboundLocalpart: z.string().max(64).nullable().optional(),
});

/**
 * GET /users/accessible-agencies
 * Returns the agencies this user is allowed to access for cross-agency filtering.
 * - super_admin / director → agencies in scope (mainOrg or global)
 * - operations_manager → only explicitly assigned agencies (OperationsManagerSubCompany)
 * - Everyone else → empty array (frontend hides the filter)
 */
userRouter.get('/accessible-agencies', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const allowedIds = await resolveAllowedSubCompanyIds(req.user, req);
  const ctx = await ensureAccessContext(req);

  if (allowedIds.length === 0) {
    return res.json({ data: [] });
  }

  // Non-elevated users only ever have one agency — hide the filter.
  // Exception: Database Manager can be granted agency access via settings and still needs this list.
  if (
    allowedIds.length === 1 &&
    (!ctx || !canAccessMultipleAgencies(ctx)) &&
    ctx?.roleKey !== 'database_manager'
  ) {
    return res.json({ data: [] });
  }

  const agencies = await prisma.subCompany.findMany({
    where: { id: { in: allowedIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const userCountries = await prisma.user.findMany({
    where: { subCompanyId: { in: allowedIds }, isActive: true },
    select: { subCompanyId: true, country: true },
    distinct: ['subCompanyId', 'country'],
  });

  const countriesByAgency = new Map<string, string[]>();
  for (const row of userCountries) {
    if (!row.subCompanyId) continue;
    const list = countriesByAgency.get(row.subCompanyId) ?? [];
    list.push(row.country);
    countriesByAgency.set(row.subCompanyId, list);
  }

  return res.json({
    data: agencies.map(a => ({
      ...a,
      countries: countriesByAgency.get(a.id) ?? [],
    })),
  });
});

/** GET /users/sub-companies — list agencies. Any authenticated user can call (for header agency switcher / context). */
userRouter.get('/sub-companies', async (_req: Request, res: Response) => {
  const list = await prisma.subCompany.findMany({
    select: agencyPublicSelect,
    orderBy: { name: 'asc' },
  });
  const companyDirectors = await prisma.user.findMany({
    where: { role: 'company_director', isActive: true },
    select: { id: true, subCompanyId: true },
    orderBy: { createdAt: 'asc' },
  });
  const companyDirectorIdByAgency = new Map<string, string>();
  for (const cd of companyDirectors) {
    if (!cd.subCompanyId) continue;
    if (!companyDirectorIdByAgency.has(cd.subCompanyId)) {
      companyDirectorIdByAgency.set(cd.subCompanyId, cd.id);
    }
  }
  res.json({
    data: list.map((agency) => ({
      ...safeSubCompanyForClient(agency)!,
      companyDirectorId: companyDirectorIdByAgency.get(agency.id) ?? null,
    })),
  });
});

userRouter.post('/sub-companies', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const parsed = createSubCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
  }
  const { name, mainOrgId } = parsed.data;
  const existing = await prisma.subCompany.findFirst({ where: { name: name.trim() } });
  if (existing) {
    return res.status(400).json({ error: 'An agency with this name already exists' });
  }
  const sub = await prisma.subCompany.create({
    data: { name: name.trim(), mainOrgId: mainOrgId.trim() },
    select: agencyPublicSelect,
  });
  const { ensureAgencyApprovalPolicyDefaults } = await import('../services/approvalPolicy');
  await ensureAgencyApprovalPolicyDefaults(sub.id).catch((err) => {
    console.error('[users/sub-companies] Failed to seed approval defaults for new agency:', err);
  });
  return res.status(201).json({ data: safeSubCompanyForClient(sub) });
});

userRouter.patch('/sub-companies/:id', requirePermission('settings:write'), async (req: Request, res: Response) => {
  const parsed = updateSubCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
  }
  const ctx = await ensureAccessContext(req);
  const isGlobalAdmin = ctx && (ctx.scopeLevel === 'global' || hasPermission(ctx, 'agencies:global'));
  const canEditCrossAgencyBranding = ctx && canAccessMultipleAgencies(ctx);
  // Non-global admin: own agency only; name/mainOrgId global-only; branding fields need cross-agency scope
  if (!isGlobalAdmin) {
    if (req.params.id !== req.user!.subCompanyId) {
      return res.status(403).json({ error: 'You can only update your own agency' });
    }
    if (parsed.data.name !== undefined || parsed.data.mainOrgId !== undefined) {
      return res.status(403).json({ error: 'Only super admins can update agency name' });
    }
    if (
      (parsed.data.logoUrl !== undefined || parsed.data.appProjectName !== undefined) &&
      !canEditCrossAgencyBranding
    ) {
      return res.status(403).json({ error: 'Only directors can update app project name and logo' });
    }
    if (parsed.data.agencyLogoUrl !== undefined && !canEditCrossAgencyBranding) {
      return res.status(403).json({ error: 'Only directors or operations managers can update the agency logo' });
    }
  }
  const existing = await prisma.subCompany.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: 'Agency not found' });
  }
  const data: {
    name?: string;
    mainOrgId?: string;
    emailFooterText?: string | null;
    emailTagline?: string | null;
    logoUrl?: string | null;
    agencyLogoUrl?: string | null;
    agencyEmail?: string | null;
    agencyPhone?: string | null;   
    appProjectName?: string | null;
    emailFromAddress?: string | null;
    emailFromName?: string | null;
    emailSendAsDomain?: string | null;
    emailInboundDomain?: string | null;
    emailInboundLocalpart?: string | null;
  } = {};
  if (isGlobalAdmin && parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (isGlobalAdmin && parsed.data.mainOrgId !== undefined) data.mainOrgId = parsed.data.mainOrgId.trim();
  if (parsed.data.emailFooterText !== undefined) data.emailFooterText = parsed.data.emailFooterText?.trim() ?? null;
  if (parsed.data.emailTagline !== undefined) data.emailTagline = parsed.data.emailTagline?.trim() ?? null;

  if (parsed.data.logoUrl !== undefined) {
    const raw = parsed.data.logoUrl;
    if (raw === null || raw === '') {
      data.logoUrl = null;
    } else {
      const trimmed = raw.trim();
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        return res.status(400).json({ error: 'logoUrl must be a valid http(s) URL' });
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return res.status(400).json({ error: 'logoUrl must use http or https' });
      }
      data.logoUrl = trimmed;
    }
  }
  if (parsed.data.agencyLogoUrl !== undefined) {
    const raw = parsed.data.agencyLogoUrl;
    if (raw === null || raw === '') {
      data.agencyLogoUrl = null;
    } else {
      const trimmed = raw.trim();
      // Accept full http(s) URLs and raw R2 keys (returned by upload endpoint when R2_PUBLIC_URL is unset)
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        let url: URL;
        try {
          url = new URL(trimmed);
        } catch {
          return res.status(400).json({ error: 'agencyLogoUrl must be a valid http(s) URL' });
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return res.status(400).json({ error: 'agencyLogoUrl must use http or https' });
        }
      }
      data.agencyLogoUrl = trimmed;
    }
  }
  if (parsed.data.agencyEmail !== undefined) {
    const raw = parsed.data.agencyEmail;
    if (raw === null || raw === '') {
      data.agencyEmail = null;
    } else {
      const trimmed = raw.trim();
      if (!z.string().email().safeParse(trimmed).success) {
        return res.status(400).json({ error: 'agencyEmail must be a valid email address' });
      }
      data.agencyEmail = trimmed;
    }
  }
  if (parsed.data.agencyPhone !== undefined) {
    const raw = parsed.data.agencyPhone;
    if (raw === null || raw === '') {
      data.agencyPhone = null;
    } else {
      const trimmed = raw.trim();
      if (trimmed.length > 40) {
        return res.status(400).json({ error: 'agencyPhone must be at most 40 characters' });
      }
      data.agencyPhone = trimmed;
    }
  }
  if (parsed.data.appProjectName !== undefined) {
    const t = parsed.data.appProjectName?.trim();
    data.appProjectName = t && t.length > 0 ? t : null;
  }
  if (parsed.data.emailFromAddress !== undefined) {
    data.emailFromAddress = parsed.data.emailFromAddress?.toLowerCase().trim() ?? null;
  }
  if (parsed.data.emailFromName !== undefined) {
    data.emailFromName = parsed.data.emailFromName?.trim() ?? null;
  }
  if (parsed.data.emailSendAsDomain !== undefined) {
    data.emailSendAsDomain = parsed.data.emailSendAsDomain?.toLowerCase().trim() ?? null;
  }
  if (parsed.data.emailInboundDomain !== undefined) {
    data.emailInboundDomain = parsed.data.emailInboundDomain?.toLowerCase().trim() ?? null;
  }
  if (parsed.data.emailInboundLocalpart !== undefined) {
    data.emailInboundLocalpart = parsed.data.emailInboundLocalpart?.toLowerCase().trim() ?? null;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const sub = await prisma.subCompany.update({
    where: { id: req.params.id },
    data,
    select: agencyPublicSelect,
  });
  invalidateAgencyBrandingCache(req.params.id);
  return res.json({ data: safeSubCompanyForClient(sub) });
});

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
type LogoUploadRequest = Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } };

/** POST /users/sub-companies/:id/upload-logo — upload an image to R2 and return the CDN URL */
userRouter.post('/sub-companies/:id/upload-logo', requirePermission('settings:write'), logoUpload.single('logo'), async (req: LogoUploadRequest, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No image provided' });
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (!allowed.includes(file.mimetype)) return res.status(400).json({ error: 'Only image files are allowed' });
  const ctx = await ensureAccessContext(req);
  const isGlobalAdmin = ctx && (ctx.scopeLevel === 'global' || hasPermission(ctx, 'agencies:global'));
  const canEditLogo = ctx && canAccessMultipleAgencies(ctx);
  if (!isGlobalAdmin && req.params.id !== req.user!.subCompanyId) {
    return res.status(403).json({ error: 'You can only update your own agency' });
  }
  if (!isGlobalAdmin && !canEditLogo) {
    return res.status(403).json({ error: 'Only directors or operations managers can update the agency logo' });
  }
  const ext = file.originalname.split('.').pop() ?? 'png';
  const key = `agency-logos/${req.params.id}/${Date.now()}.${ext}`;
  const r2Url = await uploadToR2(key, file.buffer, file.mimetype);
  if (!r2Url) return res.status(500).json({ error: 'Upload failed' });
  // r2Url is either a full CDN URL (R2_PUBLIC_URL set) or the raw R2 key.
  // The frontend's resolveAgencyLogoSrc converts raw keys to the proxy URL for display,
  // so we never store the proxy URL itself (which would cause an infinite redirect loop).
  return res.json({ url: r2Url });
});

userRouter.get('/locations', requirePermission('users:read'), async (_req: Request, res: Response) => {
  const list = await prisma.location.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: list });
});

const createLocationBody = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  country: CountryEnum,
});

const updateLocationBody = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  country: CountryEnum.optional(),
});

userRouter.post('/locations', requirePermission('users:write'), async (req: Request, res: Response) => {
  const parsed = createLocationBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
  const { name, address, country } = parsed.data;
  const existing = await prisma.location.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
  if (existing) return res.status(409).json({ error: 'A location with this name already exists' });
  const location = await prisma.location.create({
    data: { name: name.trim(), address: address?.trim() || null, country },
  });
  return res.status(201).json({ data: location });
});

userRouter.patch('/locations/:id', requirePermission('users:write'), async (req: Request, res: Response) => {
  const parsed = updateLocationBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' });
  const { name, address, country } = parsed.data;
  const loc = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  if (name) {
    const dup = await prisma.location.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, id: { not: req.params.id } } });
    if (dup) return res.status(409).json({ error: 'A location with this name already exists' });
  }
  const updated = await prisma.location.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name: name.trim() }),
      ...(address !== undefined && { address: address.trim() || null }),
      ...(country && { country }),
    },
  });
  return res.json({ data: updated });
});

userRouter.delete('/locations/:id', requirePermission('users:write'), async (req: Request, res: Response) => {
  const loc = await prisma.location.findUnique({ where: { id: req.params.id } });
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  await prisma.$transaction([
    prisma.user.updateMany({ where: { locationId: req.params.id }, data: { locationId: null } }),
    prisma.location.update({ where: { id: req.params.id }, data: { isActive: false } }),
  ]);
  return res.json({ data: { success: true } });
});

const SUPER_USER_ROLES = ['super_admin', 'director', 'company_director', 'operations_manager'] as const;

/** GET /users/agency-managers — list sales managers for current agency (for lead request form). Requires leads:read so sales associates can load the dropdown. */
userRouter.get('/agency-managers', actAsMiddleware, requirePermission('leads:read'), async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId ?? null;
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const list = await prisma.user.findMany({
    where: {
      subCompanyId,
      isActive: true,
      role: 'sales_manager',
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return res.json({ data: list });
});

const agencyColleagueSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  userType: true,
  subCompany: { select: { id: true, name: true } },
} as const;

/** Messageable users for the requesting user — respects multi-agency access via Data Scope. */
async function listAgencyMessageRecipients(req: Request, subCompanyId: string, currentUserId: string | null) {
  const allowedIds = await resolveAllowedSubCompanyIds(req.user!, req);
  const agencyFilter = allowedIds.length > 0 ? allowedIds : [subCompanyId];
  const excludeSelf = { not: currentUserId ?? '' };

  const [agencyUsers, assignedOpsManagers, globalSuperUsers] = await Promise.all([
    // All users in every accessible agency
    prisma.user.findMany({
      where: { subCompanyId: { in: agencyFilter }, isActive: true, id: excludeSelf },
      select: agencyColleagueSelect,
    }),
    // Ops managers assigned to any accessible agency (they have no subCompanyId of their own)
    prisma.user.findMany({
      where: {
        isActive: true,
        role: 'operations_manager',
        id: excludeSelf,
        managedSubCompanies: { some: { subCompanyId: { in: agencyFilter } } },
      },
      select: agencyColleagueSelect,
    }),
    // Directors, company_directors, super_admins have no subCompanyId — always include globally
    prisma.user.findMany({
      where: { isActive: true, role: { in: ['director', 'company_director', 'super_admin'] }, id: excludeSelf },
      select: agencyColleagueSelect,
    }),
  ]);

  const byId = new Map<string, (typeof agencyUsers)[number]>();
  for (const u of [...agencyUsers, ...assignedOpsManagers, ...globalSuperUsers]) {
    byId.set(u.id, u);
  }
  return [...byId.values()].sort((a, b) => {
    const nameA = `${a.lastName} ${a.firstName}`.trim();
    const nameB = `${b.lastName} ${b.firstName}`.trim();
    return nameA.localeCompare(nameB);
  });
}

/** GET /users/agency-members — all messageable colleagues in the agency (Messages list + New message picker). */
userRouter.get('/agency-members', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId ?? null;
  const currentUserId = req.user?.sub ?? null;
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const list = await listAgencyMessageRecipients(req, subCompanyId, currentUserId);
  return res.json({ data: list });
});

/** GET /users/agency-share-recipients — all agency users incl. super users (snip/screenshot share picker). */
userRouter.get('/agency-share-recipients', async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId ?? null;
  const currentUserId = req.user?.sub ?? null;
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const list = await listAgencyMessageRecipients(req, subCompanyId, currentUserId);
  return res.json({ data: list });
});

/**
 * GET /users/team-members
 * Returns active users who list the requesting manager in their reportingManagerIds.
 * Only accessible by sales_manager and recruitment_manager — no users:read required.
 * Under act-as: returns the linked target's reports in their agency (effectiveActorId).
 */
userRouter.get('/team-members', actAsMiddleware, async (req: Request, res: Response) => {
  const userId = effectiveActorId(req);
  const subCompanyId = req.user?.subCompanyId;
  const actingAs = !!req.user?.actAsUserId;

  if (!userId || !subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const ctx = await ensureAccessContext(req);
  // Act-as already validated the link group; allow loading the target's team even if
  // the caller's own RBAC is own-scope (e.g. associate acting as a manager).
  if (!actingAs && (!ctx || !canViewTeamData(ctx))) {
    return res.status(403).json({ error: 'Only team managers can access team members' });
  }

  const members = await prisma.user.findMany({
    where: {
      subCompanyId,
      isActive: true,
      reportingManagerIds: { has: userId },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      country: true,
      role: true,
      userType: true,
      subCompanyId: true,
      locationId: true,
      reportingManagerIds: true,
      isActive: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  return res.json({ data: members });
});

interface SerializedHierarchyNode {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    roleLabel: string;
  };
  isUnassignedGroup: boolean;
  children: SerializedHierarchyNode[];
}

function serializeHierarchyNodes(nodes: TeamTreeNode[]): SerializedHierarchyNode[] {
  return nodes.map((n) => ({
    user: {
      id: n.user.id,
      firstName: n.user.firstName,
      lastName: n.user.lastName,
      role: n.user.role,
      roleLabel: n.user.roleLabel,
    },
    isUnassignedGroup: n.isUnassignedGroup ?? false,
    children: serializeHierarchyNodes(n.children),
  }));
}

async function subCompanyLabel(agencyId: string): Promise<{ id: string; name: string }> {
  const sub = await prisma.subCompany.findUnique({
    where: { id: agencyId },
    select: { id: true, name: true },
  });
  return { id: agencyId, name: sub?.name ?? 'Agency' };
}

async function buildAgencyHierarchySections(
  viewer: NonNullable<Request['user']>,
  agencyIds: string[],
): Promise<{ id: string; name: string; tree: SerializedHierarchyNode[] }[]> {
  const sections = await Promise.all(
    agencyIds.map(async (agencyId) => {
      const { id, name } = await subCompanyLabel(agencyId);
      const tree = await buildReportingTree(viewer, [agencyId]);
      return { id, name, tree: serializeHierarchyNodes(tree) };
    }),
  );
  return sections.filter((s) => s.tree.length > 0);
}

/**
 * GET /users/hierarchy — reporting tree for elevated roles and managers.
 * Optional ?subCompanyId= filters to one agency (elevated only).
 */
userRouter.get('/hierarchy', requirePermission('users:read'), async (req: Request, res: Response) => {
  const viewer = req.user!;
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const canViewAnyAgency = canAccessMultipleAgencies(ctx);
  const isTeamScopeOnly = isTeamScopeManagerOnly(ctx);

  if (!canAccessUserHierarchy(ctx)) {
    return res.status(403).json({ error: 'Hierarchy view is not available for your role' });
  }

  const querySubCompanyId =
    typeof req.query?.subCompanyId === 'string' ? req.query.subCompanyId.trim() : undefined;

  if (isTeamScopeOnly && querySubCompanyId) {
    return res.status(400).json({ error: 'Managers cannot filter hierarchy by agency' });
  }

  try {
    if (canViewAnyAgency && !querySubCompanyId) {
      const agencyIds = await resolveAllowedSubCompanyIds(viewer, req);
      const agencies = await buildAgencyHierarchySections(viewer, agencyIds);
      return res.json({ data: { agencies } });
    }

    if (canViewAnyAgency && querySubCompanyId) {
      const tree = await buildReportingTree(viewer, [querySubCompanyId]);
      const agency = await subCompanyLabel(querySubCompanyId);
      return res.json({
        data: {
          tree: serializeHierarchyNodes(tree),
          agency,
        },
      });
    }

    const requestedAgencyIds = querySubCompanyId ? [querySubCompanyId] : [];
    const tree = await buildReportingTree(viewer, requestedAgencyIds);
    return res.json({ data: { tree: serializeHierarchyNodes(tree) } });
  } catch (err) {
    console.error('[users/hierarchy]', err);
    return res.status(500).json({ error: 'Failed to load user hierarchy' });
  }
});

/**
 * GET /users/scope-filter?subCompanyId=
 * Users for elevated scope-filter chips (includes company_director, ops managers).
 * GET /users excludes super-user roles for the Users admin table; this endpoint
 * matches the org hierarchy used in Settings → Roles.
 * Under act-as: scopes to the linked target's agency (header + mutated subCompanyId).
 */
userRouter.get('/scope-filter', actAsMiddleware, async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const actingAs = !!req.user?.actAsUserId;
  // Act-as: link already validated; allow target-agency people chips even if caller is own-scope.
  if (!actingAs && !canAccessUserHierarchy(ctx)) {
    return res.status(403).json({ error: 'Scope filter is not available for your role' });
  }

  const querySubCompanyId =
    typeof req.query?.subCompanyId === 'string' ? req.query.subCompanyId.trim() : undefined;
  if (!querySubCompanyId) {
    return res.status(400).json({ error: 'subCompanyId is required' });
  }

  if (actingAs) {
    if (req.user?.subCompanyId !== querySubCompanyId) {
      return res.status(403).json({ error: 'Agency not in your scope' });
    }
  } else {
    const allowed = await resolveAllowedSubCompanyIds(req.user!);
    if (!allowed.includes(querySubCompanyId)) {
      return res.status(403).json({ error: 'Agency not in your scope' });
    }
  }

  try {
    const list = await fetchScopeFilterMembers(querySubCompanyId);
    return res.json({ data: list });
  } catch (err) {
    console.error('[users/scope-filter]', err);
    return res.status(500).json({ error: 'Failed to load scope filter users' });
  }
});

userRouter.get('/', actAsMiddleware, requirePermission('users:read'), async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  // Under act-as: team filter uses linked target; agency comes from mutated subCompanyId.
  const actorUserId = effectiveActorId(req);
  const actorSubCompanyId = req.user?.subCompanyId ?? null;
  const canViewAnyAgency = canAccessMultipleAgencies(ctx);
  const isTeamScopeOnly = isTeamScopeManagerOnly(ctx);
  const querySubCompanyId = typeof req.query?.subCompanyId === 'string' ? req.query.subCompanyId.trim() : undefined;
  const scope = canViewAnyAgency && querySubCompanyId ? querySubCompanyId : actorSubCompanyId;

  const list = await prisma.user.findMany({
    where: {
      role: { notIn: [...SUPER_USER_ROLES, 'database_manager'] },
      ...(scope ? { subCompanyId: scope } : {}),
      ...(isTeamScopeOnly && actorUserId ? { reportingManagerIds: { has: actorUserId } } : {}),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      subCompanyId: true,
      locationId: true,
      country: true,
      phone: true,
      isActive: true,
      dailyCallsTarget: true,
      dailyEmailsTarget: true,
      dailyMeetingScheduleTarget: true,
      reportingManagerIds: true,
      accessibleLocationIds: true,
      workStartTime: true,
      workEndTime: true,
      canActAsAdmin: true,
      offboardingStartedAt: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return res.json({ data: list });
});

/**
 * GET /users/for-linking?subCompanyId=<id>
 * Returns active users in the specified agency for the agency-link picker UI.
 * Requires users:link_agency. Excludes users who are already in a link group.
 */
userRouter.get('/for-linking', requirePermission('users:link_agency'), async (req: Request, res: Response) => {
  const subCompanyId = typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId.trim() : undefined;
  if (!subCompanyId) {
    return res.status(400).json({ error: 'subCompanyId is required' });
  }

  // Find all userIds that already belong to any link group
  const linked = await prisma.userAgencyLink.findMany({ select: { userId: true } });
  const linkedUserIds = linked.map((l) => l.userId);

  const users = await prisma.user.findMany({
    where: {
      subCompanyId,
      isActive: true,
      offboardingStartedAt: null,
      id: { notIn: linkedUserIds },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      subCompanyId: true,
      isActive: true,
      subCompany: { select: { name: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const scopeByRole = new Map<string, string>();
  await Promise.all(
    [...new Set(users.map((u) => u.role))].map(async (role) => {
      const [scopeFromDb, permissions] = await Promise.all([
        getDataScopeLevelForRoleKey(role),
        getEffectivePermissionKeysForRoleKey(role),
      ]);
      scopeByRole.set(role, resolveEffectiveScopeLevel(role, scopeFromDb, permissions));
    }),
  );

  return res.json(
    users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      subCompanyId: u.subCompanyId,
      subCompanyName: u.subCompany?.name ?? '',
      isActive: u.isActive,
      dataScopeLevel: scopeByRole.get(u.role),
    })),
  );
});

/**
 * GET /users/ownership-candidates
 * Returns active users whose role does NOT have the `clients:ownership` permission.
 * Uses role_permissions table — no hardcoded role names.
 */
userRouter.get('/ownership-candidates', requirePermission('clients:ownership'), async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });

  // Find all role keys that currently hold clients:ownership (from DB, not hardcoded)
  const rolesWithOwnership = await prisma.rolePermission.findMany({
    where: { permission: { key: 'clients:ownership' } },
    select: { role: { select: { key: true } } },
  });
  const ownershipRoleKeys = rolesWithOwnership.map((r) => r.role.key);

  const actorSubCompanyId = req.user?.subCompanyId ?? null;
  const canViewAnyAgency = canAccessMultipleAgencies(ctx);
  const querySubCompanyId = typeof req.query?.subCompanyId === 'string' ? req.query.subCompanyId.trim() : undefined;
  const scope = canViewAnyAgency && querySubCompanyId ? querySubCompanyId : actorSubCompanyId;

  const list = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { notIn: ownershipRoleKeys },
      ...(scope ? { subCompanyId: scope } : {}),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      subCompanyId: true,
      isActive: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return res.json({ data: list });
});

/** Roles shown on Super Users page (directors and operations managers only; super_admin is hidden) */
const SUPER_USERS_PAGE_ROLES = ['director', 'company_director', 'operations_manager'] as const;

userRouter.get('/super', requirePermission('users:read', 'agencies:cross_org'), async (_req: Request, res: Response) => {
  const list = await prisma.user.findMany({
    where: { role: { in: [...SUPER_USERS_PAGE_ROLES] } },
    include: {
      managedSubCompanies: { select: { subCompanyId: true, agencyEmail: true }, orderBy: { subCompanyId: 'asc' } },
    },
    orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  });
  const data = list.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    userType: u.userType,
    subCompanyId: u.subCompanyId,
    isActive: u.isActive,
    managedAgencies: u.role === 'operations_manager'
      ? u.managedSubCompanies.map((m) => ({ subCompanyId: m.subCompanyId, agencyEmail: m.agencyEmail }))
      : [],
    managedSubCompanyIds: u.role === 'operations_manager' ? u.managedSubCompanies.map((m) => m.subCompanyId) : [],
  }));
  res.json({ data });
});

const managedAgencyEntry = z.object({
  subCompanyId: z.string().uuid(),
  agencyEmail:  z.string().email().optional(),
});

const createSuperUserBody = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['director', 'company_director', 'operations_manager']),
  subCompanyId: z.string().uuid().optional(),
  managedAgencies: z.array(managedAgencyEntry).optional(),
});

async function validateAgencyEmails(
  emails: string[],
  primaryEmail: string,
  excludeUserId?: string,
): Promise<{ error: string } | null> {
  // Exclude the OM's own login email — they're allowed to use it as their sending email
  const emailsToCheck = emails.filter((e) => e !== primaryEmail);
  if (emailsToCheck.length) {
    const userConflict = await prisma.user.findFirst({
      where: { email: { in: emailsToCheck } },
      select: { email: true },
    });
    if (userConflict) return { error: `${userConflict.email} is already a user account` };
  }

  const omConflict = await prisma.operationsManagerSubCompany.findFirst({
    where: {
      agencyEmail: { in: emails },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { agencyEmail: true },
  });
  if (omConflict) return { error: `${omConflict.agencyEmail} is already assigned to another Operations Manager` };

  return null;
}

userRouter.post('/super', requirePermission('users:write', 'agencies:cross_org'), async (req: Request, res: Response) => {
  const parsed = createSuperUserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { email, firstName, lastName, role, subCompanyId: bodySubCompanyId, managedAgencies } = parsed.data;
  const primaryEmail = email.toLowerCase().trim();

  if (role === 'operations_manager') {
    if (!managedAgencies?.length) {
      return res.status(400).json({ error: 'Operations Manager must have at least one agency assigned' });
    }
    const subCompanyIds = managedAgencies.map((a) => a.subCompanyId);
    const subsExist = await prisma.subCompany.findMany({
      where: { id: { in: subCompanyIds } },
      select: { id: true },
    });
    if (subsExist.length !== subCompanyIds.length) {
      return res.status(400).json({ error: 'One or more selected agencies are invalid' });
    }

    const agencyEmails = managedAgencies
      .map((a) => a.agencyEmail?.toLowerCase().trim())
      .filter(Boolean) as string[];
    if (agencyEmails.length) {
      const emailErr = await validateAgencyEmails(agencyEmails, primaryEmail);
      if (emailErr) return res.status(409).json(emailErr);
    }
  }

  if (role === 'company_director') {
    const agencyId =
      bodySubCompanyId ??
      (managedAgencies?.length === 1 ? managedAgencies[0].subCompanyId : undefined);
    if (!agencyId) {
      return res.status(400).json({ error: 'Company Director must be assigned to exactly one agency' });
    }
    if (managedAgencies && managedAgencies.length > 1) {
      return res.status(400).json({ error: 'Company Director can only be assigned to one agency' });
    }
    const subExists = await prisma.subCompany.findUnique({ where: { id: agencyId }, select: { id: true } });
    if (!subExists) {
      return res.status(400).json({ error: 'Selected agency is invalid' });
    }
    const cdConflict = await validateNewCompanyDirectorForAgency(agencyId);
    if (cdConflict) return res.status(409).json({ error: cdConflict });
  }

  const existing = await prisma.user.findUnique({ where: { email: primaryEmail } });
  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const firstSub = await prisma.subCompany.findFirst({ orderBy: { name: 'asc' } });
  if (!firstSub) {
    return res.status(400).json({ error: 'No agency exists. Create at least one agency first.' });
  }

  let subCompanyId: string | null;
  if (role === 'operations_manager' || role === 'director') {
    subCompanyId = null;
  } else if (role === 'company_director') {
    subCompanyId =
      bodySubCompanyId ??
      (managedAgencies?.length === 1 ? managedAgencies[0].subCompanyId : firstSub.id);
  } else {
    subCompanyId = firstSub.id;
  }

  const tempPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);
  const userType =
    role === 'director'
      ? 'Director'
      : role === 'company_director'
        ? 'Company Director'
        : 'Operations Manager';

  const reportingManagerIds =
    role === 'company_director' && subCompanyId
      ? await resolveCompanyDirectorReportingIds(subCompanyId)
      : [];

  const user = await prisma.user.create({
    data: {
      email: primaryEmail,
      passwordHash,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: null,
      country: 'Canada',
      role,
      userType,
      ...(subCompanyId ? { subCompanyId } : {}),
      locationId: null,
      reportingManagerIds,
      accessibleLocationIds: [],
      dailyCallsTarget: 0,
      dailyEmailsTarget: 0,
      isActive: true,
    } as unknown as Prisma.UserUncheckedCreateInput,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      subCompanyId: true,
      isActive: true,
    },
  });

  if (role === 'operations_manager' && managedAgencies!.length > 0) {
    await prisma.operationsManagerSubCompany.deleteMany({ where: { userId: user.id } });
    await prisma.operationsManagerSubCompany.createMany({
      data: managedAgencies!.map(({ subCompanyId: subId, agencyEmail }) => ({
        userId: user.id,
        subCompanyId: subId,
        agencyEmail: agencyEmail?.toLowerCase().trim() ?? null,
      })),
      skipDuplicates: true,
    });
  }

  if (role === 'company_director') {
    const { patchAgencyApprovalRoutesForCompanyDirector } = await import('../services/approvalPolicy');
    await patchAgencyApprovalRoutesForCompanyDirector(subCompanyId!).catch((err) => {
      console.error('[users/super] Failed to patch approval routes for company_director:', err);
    });
    await repointSalesManagersToCompanyDirector(subCompanyId!).catch((err) => {
      console.error('[users/super] Failed to repoint sales managers for company_director:', err);
    });
  }

  ensureStaffExtensionForUser({
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    subCompanyId: user.subCompanyId,
  }).catch((err) => {
    console.error('[users/super] Failed to assign staff extension for', user.email, err);
  });

  // For roles with no subCompanyId (director, operations_manager), fall back to first managed agency branding, then first agency in the system
  const agencySubId = user.subCompanyId ?? managedAgencies?.[0]?.subCompanyId ?? firstSub?.id ?? null;
  const agency = await getAgencyBranding(agencySubId);
  sendWelcomeWithPassword(user.email, user.firstName, tempPassword, agency).catch((err) => {
    console.error('Failed to send welcome email to', user.email, err);
  });

  const savedAgencies = role === 'operations_manager' && managedAgencies!.length > 0
    ? managedAgencies!.map(({ subCompanyId: subId, agencyEmail }) => ({
        subCompanyId: subId,
        agencyEmail: agencyEmail ?? null,
      }))
    : [];
  return res.status(201).json({
    ...user,
    managedAgencies: savedAgencies,
    // backward-compat field
    managedSubCompanyIds: savedAgencies.map((a) => a.subCompanyId),
  });
});

/** PATCH /users/super/:id — update name/email of a super user (super_admin only). */
userRouter.patch('/super/:id', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  if (!ctx || ctx.roleKey !== 'super_admin') {
    return res.status(403).json({ error: 'Only Super Admin can edit super users' });
  }
  const { id } = req.params;
  const parsed = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { firstName, lastName, email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!user || !SUPER_USERS_PAGE_ROLES.includes(user.role as typeof SUPER_USERS_PAGE_ROLES[number])) {
    return res.status(404).json({ error: 'Super user not found' });
  }
  const conflict = await prisma.user.findFirst({ where: { email: email.toLowerCase().trim(), id: { not: id } }, select: { id: true } });
  if (conflict) return res.status(400).json({ error: 'Email is already in use by another account' });
  const updated = await prisma.user.update({
    where: { id },
    data: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.toLowerCase().trim() },
  });
  return res.json({ id: updated.id, firstName: updated.firstName, lastName: updated.lastName, email: updated.email });
});

/** DELETE /users/super/:id — delete a super user (super_admin only). Cannot delete self. */
userRouter.delete('/super/:id', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  if (!ctx || ctx.roleKey !== 'super_admin') {
    return res.status(403).json({ error: 'Only Super Admin can delete super users' });
  }
  const { id } = req.params;
  if (id === ctx.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!user || !SUPER_USERS_PAGE_ROLES.includes(user.role as typeof SUPER_USERS_PAGE_ROLES[number])) {
    return res.status(404).json({ error: 'Super user not found' });
  }
  await prisma.$transaction(async (tx) => {
    // Delete activity sessions (events have no cascade from session)
    const sessions = await tx.userActivitySession.findMany({ where: { userId: id }, select: { id: true } });
    if (sessions.length) {
      await tx.userActivityEvent.deleteMany({ where: { sessionId: { in: sessions.map(s => s.id) } } });
      await tx.userActivitySession.deleteMany({ where: { userId: id } });
    }
    await tx.activityLog.deleteMany({ where: { userId: id } });
    await tx.clientNote.deleteMany({ where: { userId: id } });
    await tx.user.delete({ where: { id } });
  });
  return res.json({ success: true });
});

const createDatabaseManagerBody = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  reportingManagerIds: z.array(z.string().uuid()).optional(),
});

/** GET /users/database-managers — list org-global database managers (Super Admin). */
userRouter.get('/database-managers', requirePermission('users:read', 'agencies:global'), async (_req: Request, res: Response) => {
  const list = await prisma.user.findMany({
    where: { role: 'database_manager' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      subCompanyId: true,
      isActive: true,
      reportingManagerIds: true,
      createdAt: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return res.json({ data: list });
});

/** POST /users/database-managers — create database manager (Super Admin only). */
userRouter.post('/database-managers', requirePermission('agencies:global'), async (req: Request, res: Response) => {
  const ctx = await ensureAccessContext(req);
  if (!ctx || ctx.roleKey !== 'super_admin') {
    return res.status(403).json({ error: 'Only Super Admin can create Database Managers' });
  }
  const parsed = createDatabaseManagerBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { email, firstName, lastName, reportingManagerIds } = parsed.data;
  const primaryEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email: primaryEmail } });
  if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

  const rbacRole = await getActiveRbacRoleByKey('database_manager');
  if (!rbacRole) return res.status(400).json({ error: 'Database Manager role is not configured' });

  const tempPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email: primaryEmail,
      passwordHash,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: null,
      country: 'Canada',
      role: 'database_manager',
      roleId: rbacRole.id,
      userType: 'Database Manager',
      locationId: null,
      reportingManagerIds: reportingManagerIds ?? [],
      accessibleLocationIds: [],
      dailyCallsTarget: 0,
      dailyEmailsTarget: 0,
      isActive: true,
    } as unknown as Prisma.UserUncheckedCreateInput,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      subCompanyId: true,
      isActive: true,
      reportingManagerIds: true,
    },
  });

  const agency = await getAgencyBranding(
    (await prisma.subCompany.findFirst({ select: { id: true }, orderBy: { name: 'asc' } }))?.id ?? null,
  );
  sendWelcomeWithPassword(user.email, user.firstName, tempPassword, agency).catch((err) => {
    console.error('Failed to send welcome email to', user.email, err);
  });

  return res.status(201).json({ data: user, tempPassword });
});

userRouter.post('/', requirePermission('users:write'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = createUserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
  const actorUserId = req.user?.sub;
  const actorSubCompanyId = req.user?.subCompanyId ?? '';
  const canCreateAcrossAgencies = canAccessMultipleAgencies(ctx);
  const isTeamScopeOnly = isTeamScopeManagerOnly(ctx);

  if ((SUPER_USER_ROLES as readonly string[]).includes(data.role)) {
    return res.status(400).json({
      error: 'Super Admin, Director, Company Director, and Operations Manager must be created from the Super Users screen.',
    });
  }
  if (data.role === 'database_manager') {
    return res.status(400).json({
      error: 'Database Managers must be created from the Super Users screen.',
    });
  }
  if (data.role === 'dev_team') {
    const canAssignPrivileged = hasPermission(ctx, 'agencies:global') || ctx.roleKey === 'super_admin';
    if (!canAssignPrivileged) {
      return res.status(403).json({ error: 'Only Super Admin can create Dev Team users' });
    }
  }
  if (isTeamScopeOnly) {
    const allowedRoles = await getOwnScopeChildRoleKeys(ctx.roleKey);
    if (!allowedRoles.includes(data.role)) {
      return res.status(403).json({ error: 'You can only create users in roles assigned to your team' });
    }
  }
  const subCompanyId: string | null = isAgencyIndependentRole(data.role)
    ? null
    : canCreateAcrossAgencies
      ? (data.subCompanyId ?? null)
      : (actorSubCompanyId || null);
  if (!isAgencyIndependentRole(data.role)) {
    if (!subCompanyId) {
      return res.status(400).json({ error: 'subCompanyId is required for this role' });
    }
    if (canCreateAcrossAgencies) {
      const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user, req);
      if (!allowedSubCompanyIds.includes(subCompanyId)) {
        return res.status(403).json({ error: 'Cannot create user in an agency you cannot access' });
      }
    } else if (data.subCompanyId !== actorSubCompanyId) {
      return res.status(403).json({ error: 'Cannot create user in another sub-company' });
    }
  }

  const passwordCheck = validatePasswordFormat(data.password);
  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.message });
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase().trim() } });
  if (existing) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }
  if (!isAllowedEmailDomain(data.email)) {
    // Super / multi-agency roles may use SendGrid-authenticated personal domains.
    const createDomains = await domainsForSendAs(data.role, null);
    const emailDomain = data.email.split('@')[1]?.toLowerCase();
    if (createDomains.length > 0 && (!emailDomain || !createDomains.includes(emailDomain))) {
      return res.status(400).json({ error: `Email domain must be one of: ${createDomains.join(', ')}` });
    }
    if (createDomains.length === 0 && allowedDomains.length > 0) {
      return res.status(400).json({ error: `Email domain must be one of: ${allowedDomains.join(', ')}` });
    }
  }

  const rbacRole = await getActiveRbacRoleByKey(data.role);
  if (!rbacRole) {
    return res.status(400).json({ error: `Unknown or inactive role: ${data.role}` });
  }

  const passwordHash = await hashPassword(data.password);
  let baseManagerIds = data.reportingManagerIds ?? [];
  if (rbacRole.key === 'sales_manager' && subCompanyId) {
    baseManagerIds = await resolveSalesManagerReportingIds(subCompanyId, baseManagerIds);
    const smReportingErr = await validateSalesManagerReporting(subCompanyId, baseManagerIds);
    if (smReportingErr) return res.status(400).json({ error: smReportingErr });
  }
  const reportingManagerIds = isTeamScopeOnly && actorUserId && !baseManagerIds.includes(actorUserId)
    ? [...baseManagerIds, actorUserId]
    : baseManagerIds;

  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase().trim(),
      passwordHash,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      phone: data.phone?.trim() || null,
      country: data.country,
      role: rbacRole.key,
      roleId: rbacRole.id,
      userType: data.userType.trim(),
      ...(subCompanyId ? { subCompanyId } : {}),
      locationId: isAgencyIndependentRole(data.role) ? null : (data.locationId || null),
      reportingManagerIds,
      accessibleLocationIds: [],
      dailyCallsTarget: data.dailyCallsTarget ?? 0,
      dailyEmailsTarget: data.dailyEmailsTarget ?? 0,
      dailyMeetingScheduleTarget: data.dailyMeetingScheduleTarget ?? 0,
      isActive: data.isActive ?? true,
      workStartTime: data.workStartTime ?? '09:00',
      workEndTime: data.workEndTime ?? '17:00',
    } as unknown as Prisma.UserUncheckedCreateInput,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      subCompanyId: true,
      locationId: true,
      isActive: true,
      workStartTime: true,
      workEndTime: true,
    },
  });
  ensureStaffExtensionForUser({
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    subCompanyId: user.subCompanyId,
  }).catch((err) => {
    console.error('[users] Failed to assign staff extension for', user.email, err);
  });
  const agency = await getAgencyBranding(user.subCompanyId);
  sendWelcomeWithPassword(user.email, user.firstName, data.password, agency).catch((err) => {
    console.error('Failed to send welcome email to', user.email, err);
  });
  return res.status(201).json(user);
});

const managedAgenciesBody = z.object({
  managedAgencies: z.array(managedAgencyEntry).min(0),
});

userRouter.patch('/:id/managed-agencies', requirePermission('users:write', 'agencies:cross_org'), async (req: Request, res: Response) => {
  const parsed = managedAgenciesBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  }
  const userId = req.params.id;
  const { managedAgencies } = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, subCompanyId: true },
  });
  if (!existing) return res.status(404).json({ error: 'User not found' });
  if (existing.role !== 'operations_manager') {
    return res.status(400).json({ error: 'Managed agencies can only be set for operations managers' });
  }

  const agencyEmails = managedAgencies
    .map((a) => a.agencyEmail?.toLowerCase().trim())
    .filter(Boolean) as string[];
  if (agencyEmails.length) {
    const emailErr = await validateAgencyEmails(agencyEmails, existing.email, userId);
    if (emailErr) return res.status(409).json(emailErr);
  }

  await prisma.operationsManagerSubCompany.deleteMany({ where: { userId } });
  if (managedAgencies.length > 0) {
    await prisma.operationsManagerSubCompany.createMany({
      data: managedAgencies.map(({ subCompanyId, agencyEmail }) => ({
        userId,
        subCompanyId,
        agencyEmail: agencyEmail?.toLowerCase().trim() ?? null,
      })),
      skipDuplicates: true,
    });
  }

  void clearAgencyScopeCache(userId);

  const updated = await prisma.operationsManagerSubCompany.findMany({
    where: { userId },
    select: { subCompanyId: true, agencyEmail: true },
  });
  return res.json({
    managedAgencies: updated.map((r) => ({ subCompanyId: r.subCompanyId, agencyEmail: r.agencyEmail })),
    // backward-compat field
    managedSubCompanyIds: updated.map((r) => r.subCompanyId),
  });
});

async function canAdminManageUser(req: Request, targetSubCompanyId: string | null): Promise<boolean> {
  if (!req.user) return false;
  const ctx = await ensureAccessContext(req);
  if (ctx && canAccessMultipleAgencies(ctx)) {
    if (!targetSubCompanyId) return true;
    const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user);
    return allowedSubCompanyIds.includes(targetSubCompanyId);
  }
  const actorSubCompanyId = req.user.subCompanyId ?? null;
  if (!targetSubCompanyId || !actorSubCompanyId) return false;
  return targetSubCompanyId === actorSubCompanyId;
}

const adminSetPasswordBody = z.object({
  newPassword: z.string().min(1, 'Password is required'),
});

userRouter.post('/:id/admin-set-password', requirePermission('users:write'), async (req: Request, res: Response) => {
  const parsed = adminSetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const userId = req.params.id;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, subCompanyId: true, email: true, firstName: true },
  });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!(await canAdminManageUser(req, target.subCompanyId))) {
    return res.status(403).json({ error: 'You cannot change this user\'s password' });
  }
  const passwordCheck = validatePasswordFormat(parsed.data.newPassword);
  if (!passwordCheck.ok) {
    return res.status(400).json({ error: passwordCheck.message });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
  return res.json({ message: 'Password updated successfully' });
});

userRouter.post('/:id/admin-send-reset-email', requirePermission('users:write'), async (req: Request, res: Response) => {
  const userId = req.params.id;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, subCompanyId: true, email: true, firstName: true },
  });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!(await canAdminManageUser(req, target.subCompanyId))) {
    return res.status(403).json({ error: 'You cannot send reset email for this user' });
  }
  const resetToken = jwt.sign(
    { sub: target.id, type: 'password_reset' },
    env.JWT_SECRET,
    { expiresIn: getResetExpiresIn() } as jwt.SignOptions
  );
  const agency = await getAgencyBranding(target.subCompanyId);
  await sendPasswordResetEmail(target.email, target.firstName, resetToken, agency);
  return res.json({ message: 'Password reset email sent' });
});

userRouter.patch('/:id', requirePermission('users:write', 'users:delete'), async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const parsed = updateUserBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const userId = req.params.id;
  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized' });

  const touchesActiveStatus = data.isActive !== undefined;
  const touchesUserDetails =
    data.firstName !== undefined ||
    data.lastName !== undefined ||
    data.phone !== undefined ||
    data.country !== undefined ||
    data.role !== undefined ||
    data.userType !== undefined ||
    data.subCompanyId !== undefined ||
    data.locationId !== undefined ||
    data.reportingManagerIds !== undefined ||
    data.dailyCallsTarget !== undefined ||
    data.dailyEmailsTarget !== undefined ||
    data.dailyMeetingScheduleTarget !== undefined ||
    data.dailyTasksTarget !== undefined ||
    data.dailyFollowUpsTarget !== undefined ||
    data.password !== undefined ||
    data.workStartTime !== undefined ||
    data.workEndTime !== undefined ||
    data.sendAsEmail !== undefined ||
    data.sendAsDisabled !== undefined ||
    data.canActAsAdmin !== undefined;

  if (touchesUserDetails && !hasPermission(ctx, 'users:write')) {
    return res.status(403).json({ error: 'Permission denied: users:write required to edit users' });
  }
  if (
    touchesActiveStatus &&
    !hasPermission(ctx, 'users:write') &&
    !hasPermission(ctx, 'users:delete')
  ) {
    return res.status(403).json({ error: 'Permission denied: users:delete or users:write required to change user status' });
  }

  const actorSubCompanyId = req.user?.subCompanyId ?? '';
  const canManageAcrossAgencies = canAccessMultipleAgencies(ctx);

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, subCompanyId: true, role: true, reportingManagerIds: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!(await canAdminManageUser(req, existing.subCompanyId))) {
    return res.status(403).json({ error: 'Cannot update user in another sub-company' });
  }
  if (data.role && (SUPER_USER_ROLES as readonly string[]).includes(data.role)) {
    return res.status(400).json({
      error: 'Super Admin, Director, Company Director, and Operations Manager must be managed from the Super Users screen.',
    });
  }
  if (data.role === 'dev_team') {
    const canAssignPrivileged = hasPermission(ctx, 'agencies:global') || ctx.roleKey === 'super_admin';
    if (!canAssignPrivileged) {
      return res.status(403).json({ error: 'Only Super Admin can assign Dev Team role' });
    }
  }
  if (isTeamScopeManagerOnly(ctx) && data.role !== undefined) {
    const allowedRoles = await getOwnScopeChildRoleKeys(ctx.roleKey);
    if (!allowedRoles.includes(data.role)) {
      return res.status(403).json({ error: 'You can only assign roles assigned to your team' });
    }
  }
  if (data.subCompanyId && canManageAcrossAgencies) {
    const allowedSubCompanyIds = await resolveAllowedSubCompanyIds(req.user, req);
    if (!allowedSubCompanyIds.includes(data.subCompanyId)) {
      return res.status(403).json({ error: 'Cannot assign user to an agency you cannot access' });
    }
  } else if (data.subCompanyId && data.subCompanyId !== actorSubCompanyId) {
    return res.status(403).json({ error: 'Cannot assign user to another sub-company' });
  }
  let roleUpdate: { role: string; roleId: string } | undefined;
  if (data.role !== undefined) {
    const rbacRole = await getActiveRbacRoleByKey(data.role);
    if (!rbacRole) {
      return res.status(400).json({ error: `Unknown or inactive role: ${data.role}` });
    }
    roleUpdate = { role: rbacRole.key, roleId: rbacRole.id };
  }
  if (data.password) {
    const passwordCheck = validatePasswordFormat(data.password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.message });
    }
  }
  if (data.sendAsEmail) {
    const existingForDomain = await prisma.user.findUnique({
      where: { id: userId },
      select: { subCompanyId: true, role: true },
    });
    const agencyBranding = existingForDomain?.subCompanyId
      ? await getAgencyBranding(existingForDomain.subCompanyId)
      : undefined;
    const agencyDomain = agencyBranding?.emailSendAsDomain ?? null;
    const effectiveRole = data.role ?? existingForDomain?.role;
    const effectiveDomains = await domainsForSendAs(effectiveRole, agencyDomain);
    const emailDomain = data.sendAsEmail.split('@')[1]?.toLowerCase();
    if (effectiveDomains.length > 0 && (!emailDomain || !effectiveDomains.includes(emailDomain))) {
      return res.status(400).json({ error: `Email domain must be one of: ${effectiveDomains.join(', ')}` });
    }
  }

  const effectiveRole = data.role ?? existing.role;
  const effectiveSubCompanyId = data.subCompanyId ?? existing.subCompanyId;
  if (isAgencyIndependentRole(effectiveRole) && data.subCompanyId) {
    return res.status(400).json({ error: 'This role is org-wide and cannot be assigned to an agency' });
  }
  let resolvedReportingManagerIds: string[] | undefined;
  if (effectiveRole === 'sales_manager' && effectiveSubCompanyId) {
    if (data.reportingManagerIds !== undefined) {
      resolvedReportingManagerIds = await resolveSalesManagerReportingIds(
        effectiveSubCompanyId,
        data.reportingManagerIds,
      );
      const smReportingErr = await validateSalesManagerReporting(
        effectiveSubCompanyId,
        resolvedReportingManagerIds,
      );
      if (smReportingErr) return res.status(400).json({ error: smReportingErr });
    } else if (data.role === 'sales_manager' && existing.role !== 'sales_manager') {
      resolvedReportingManagerIds = await resolveSalesManagerReportingIds(effectiveSubCompanyId, []);
      const smReportingErr = await validateSalesManagerReporting(
        effectiveSubCompanyId,
        resolvedReportingManagerIds,
      );
      if (smReportingErr) return res.status(400).json({ error: smReportingErr });
    } else if (
      data.subCompanyId !== undefined &&
      data.subCompanyId !== existing.subCompanyId
    ) {
      resolvedReportingManagerIds = await resolveSalesManagerReportingIds(
        effectiveSubCompanyId,
        data.reportingManagerIds ?? existing.reportingManagerIds,
      );
      const smReportingErr = await validateSalesManagerReporting(
        effectiveSubCompanyId,
        resolvedReportingManagerIds,
      );
      if (smReportingErr) return res.status(400).json({ error: smReportingErr });
    }
  } else if (data.reportingManagerIds !== undefined) {
    resolvedReportingManagerIds = data.reportingManagerIds;
  }

  const updatePayload: Record<string, unknown> = {
    ...(data.firstName !== undefined && { firstName: data.firstName.trim() }),
    ...(data.lastName !== undefined && { lastName: data.lastName.trim() }),
    ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
    ...(data.country !== undefined && { country: data.country }),
    ...(roleUpdate ?? {}),
    ...(data.userType !== undefined && { userType: data.userType.trim() }),
    ...(data.subCompanyId !== undefined && { subCompanyId: data.subCompanyId }),
    ...(data.locationId !== undefined && { locationId: data.locationId }),
    ...(resolvedReportingManagerIds !== undefined && { reportingManagerIds: resolvedReportingManagerIds }),
    ...(data.dailyCallsTarget !== undefined && { dailyCallsTarget: data.dailyCallsTarget }),
    ...(data.dailyEmailsTarget !== undefined && { dailyEmailsTarget: data.dailyEmailsTarget }),
    ...(data.dailyMeetingScheduleTarget !== undefined && { dailyMeetingScheduleTarget: data.dailyMeetingScheduleTarget }),
    ...(data.isActive !== undefined && { isActive: data.isActive }),
    ...(data.workStartTime !== undefined && { workStartTime: data.workStartTime }),
    ...(data.workEndTime !== undefined && { workEndTime: data.workEndTime }),
    ...(data.sendAsEmail !== undefined && { sendAsEmail: data.sendAsEmail ? data.sendAsEmail.toLowerCase().trim() : null }),
    ...(data.sendAsDisabled !== undefined && { sendAsDisabled: data.sendAsDisabled }),
    ...(data.canActAsAdmin !== undefined && ctx.roleKey === 'super_admin' && { canActAsAdmin: data.canActAsAdmin }),
  };
  if (data.password) {
    updatePayload.passwordHash = await hashPassword(data.password);
  }
  if (isAgencyIndependentRole((roleUpdate?.role ?? existing.role) as string)) {
    updatePayload.subCompanyId = null;
    updatePayload.locationId = null;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updatePayload as never,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      userType: true,
      subCompanyId: true,
      locationId: true,
      isActive: true,
      canActAsAdmin: true,
      workStartTime: true,
      workEndTime: true,
    },
  });

  // Invalidate agency scope cache if role or agency changed
  if (data.role !== undefined || data.subCompanyId !== undefined) {
    void clearAgencyScopeCache(userId);
  }

  return res.json(user);
});

/**
 * POST /users/sync-default-targets
 * For each user in the agency whose stored target fields are 0,
 * apply the current agency performance-target settings as the baseline.
 * Idempotent — safe to call multiple times.
 */
userRouter.post('/sync-default-targets', requirePermission('users:write'), async (req: Request, res: Response) => {
  const subCompanyId = req.user?.subCompanyId;
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const today = new Date();

  // Fetch current active targets per role for this agency
  const targetRows = await prisma.performanceTarget.findMany({
    where: { subCompanyId, effectiveFrom: { lte: today } },
    orderBy: { effectiveFrom: 'desc' },
    select: { role: true, callsTarget: true, emailsTarget: true, meetingScheduleCountTarget: true },
  });

  // Keep only the most recent target per role
  const latestByRole = new Map<string, { callsTarget: number; emailsTarget: number; meetingScheduleCountTarget: number }>();
  for (const row of targetRows) {
    if (!latestByRole.has(row.role)) latestByRole.set(row.role, row);
  }

  if (latestByRole.size === 0) return res.json({ updated: 0 });

  const results = await Promise.all(
    Array.from(latestByRole.entries()).map(([role, target]) =>
      prisma.user.updateMany({
        where: { subCompanyId, role: role as never },
        data: {
          dailyCallsTarget: target.callsTarget,
          dailyEmailsTarget: target.emailsTarget,
          dailyMeetingScheduleTarget: target.meetingScheduleCountTarget,
        },
      })
    )
  );
  const updated = results.reduce((sum, r) => sum + r.count, 0);

  return res.json({ updated });
});
