import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAgencyScope } from '../config/agencyScope';
import prisma from '../config/database';

const router = Router();
router.use(authenticate);

// GET /notices — list active (non-expired) notices for the user's sub-company (all authenticated users)
router.get('/', async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(400).json({ error: 'No sub-company context' });

  try {
    const notices = await prisma.notice.findMany({
      where: {
        subCompanyId,
        expiresAt: { gt: new Date() },
      },
      orderBy: [
        { pinned: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json({ data: notices });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notices' });
  }
});

// POST /notices — create a notice
router.post('/', requirePermission('notices:write'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) return res.status(400).json({ error: 'No sub-company context' });

  const { title, message, type, pinned, expiresAt } = req.body;
  if (!title || !message || !expiresAt) {
    return res.status(400).json({ error: 'title, message, and expiresAt are required' });
  }

  try {
    const notice = await prisma.notice.create({
      data: {
        subCompanyId,
        createdById: req.user!.sub,
        title,
        message,
        type: type ?? 'info',
        pinned: pinned ?? false,
        expiresAt: new Date(expiresAt),
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.status(201).json({ data: notice });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create notice' });
  }
});

// PATCH /notices/:id — edit a notice
router.patch('/:id', requirePermission('notices:write'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  const { id } = req.params;

  try {
    const existing = await prisma.notice.findFirst({ where: { id, subCompanyId: subCompanyId ?? undefined } });
    if (!existing) return res.status(404).json({ error: 'Notice not found' });

    const { title, message, type, pinned, expiresAt } = req.body;
    const notice = await prisma.notice.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(message !== undefined && { message }),
        ...(type !== undefined && { type }),
        ...(pinned !== undefined && { pinned }),
        ...(expiresAt !== undefined && { expiresAt: new Date(expiresAt) }),
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json({ data: notice });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notice' });
  }
});

// DELETE /notices/:id — delete a notice
router.delete('/:id', requirePermission('notices:write'), async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  const { id } = req.params;

  try {
    const existing = await prisma.notice.findFirst({ where: { id, subCompanyId: subCompanyId ?? undefined } });
    if (!existing) return res.status(404).json({ error: 'Notice not found' });

    await prisma.notice.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notice' });
  }
});

export default router;
