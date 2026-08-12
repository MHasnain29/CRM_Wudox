/**
 * Email templates: shared library + personal copies (customize for me).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import {
  formatEmailTemplate,
  listSharedTemplates,
  listMineTemplates,
  listForCompose,
  getVisibleTemplate,
  createSharedTemplate,
  customizeTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/emailTemplates';

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  bodyHtml: z.string(),
  headerHtml: z.string().optional(),
  footerHtml: z.string().optional(),
  subCompanyId: z.string().uuid().optional(),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(500).optional(),
  bodyHtml: z.string().optional(),
  headerHtml: z.string().optional().nullable(),
  footerHtml: z.string().optional().nullable(),
});

const customizeBodySchema = z.object({
  sourceTemplateId: z.string().uuid(),
});

function sendServiceError(res: Response, e: unknown) {
  const status = typeof e === 'object' && e && 'status' in e ? Number((e as { status: number }).status) : 500;
  const message = e instanceof Error ? e.message : 'Internal error';
  if (status >= 400 && status < 500) return res.status(status).json({ error: message });
  console.error('[email-templates]', e);
  // Surface Prisma/runtime message so Settings create failures are diagnosable
  return res.status(500).json({ error: message || 'Internal error' });
}

export const emailTemplatesRouter = Router();
emailTemplatesRouter.use(authenticate);
emailTemplatesRouter.use(actAsMiddleware);

/**
 * GET /email-templates
 * scope=shared → admin shared library (settings:read)
 * scope=mine → personal copies only
 * default → compose list (shared ∪ mine)
 * subCompanyId still filters shared portion for admin/elevated.
 */
emailTemplatesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;
    const subCompanyId =
      typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId : undefined;

    if (scope === 'mine') {
      const list = await listMineTemplates(req);
      return res.json({ data: list.map(formatEmailTemplate) });
    }

    if (scope === 'shared') {
      const list = await listSharedTemplates(req, { subCompanyId });
      return res.json({ data: list.map(formatEmailTemplate) });
    }

    // Default: compose (shared + mine). If elevated admin passes subCompanyId for Settings
    // without scope, treat as shared-only when they explicitly ask shared via Settings UI.
    // Keep default as compose so EmailComposeDialog keeps working with no params.
    if (subCompanyId !== undefined) {
      const list = await listSharedTemplates(req, { subCompanyId });
      return res.json({ data: list.map(formatEmailTemplate) });
    }

    const list = await listForCompose(req);
    return res.json({ data: list.map(formatEmailTemplate) });
  } catch (e) {
    return sendServiceError(res, e);
  }
});

/** POST /email-templates/customize — clone shared → personal copy (before /:id) */
emailTemplatesRouter.post('/customize', async (req: Request, res: Response) => {
  const parsed = customizeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  try {
    const template = await customizeTemplate(req, parsed.data.sourceTemplateId);
    return res.status(201).json(formatEmailTemplate(template));
  } catch (e) {
    return sendServiceError(res, e);
  }
});

/** POST /email-templates — create shared (admin) */
emailTemplatesRouter.post('/', requirePermission('settings:read'), async (req: Request, res: Response) => {
  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  try {
    const template = await createSharedTemplate(req, parsed.data);
    return res.status(201).json(formatEmailTemplate(template));
  } catch (e) {
    return sendServiceError(res, e);
  }
});

emailTemplatesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const t = await getVisibleTemplate(req, req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    return res.json(formatEmailTemplate(t));
  } catch (e) {
    return sendServiceError(res, e);
  }
});

/** PATCH — personal (owner) or shared (settings:read) */
emailTemplatesRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = updateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  try {
    const template = await updateTemplate(req, req.params.id, parsed.data);
    return res.json(formatEmailTemplate(template));
  } catch (e) {
    return sendServiceError(res, e);
  }
});

emailTemplatesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteTemplate(req, req.params.id);
    return res.status(204).send();
  } catch (e) {
    return sendServiceError(res, e);
  }
});
