/**
 * Bug reports: submit (bug_reports:submit), list/close (bug_reports:read).
 * On submit: email to BugReportRecipient list, notifications to admins.
 * On close: email to submitter, notification to submitter.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { attachAccessContext } from '../utils/requestPermission';
import { getUserIdsWithPermissionInAgency } from '../services/accessContext';
import { buildSubCompanyFilter, resolveAllowedSubCompanyIds, canAccessSubCompanyResource } from '../config/agencyScope';
import { uploadToR2, getFromR2 } from '../services/r2Storage';
import { sendBugReportEmail, sendBugResolvedEmail, getAgencyBranding } from '../services/email';
import { dispatchNotification, dispatchNotificationToUser } from '../services/notificationDispatch';
import { env } from '../config/env';

const createBodySchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().min(1).max(10000),
  screenshotBase64: z.string().optional(),
  mimeType: z.string().max(128).optional(),
  pageUrl: z.string().max(2000).optional(),
  userAgent: z.string().max(1000).optional(),
});

const closeBodySchema = z.object({
  status: z.literal('closed'),
  resolutionRemarks: z.string().min(1).max(5000),
});

export const bugReportsRouter = Router();
bugReportsRouter.use(authenticate);
bugReportsRouter.use(attachAccessContext);

/** POST / — submit a bug report (bug_reports:submit). */
bugReportsRouter.post('/', requirePermission('bug_reports:submit'), async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  const subCompanyId = req.user?.subCompanyId;
  if (!userId || !subCompanyId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const { title, description, screenshotBase64, mimeType, pageUrl, userAgent } = parsed.data;

  let screenshotUrl: string | null = null;
  if (screenshotBase64) {
    const maxSize = 5 * 1024 * 1024; // 5MB for screenshot
    let buffer: Buffer;
    try {
      buffer = Buffer.from(screenshotBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 screenshot' });
    }
    if (buffer.length > maxSize) {
      return res.status(400).json({ error: 'Screenshot too large (max 5MB)' });
    }
    const contentType = mimeType ?? 'image/png';
    const key = `bug-screenshots/${userId}/${Date.now()}-screenshot.png`;
    screenshotUrl = await uploadToR2(key, buffer, contentType);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true },
  });
  const reporterName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email : 'Unknown';
  const reporterEmail = user?.email ?? '';

  const bug = await prisma.bugReport.create({
    data: {
      submittedById: userId,
      subCompanyId,
      title: title?.trim() || null,
      description: description.trim(),
      screenshotUrl,
      metadata:
        pageUrl || userAgent
          ? { pageUrl: pageUrl ?? null, userAgent: userAgent ?? null }
          : undefined,
    },
    include: {
      submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const reportUrl = env.FRONTEND_URL ? `${env.FRONTEND_URL.replace(/\/$/, '')}/bug-reports` : undefined;

  const recipients = await prisma.bugReportRecipient.findMany({ select: { email: true } });
  const toEmails = recipients.map((r) => r.email);
  if (toEmails.length) {
    const agency = await getAgencyBranding(subCompanyId);
    sendBugReportEmail({
      toEmails,
      reporterName,
      reporterEmail,
      bugTitle: bug.title,
      bugDescription: bug.description,
      bugId: bug.id,
      reportUrl,
      agency,
    }).catch((err) => console.error('Bug report email failed:', err));
  }

  const adminIds = await getUserIdsWithPermissionInAgency(subCompanyId, 'bug_reports:read');
  if (adminIds.length) {
    const subId = bug.subCompanyId;
    dispatchNotification({
      eventKey: 'bug_report_submitted',
      userIds: adminIds,
      subCompanyId: subId,
      context: { reporterName, bugTitle: bug.title ?? 'Bug report' },
      link: '/bug-reports',
      relatedId: bug.id,
    }).catch(() => {});
  }

  return res.status(201).json({
    id: bug.id,
    title: bug.title,
    description: bug.description,
    screenshotUrl: bug.screenshotUrl,
    status: bug.status,
    createdAt: bug.createdAt,
  });
});

/** GET / — list bug reports (super_admin, director, operations_manager only). */
bugReportsRouter.get('/', requirePermission('bug_reports:read'), async (req: Request, res: Response) => {
  const querySchema = z.object({
    status: z.enum(['open', 'closed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  const parsed = querySchema.safeParse(req.query);
  const q = parsed.success ? parsed.data : { status: undefined, page: 1, limit: 20 };

  const allowedIds = await resolveAllowedSubCompanyIds(req.user!, req);
  const scopeFilter = buildSubCompanyFilter(allowedIds, []);

  let where: { status?: 'open' | 'closed'; subCompanyId?: string | { in: string[] } } = {};
  if (q.status) where.status = q.status;
  where = { ...where, ...scopeFilter };

  const skip = (q.page - 1) * q.limit;
  const [total, list] = await Promise.all([
    prisma.bugReport.count({ where }),
    prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: q.limit,
      include: {
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
        subCompany: { select: { id: true, name: true } },
      },
    }),
  ]);

  const data = list.map((b) => ({
    id: b.id,
    title: b.title,
    description: b.description,
    screenshotUrl: b.screenshotUrl,
    status: b.status,
    resolutionRemarks: b.resolutionRemarks,
    metadata: b.metadata,
    createdAt: b.createdAt,
    resolvedAt: b.resolvedAt,
    submittedBy: b.submittedBy
      ? {
          id: b.submittedBy.id,
          name: `${b.submittedBy.firstName ?? ''} ${b.submittedBy.lastName ?? ''}`.trim() || b.submittedBy.email,
          email: b.submittedBy.email,
        }
      : null,
    resolvedBy: b.resolvedBy
      ? {
          id: b.resolvedBy.id,
          name: `${b.resolvedBy.firstName ?? ''} ${b.resolvedBy.lastName ?? ''}`.trim(),
        }
      : null,
    subCompany: b.subCompany ? { id: b.subCompany.id, name: b.subCompany.name } : null,
  }));

  return res.json({
    data,
    pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  });
});

/** GET /:id/screenshot — serve bug report screenshot (redirect to public URL or stream from R2). Same roles as list. */
bugReportsRouter.get('/:id/screenshot', requirePermission('bug_reports:read'), async (req: Request, res: Response) => {
  const bug = await prisma.bugReport.findUnique({
    where: { id: req.params.id },
    select: { screenshotUrl: true, subCompanyId: true },
  });
  if (!bug || !bug.screenshotUrl) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }
  if (!(await canAccessSubCompanyResource(req.user!, bug.subCompanyId, req))) {
    return res.status(403).json({ error: 'Not allowed to view this report' });
  }
  const url = bug.screenshotUrl;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return res.redirect(302, url);
  }
  const fromR2 = await getFromR2(url);
  if (!fromR2) {
    return res.status(404).json({ error: 'Screenshot not available' });
  }
  res.setHeader('Content-Type', fromR2.contentType ?? 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  return res.send(fromR2.body);
});

/** PATCH /:id — close a bug (add resolution remarks). Only super_admin, director, operations_manager. */
bugReportsRouter.patch('/:id', requirePermission('bug_reports:read'), async (req: Request, res: Response) => {
  const parsed = closeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Provide status: "closed" and resolutionRemarks' });
  }
  const { resolutionRemarks } = parsed.data;

  const bug = await prisma.bugReport.findUnique({
    where: { id: req.params.id },
    include: {
      submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!bug) return res.status(404).json({ error: 'Bug report not found' });
  if (bug.status === 'closed') return res.status(400).json({ error: 'Bug report already closed' });

  if (!(await canAccessSubCompanyResource(req.user!, bug.subCompanyId, req))) {
    return res.status(403).json({ error: 'Not allowed to close this report' });
  }

  const updated = await prisma.bugReport.update({
    where: { id: bug.id },
    data: {
      status: 'closed',
      resolutionRemarks: resolutionRemarks.trim(),
      resolvedById: req.user!.sub,
      resolvedAt: new Date(),
    },
    include: {
      submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const submitter = updated.submittedBy;
  if (submitter?.email) {
    const toName = `${submitter.firstName ?? ''} ${submitter.lastName ?? ''}`.trim() || submitter.email;
    const reportUrl = env.FRONTEND_URL ? `${env.FRONTEND_URL.replace(/\/$/, '')}/bug-reports` : undefined;
    const agency = await getAgencyBranding(updated.subCompanyId);
    sendBugResolvedEmail({
      toEmail: submitter.email,
      toName,
      bugTitle: updated.title,
      resolutionRemarks: updated.resolutionRemarks!,
      reportUrl,
      agency,
    }).catch((err) => console.error('Bug resolved email failed:', err));
  }

  dispatchNotificationToUser({
    userId: updated.submittedById,
    subCompanyId: updated.subCompanyId,
    eventKey: 'bug_report_resolved',
    context: { bugTitle: updated.title ?? 'Bug report' },
    link: '/bug-reports',
    relatedId: updated.id,
  }).catch(() => {});

  return res.json({
    id: updated.id,
    status: updated.status,
    resolutionRemarks: updated.resolutionRemarks,
    resolvedAt: updated.resolvedAt,
  });
});
