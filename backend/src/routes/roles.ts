import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DataScopeLevel } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { ApprovalActorMode, ApprovalWorkflowType } from '@prisma/client';
import {
  createRole,
  deleteRole,
  getRoleById,
  getRolePermissionKeys,
  listPermissionsTree,
  listUsersForRole,
  listAssignableRoles,
  listRolesTree,
  resetSystemRolesToDefaults,
  setRolePermissions,
  updateRole,
} from '../services/rbac';
import {
  getEffectiveRoleApprovalCapabilities,
  setRoleApprovalCapabilities,
} from '../services/approvalPolicy';

export const rolesRouter = Router();

rolesRouter.use(authenticate);

const scopeLevelEnum = z.nativeEnum(DataScopeLevel);

const createRoleBody = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  parentRoleId: z.string().uuid().optional().nullable(),
  scopeLevel: scopeLevelEnum.optional(),
  sortOrder: z.number().int().optional(),
});

const updateRoleBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  parentRoleId: z.string().uuid().optional().nullable(),
  scopeLevel: scopeLevelEnum.optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const setPermissionsBody = z.object({
  permissionKeys: z.array(z.string().min(1)),
});

function handleServiceError(res: Response, err: unknown): Response {
  const message = err instanceof Error ? err.message : 'Request failed';
  const status = message.includes('not found') ? 404 : 400;
  return res.status(status).json({ error: message });
}

/** GET /roles — role hierarchy tree */
rolesRouter.get('/', requirePermission('roles:read'), async (_req: Request, res: Response) => {
  const tree = await listRolesTree();
  return res.json({ data: tree });
});

/** GET /roles/assignable — flat active roles for user/settings dropdowns */
rolesRouter.get('/assignable', requirePermission('users:read'), async (_req: Request, res: Response) => {
  const roles = await listAssignableRoles();
  return res.json({ data: roles });
});

/** GET /roles/permissions — permission catalog tree */
rolesRouter.get('/permissions', requirePermission('roles:read'), async (_req: Request, res: Response) => {
  const tree = await listPermissionsTree();
  return res.json({ data: tree });
});

/** POST /roles/reset-defaults — restore system role permission grants from defaults */
rolesRouter.post('/reset-defaults', requirePermission('roles:write'), async (_req: Request, res: Response) => {
  try {
    const result = await resetSystemRolesToDefaults();
    return res.json({
      data: result,
      message:
        result.resetRoleKeys.length > 0
          ? `Reset ${result.resetRoleKeys.length} system role(s) to default permissions. Users must log out and back in.`
          : 'No system roles were reset',
    });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/** POST /roles — create custom role */
rolesRouter.post('/', requirePermission('roles:create', 'roles:write'), async (req: Request, res: Response) => {
  const parsed = createRoleBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  try {
    const role = await createRole(parsed.data);
    return res.status(201).json({ data: role });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/** GET /roles/:id — role detail */
rolesRouter.get('/:id', requirePermission('roles:read'), async (req: Request, res: Response) => {
  const role = await getRoleById(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  return res.json({ data: role });
});

/** PATCH /roles/:id — update role */
rolesRouter.patch('/:id', requirePermission('roles:write'), async (req: Request, res: Response) => {
  const parsed = updateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  try {
    const role = await updateRole(req.params.id, parsed.data);
    return res.json({ data: role });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/** DELETE /roles/:id — deactivate custom role (non-system only) */
rolesRouter.delete('/:id', requirePermission('roles:delete', 'roles:write'), async (req: Request, res: Response) => {
  try {
    await deleteRole(req.params.id);
    return res.status(204).send();
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/** GET /roles/:id/users — users assigned to this role */
rolesRouter.get('/:id/users', requirePermission('roles:read'), async (req: Request, res: Response) => {
  const role = await getRoleById(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  try {
    const users = await listUsersForRole(req.params.id);
    return res.json({ data: { roleId: role.id, roleKey: role.key, users } });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/** GET /roles/:id/permissions — granted permission keys */
rolesRouter.get('/:id/permissions', requirePermission('roles:read'), async (req: Request, res: Response) => {
  const role = await getRoleById(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const keys = await getRolePermissionKeys(req.params.id);
  return res.json({ data: { roleId: role.id, roleKey: role.key, permissions: keys } });
});

const approvalCapabilitySchema = z.object({
  workflow: z.enum([
    'client_manual_add',
    'client_manual_edit',
    'client_import',
    'contact_import',
    'database_client_add',
    'database_client_import',
    'database_contact_import',
    'lead_request',
    'lead_extension',
    'lead_reassignment',
    'proposal_review',
    'proposal_extension',
  ] as [ApprovalWorkflowType, ...ApprovalWorkflowType[]]),
  mode: z.nativeEnum(ApprovalActorMode),
});

const setApprovalCapabilitiesBody = z.object({
  capabilities: z.array(approvalCapabilitySchema),
});

/** GET /roles/:id/approval-capabilities */
rolesRouter.get('/:id/approval-capabilities', requirePermission('roles:read'), async (req: Request, res: Response) => {
  const role = await getRoleById(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  const capabilities = await getEffectiveRoleApprovalCapabilities(req.params.id);
  return res.json({ data: { roleId: role.id, roleKey: role.key, capabilities } });
});

/** PUT /roles/:id/approval-capabilities */
rolesRouter.put('/:id/approval-capabilities', requirePermission('roles:write'), async (req: Request, res: Response) => {
  const parsed = setApprovalCapabilitiesBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  const role = await getRoleById(req.params.id);
  if (!role) return res.status(404).json({ error: 'Role not found' });
  try {
    const saved = await setRoleApprovalCapabilities(req.params.id, parsed.data.capabilities);
    return res.json({ data: { roleId: role.id, capabilities: saved } });
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/** PUT /roles/:id/permissions — replace grants */
rolesRouter.put('/:id/permissions', requirePermission('roles:write'), async (req: Request, res: Response) => {
  const parsed = setPermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
  }
  try {
    const keys = await setRolePermissions(req.params.id, parsed.data.permissionKeys);
    return res.json({ data: { roleId: req.params.id, permissions: keys } });
  } catch (err) {
    return handleServiceError(res, err);
  }
});
