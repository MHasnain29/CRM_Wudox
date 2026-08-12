import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { requestHasPermission } from '../utils/requestPermission';
import { resolveAgencyScope } from '../config/agencyScope';
import { clientVisibilityWhere } from '../services/clientAgencyAccess';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';

export const remarksRouter = Router();

remarksRouter.use(authenticate);
remarksRouter.use(actAsMiddleware);

const createSchema = z.object({
  clientId: z.string().uuid(),
  content: z.string().trim().min(1).max(2000),
  visibility: z.enum(['only_me', 'public', 'shared']),
  scope: z.enum(['agency', 'global']).optional(),
  sharedWith: z.array(z.string().uuid()).optional(),
});

/** Server-side filter: returns a Prisma `where` clause that includes only remarks visible to the viewer. */
function visibilityWhere(viewerId: string, viewerSubCompanyId: string) {
  return {
    OR: [
      { authorId: viewerId },
      { visibility: 'public', scope: 'agency', subCompanyId: viewerSubCompanyId },
      { visibility: 'public', scope: 'global' },
      { visibility: 'shared', sharedWith: { has: viewerId } },
    ],
  };
}

/** POST /api/v1/remarks — create a remark on a client */
remarksRouter.post(
  '/',
  requirePermission('remarks:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });

    const { clientId, content, visibility, scope, sharedWith } = parsed.data;

    // --- Validate visibility / field consistency ---
    if (visibility === 'public') {
      if (!scope) return res.status(400).json({ error: 'scope is required when visibility is public' });
      if (sharedWith?.length) return res.status(400).json({ error: 'sharedWith must not be set for public remarks' });
    }
    if (visibility === 'shared') {
      if (!sharedWith?.length) return res.status(400).json({ error: 'sharedWith must be non-empty for shared remarks' });
      if (scope) return res.status(400).json({ error: 'scope must not be set for shared remarks' });
    }
    if (visibility === 'only_me') {
      if (scope) return res.status(400).json({ error: 'scope must not be set for private remarks' });
      if (sharedWith?.length) return res.status(400).json({ error: 'sharedWith must not be set for private remarks' });
    }

    // --- Capability checks ---
    if (visibility === 'public') {
      if (!await requestHasPermission(req, 'remarks:public')) {
        return res.status(403).json({ error: 'Not permitted to create public remarks' });
      }
      if (scope === 'global') {
        const canGlobal = await requestHasPermission(req, 'agencies:global');
        const canCrossOrg = await requestHasPermission(req, 'agencies:cross_org');
        if (!canGlobal && !canCrossOrg) {
          return res.status(403).json({ error: 'Not permitted to create global-scope remarks' });
        }
      }
    }

    if (visibility === 'shared') {
      const canGlobal = await requestHasPermission(req, 'agencies:global');
      // Validate all target users exist; managers can only share within their agency
      const targets = await prisma.user.findMany({
        where: { id: { in: sharedWith } },
        select: { id: true, subCompanyId: true },
      });
      if (targets.length !== sharedWith!.length) {
        return res.status(400).json({ error: 'One or more sharedWith users not found' });
      }
      if (!canGlobal) {
        const outsideAgency = targets.some((u) => u.subCompanyId !== subCompanyId);
        if (outsideAgency) {
          return res.status(403).json({ error: 'Cannot share with users outside your agency' });
        }
      }
    }

    // --- Verify client is visible to this agency ---
    const client = await prisma.client.findFirst({
      where: { id: clientId, ...clientVisibilityWhere(subCompanyId) },
      select: { id: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const actorId = effectiveActorId(req);
    const author = await prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true, lastName: true },
    });
    const authorName = author ? `${author.firstName} ${author.lastName}`.trim() : 'User';

    const remark = await prisma.remark.create({
      data: {
        clientId,
        authorId: actorId,
        authorName,
        authorRole: req.user!.role as string,
        subCompanyId,
        content,
        visibility,
        scope: visibility === 'public' ? (scope ?? null) : null,
        sharedWith: visibility === 'shared' ? sharedWith! : [],
      },
    });

    return res.status(201).json(remark);
  },
);

/** GET /api/v1/remarks?clientId=&page=&limit= — list remarks visible to the viewer */
remarksRouter.get(
  '/',
  requirePermission('remarks:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const clientId = req.query.clientId as string | undefined;
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));

    const client = await prisma.client.findFirst({
      where: { id: clientId, ...clientVisibilityWhere(subCompanyId) },
      select: { id: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const where = {
      clientId,
      ...visibilityWhere(effectiveActorId(req), subCompanyId),
    };

    const [total, data] = await Promise.all([
      prisma.remark.count({ where }),
      prisma.remark.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          clientId: true,
          authorId: true,
          authorName: true,
          authorRole: true,
          content: true,
          visibility: true,
          scope: true,
          sharedWith: true,
          isPinned: true,
          createdAt: true,
        },
      }),
    ]);

    return res.json({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  },
);

/** DELETE /api/v1/remarks/:id — author-only delete */
remarksRouter.delete(
  '/:id',
  requirePermission('remarks:write'),
  async (req: Request, res: Response) => {
    const remark = await prisma.remark.findUnique({ where: { id: req.params.id } });
    if (!remark) return res.status(404).json({ error: 'Remark not found' });
    if (remark.authorId !== effectiveActorId(req)) return res.status(403).json({ error: 'Not your remark' });

    await prisma.remark.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  },
);

/** PATCH /api/v1/remarks/:id/pin — author can pin own; same-agency teammates with remarks:write can pin any visible to them. */
remarksRouter.patch(
  '/:id/pin',
  requirePermission('remarks:write'),
  async (req: Request, res: Response) => {
    const subCompanyId = await resolveAgencyScope(req);
    if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

    const parsed = z.object({ isPinned: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const remark = await prisma.remark.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true, subCompanyId: true, visibility: true, sharedWith: true, scope: true },
    });
    if (!remark) return res.status(404).json({ error: 'Remark not found' });

    const actorId = effectiveActorId(req);
    const isAuthor = remark.authorId === actorId;
    const isViewerInSameAgency = remark.subCompanyId === subCompanyId;
    const isVisibleToViewer =
      isAuthor
      || (remark.visibility === 'public' && remark.scope === 'global')
      || (remark.visibility === 'public' && remark.scope === 'agency' && isViewerInSameAgency)
      || (remark.visibility === 'shared' && remark.sharedWith.includes(actorId));
    if (!isVisibleToViewer) return res.status(404).json({ error: 'Remark not found' });

    if (!isAuthor && !isViewerInSameAgency) {
      return res.status(403).json({ error: 'Cannot pin remarks outside your agency' });
    }

    const updated = await prisma.remark.update({
      where: { id: remark.id },
      data: { isPinned: parsed.data.isPinned },
      select: { id: true, isPinned: true },
    });
    return res.json(updated);
  },
);
