import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Country } from '@prisma/client';
import { getActiveRbacRoleByKey } from '../services/rbac';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';

const createBody = z.object({
  role: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  country: z.nativeEnum(Country).nullable().optional(),
  allowedIps: z.string().min(1),
  name: z.string().optional(),
});

const updateBody = z.object({
  allowedIps: z.string().min(1).optional(),
  name: z.string().optional(),
});

export const ipRestrictionRulesRouter = Router();
ipRestrictionRulesRouter.use(authenticate);
ipRestrictionRulesRouter.use(requirePermission('settings:write'));

/** GET / — list all IP restriction rules */
ipRestrictionRulesRouter.get('/', async (_req: Request, res: Response) => {
  const rules = await prisma.ipRestrictionRule.findMany({
    orderBy: [{ role: 'asc' }, { country: 'asc' }],
  });
  return res.json({ data: rules });
});

/** POST / — create a rule (role + optional country → allowed IPs) */
ipRestrictionRulesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { role, country, allowedIps, name } = parsed.data;
  const rbacRole = await getActiveRbacRoleByKey(role);
  if (!rbacRole) {
    return res.status(400).json({ error: `Unknown or inactive role: ${role}` });
  }
  try {
    const rule = await prisma.ipRestrictionRule.create({
      data: { role, country: country ?? null, allowedIps, name },
    });
    return res.status(201).json(rule);
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      return res.status(409).json({ error: 'A rule for this role and country already exists' });
    }
    throw e;
  }
});

/** PUT /:id — update a rule */
ipRestrictionRulesRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const { id } = req.params;
  const rule = await prisma.ipRestrictionRule.findUnique({ where: { id } });
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const updated = await prisma.ipRestrictionRule.update({
    where: { id },
    data: {
      ...(parsed.data.allowedIps !== undefined && { allowedIps: parsed.data.allowedIps }),
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
    },
  });
  return res.json(updated);
});

/** DELETE /:id — delete a rule */
ipRestrictionRulesRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.ipRestrictionRule.delete({ where: { id } });
    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'Rule not found' });
  }
});
