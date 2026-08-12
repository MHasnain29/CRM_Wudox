import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ApprovalWorkflowType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { ensureAccessContext } from '../utils/requestPermission';
import {
  performApprovalAction,
  getApprovalStatusForEntity,
  userFacingApprovalError,
} from '../services/approvalActions';
import { ALL_WORKFLOW_TYPES, GLOBAL_APPROVAL_SCOPE, isDatabaseWorkflow } from '../types/approval';
export const approvalsRouter = Router();
approvalsRouter.use(authenticate);

/** GET /approvals/metadata — workflow list, labels, permission keys (all authenticated users). */
approvalsRouter.get('/metadata', async (_req, res) => {
  const { getApprovalMetadata: loadMetadata } = await import('../services/approvalMetadata');
  return res.json({ data: await loadMetadata() });
});

const workflowParam = z.enum(
  ALL_WORKFLOW_TYPES as [ApprovalWorkflowType, ...ApprovalWorkflowType[]],
);

const actionBodySchema = z.object({
  remarks: z.string().max(2000).optional(),
  subCompanyId: z.string().uuid().optional(),
});

async function resolveSubCompanyId(req: Request, workflow: ApprovalWorkflowType): Promise<string | null> {
  if (isDatabaseWorkflow(workflow)) {
    return GLOBAL_APPROVAL_SCOPE;
  }
  const bodySub = typeof req.body?.subCompanyId === 'string' ? req.body.subCompanyId : undefined;
  const querySub = typeof req.query?.subCompanyId === 'string' ? req.query.subCompanyId : undefined;
  const ctx = await ensureAccessContext(req);
  return bodySub ?? querySub ?? ctx?.subCompanyId ?? req.user?.subCompanyId ?? null;
}

approvalsRouter.get('/:workflow/:entityId/status', async (req: Request, res: Response) => {
  const workflow = workflowParam.safeParse(req.params.workflow);
  if (!workflow.success) return res.status(400).json({ error: 'Invalid workflow' });

  const subCompanyId = await resolveSubCompanyId(req, workflow.data);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(403).json({ error: 'Forbidden' });

  const status = await getApprovalStatusForEntity(
    workflow.data,
    req.params.entityId,
    subCompanyId,
    ctx.roleKey,
    ctx.permissions,
  );
  if (!status) return res.status(404).json({ error: 'Not found' });
  return res.json({ data: status });
});

async function handleAction(req: Request, res: Response, action: 'forward' | 'approve' | 'reject') {
  const workflow = workflowParam.safeParse(req.params.workflow);
  if (!workflow.success) return res.status(400).json({ error: 'Invalid workflow' });

  const body = actionBodySchema.safeParse(req.body ?? {});
  const remarks = body.success ? body.data.remarks : undefined;

  const subCompanyId = await resolveSubCompanyId(req, workflow.data);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const ctx = await ensureAccessContext(req);
  if (!ctx) return res.status(403).json({ error: 'Forbidden' });

  const result = await performApprovalAction({
    workflow: workflow.data,
    entityId: req.params.entityId,
    subCompanyId,
    actorUserId: req.user!.sub,
    actorRoleKey: ctx.roleKey,
    actorPermissions: ctx.permissions,
    action,
    remarks,
  });

  if (!result.ok) {
    const status = await getApprovalStatusForEntity(
      workflow.data,
      req.params.entityId,
      subCompanyId,
      ctx.roleKey,
      ctx.permissions,
    );
    return res.status(result.status).json({
      error: userFacingApprovalError(result.error, {
        targetRoleKey: status?.targetRoleKey,
      }),
    });
  }
  return res.json({ data: result.data ?? { action: result.action } });
}

approvalsRouter.post('/:workflow/:entityId/forward', (req, res) => handleAction(req, res, 'forward'));
approvalsRouter.post('/:workflow/:entityId/approve', (req, res) => handleAction(req, res, 'approve'));
approvalsRouter.post('/:workflow/:entityId/reject', (req, res) => handleAction(req, res, 'reject'));

approvalsRouter.get('/workflows', (_req, res) => {
  return res.json({ data: ALL_WORKFLOW_TYPES });
});
