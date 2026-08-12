/**
 * Employee Active Client training endpoints — mounted under /api/v1/employees.
 * Isolated from Ontario/WHMIS EmployeeTraining routes.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveListAgencyScope } from '../config/agencyScope';
import {
  getActiveClientTrainingFileBuffer,
  listActiveClientTrainingsForEmployee,
  resendActiveClientTrainingEmail,
  syncActiveClientTrainingStatus,
  uploadSignedActiveClientTraining,
} from '../services/activeClientTraining';

export const activeClientTrainingRouter = Router({ mergeParams: true });
activeClientTrainingRouter.use(authenticate);
activeClientTrainingRouter.use(actAsMiddleware);

async function resolveAgencyIds(req: Request): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req);
  if (!scope) return null;
  const filter = scope.scopeFilter.subCompanyId;
  return typeof filter === 'string' ? [filter] : filter.in;
}

const uploadSignedSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fileBase64: z.string().min(1),
  mimeType: z.string().max(128).optional().nullable(),
});

activeClientTrainingRouter.get(
  '/:employeeId/active-client-trainings',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const rows = await listActiveClientTrainingsForEmployee({
        employeeId: req.params.employeeId,
        agencyIds,
      });
      if (!rows) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: rows });
    } catch (err) {
      console.error('[activeClientTraining] list', err);
      return res.status(500).json({ error: 'Failed to load client trainings' });
    }
  },
);

activeClientTrainingRouter.post(
  '/:employeeId/active-client-trainings/:trainingId/resend',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const result = await resendActiveClientTrainingEmail({
        employeeId: req.params.employeeId,
        trainingId: req.params.trainingId,
        agencyIds,
        sentByUserId: effectiveActorId(req) ?? req.user!.sub,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ data: result.data });
    } catch (err) {
      console.error('[activeClientTraining] resend', err);
      return res.status(500).json({ error: 'Failed to resend client training' });
    }
  },
);

activeClientTrainingRouter.post(
  '/:employeeId/active-client-trainings/:trainingId/sync',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const result = await syncActiveClientTrainingStatus({
        employeeId: req.params.employeeId,
        trainingId: req.params.trainingId,
        agencyIds,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ data: result.data });
    } catch (err) {
      console.error('[activeClientTraining] sync', err);
      return res.status(500).json({ error: 'Failed to sync client training' });
    }
  },
);

activeClientTrainingRouter.post(
  '/:employeeId/active-client-trainings/:trainingId/signed',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = uploadSignedSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const result = await uploadSignedActiveClientTraining({
        employeeId: req.params.employeeId,
        trainingId: req.params.trainingId,
        agencyIds,
        completedByUserId: effectiveActorId(req) ?? req.user!.sub,
        fileBase64: parsed.data.fileBase64,
        fileName: parsed.data.name?.trim() || 'signed-client-training.pdf',
        mimeType: parsed.data.mimeType,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.status(201).json({ data: result.data });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[activeClientTraining] upload signed', err);
      return res.status(500).json({ error: 'Failed to upload signed training' });
    }
  },
);

async function downloadTrainingFile(
  req: Request,
  res: Response,
  kind: 'template' | 'signed',
) {
  try {
    const agencyIds = await resolveAgencyIds(req);
    if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
    const file = await getActiveClientTrainingFileBuffer({
      employeeId: req.params.employeeId,
      trainingId: req.params.trainingId,
      agencyIds,
      kind,
    });
    if (!file) return res.status(404).json({ error: 'Document not found' });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.fileName)}"`,
    );
    return res.send(file.body);
  } catch (err) {
    console.error('[activeClientTraining] download', err);
    return res.status(500).json({ error: 'Failed to download document' });
  }
}

activeClientTrainingRouter.get(
  '/:employeeId/active-client-trainings/:trainingId/template/download',
  requirePermission('employees:read'),
  (req, res) => void downloadTrainingFile(req, res, 'template'),
);

activeClientTrainingRouter.get(
  '/:employeeId/active-client-trainings/:trainingId/signed/download',
  requirePermission('employees:read'),
  (req, res) => void downloadTrainingFile(req, res, 'signed'),
);
