/**
 * Client Notes — custom field definitions and per-client values.
 * Registered under /api/v1/client-note-fields and /api/v1/clients/:id/note-fields.
 *
 * Permissions:
 *   - client_notes:configure       → CRUD on field definitions
 *   - client_notes:fields:read     → list defs + values for a client (implicit via clients:read)
 *   - client_notes:fields:write    → write a value (requires the client be Closed Won)
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClientNoteFieldType, ClientVisibility } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { emitToUsers } from '../socket';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createFieldDef,
  deactivateFieldDef,
  listConfigurableFieldDefs,
  listFieldDefsForClient,
  listFieldValuesForClient,
  setFieldValue,
  updateFieldDef,
} from '../services/clientNoteFields';

export const clientNoteFieldsRouter = Router();
clientNoteFieldsRouter.use(authenticate);

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]{0,62}$/, 'Key must be lowercase snake_case'),
  label: z.string().trim().min(1).max(128),
  fieldType: z.nativeEnum(ClientNoteFieldType),
  options: z.array(z.string().trim().min(1).max(64)).optional().nullable(),
  visibility: z.nativeEnum(ClientVisibility),
  subCompanyId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const updateSchema = z.object({
  label: z.string().trim().min(1).max(128).optional(),
  options: z.array(z.string().trim().min(1).max(64)).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

function handleError(err: unknown, res: Response): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[clientNoteFields] error', err);
  res.status(500).json({ error: 'Internal server error' });
}

clientNoteFieldsRouter.get(
  '/',
  requirePermission('client_notes:configure'),
  async (req: Request, res: Response) => {
    try {
      const list = await listConfigurableFieldDefs(req);
      res.json({ fields: list });
    } catch (err) {
      handleError(err, res);
    }
  },
);

clientNoteFieldsRouter.post(
  '/',
  requirePermission('client_notes:configure'),
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }
    try {
      const created = await createFieldDef(req, parsed.data);
      if (req.user?.sub) {
        emitToUsers([req.user.sub], 'client_note_field:defs_changed', { id: created.id });
      }
      res.status(201).json(created);
    } catch (err) {
      handleError(err, res);
    }
  },
);

clientNoteFieldsRouter.patch(
  '/:id',
  requirePermission('client_notes:configure'),
  async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }
    try {
      const updated = await updateFieldDef(req, req.params.id, parsed.data);
      if (req.user?.sub) {
        emitToUsers([req.user.sub], 'client_note_field:defs_changed', { id: updated.id });
      }
      res.json(updated);
    } catch (err) {
      handleError(err, res);
    }
  },
);

clientNoteFieldsRouter.delete(
  '/:id',
  requirePermission('client_notes:configure'),
  async (req: Request, res: Response) => {
    try {
      await deactivateFieldDef(req, req.params.id);
      if (req.user?.sub) {
        emitToUsers([req.user.sub], 'client_note_field:defs_changed', { id: req.params.id });
      }
      res.status(204).end();
    } catch (err) {
      handleError(err, res);
    }
  },
);

/** Per-client endpoints registered separately on the clients router prefix.
 * Mounted at /api/v1/clients/:id/note-fields via a small helper router below. */
export const clientNoteFieldValuesRouter = Router({ mergeParams: true });
clientNoteFieldValuesRouter.use(authenticate);

const setValueSchema = z.object({
  value: z.unknown(),
});

clientNoteFieldValuesRouter.get(
  '/',
  requirePermission('clients:read'),
  async (req: Request, res: Response) => {
    try {
      const clientId = req.params.id;
      const defs = await listFieldDefsForClient(req, clientId);
      const values = await listFieldValuesForClient(req, clientId, defs);
      res.json({ fields: defs, values });
    } catch (err) {
      handleError(err, res);
    }
  },
);

clientNoteFieldValuesRouter.put(
  '/:fieldDefId',
  requirePermission('client_notes:fields:write'),
  async (req: Request, res: Response) => {
    const parsed = setValueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body' });
      return;
    }
    try {
      const value = await setFieldValue(req, req.params.id, req.params.fieldDefId, parsed.data.value);
      if (req.user?.sub) {
        emitToUsers([req.user.sub], 'client_note_field:value_changed', {
          clientId: req.params.id,
          fieldDefId: req.params.fieldDefId,
        });
      }
      res.json(value);
    } catch (err) {
      handleError(err, res);
    }
  },
);
