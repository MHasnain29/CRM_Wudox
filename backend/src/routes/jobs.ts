/**
 * Recruitment Jobs API — /api/v1/jobs
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveListAgencyScope, resolveAgencyScope } from '../config/agencyScope';
import { resolveRecruitmentOwnerWhere } from '../services/recruitmentOwnerScope';
import {
  listJobs,
  getJobById,
  createJob,
  updateJob,
  updateJobStatus,
  deleteJob,
} from '../services/jobs';
import {
  placeEmployeeOnJob,
  toggleJobAssignmentRole,
  endJobPlacement,
  moveJobPlacement,
  endAllJobPlacements,
} from '../services/jobPlacements';
import { listJobAssignmentRequests } from '../services/employeeAssignments';
import { listMatchingEmployeesForJob } from '../services/employeeJobMatching';

export const jobsRouter = Router();
jobsRouter.use(authenticate);
jobsRouter.use(actAsMiddleware);

const shiftSchema = z
  .object({
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    workDays: z.array(z.string()).optional(),
    jobStartDate: z.string().optional().nullable(),
    jobEndDate: z.string().optional().nullable(),
  })
  .optional()
  .nullable();

const screeningSchema = z
  .object({
    requiredSkills: z.array(z.string()).optional(),
    preferredSkills: z.array(z.string()).optional(),
    minExperienceYears: z.number().optional(),
    educationLevel: z.string().optional(),
    certifications: z.array(z.string()).optional(),
    salaryMin: z.number().optional(),
    salaryMax: z.number().optional(),
    location: z.string().optional(),
    remoteOption: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  })
  .optional()
  .nullable();

const createBodySchema = z.object({
  templateId: z.string().optional().nullable(),
  // Jobs may only be created for external employees (client placements).
  jobType: z.literal('external'),
  title: z.string().min(1).max(255),
  company: z.string().max(255).optional(),
  activeClientId: z.string().uuid(),
  clientId: z.string().uuid().optional(), // alias
  location: z.string().min(1).max(255),
  department: z.string().max(255).optional().nullable(),
  description: z.string().min(1),
  requirements: z.string().min(1),
  responsibilities: z.string().min(1),
  openPositions: z.number().int().min(1).optional(),
  backupPercentage: z.number().int().min(0).max(500).optional(),
  status: z.enum(['draft', 'open', 'closed', 'filled']).optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'temporary', 'full-time', 'part-time']),
  salaryMin: z.number().optional().nullable(),
  salaryMax: z.number().optional().nullable(),
  publishLinkedin: z.boolean().optional(),
  publishIndeed: z.boolean().optional(),
  publishGlassdoor: z.boolean().optional(),
  licenseRequired: z.boolean().optional(),
  requiredLicenseTypes: z.array(z.string().min(1).max(255)).optional(),
  publishSettings: z
    .object({
      linkedin: z.boolean().optional(),
      indeed: z.boolean().optional(),
      glassdoor: z.boolean().optional(),
    })
    .optional(),
  screeningCriteria: screeningSchema,
  shiftSchedule: shiftSchema,
});

const patchBodySchema = createBodySchema.partial().omit({ activeClientId: true }).extend({
  activeClientId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});

function httpError(err: unknown, res: Response) {
  const e = err as { status?: number; message?: string };
  if (e.status && e.message) {
    res.status(e.status).json({ error: e.message });
    return true;
  }
  return false;
}

async function agencyIdsOr403(req: Request, res: Response): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req, req.query.agencyIds as string | undefined);
  if (!scope?.allowedIds.length) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return scope.allowedIds;
}

jobsRouter.get('/', requirePermission('jobs:read'), async (req: Request, res: Response) => {
  try {
    const agencyIds = await agencyIdsOr403(req, res);
    if (!agencyIds) return;
    const ownerWhere = await resolveRecruitmentOwnerWhere(req, 'createdById', agencyIds);
    const statusRaw = req.query.status;
    const status = typeof statusRaw === 'string'
      ? (statusRaw.includes(',')
          ? (statusRaw.split(',') as ('draft' | 'open' | 'closed' | 'filled')[])
          : (statusRaw as 'draft' | 'open' | 'closed' | 'filled'))
      : undefined;
    const result = await listJobs({
      agencyIds,
      ownerWhere,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      status,
      jobType: req.query.jobType === 'internal' || req.query.jobType === 'external'
        ? req.query.jobType
        : undefined,
      employmentType:
        typeof req.query.employmentType === 'string'
          ? (req.query.employmentType as 'full_time' | 'part_time' | 'contract' | 'temporary')
          : undefined,
      location: typeof req.query.location === 'string' ? req.query.location : undefined,
      department: typeof req.query.department === 'string' ? req.query.department : undefined,
      activeClientId:
        typeof req.query.activeClientId === 'string'
          ? req.query.activeClientId
          : typeof req.query.clientId === 'string'
            ? req.query.clientId
            : undefined,
      publishLinkedin: req.query.publishLinkedin === 'true',
      publishIndeed: req.query.publishIndeed === 'true',
      publishGlassdoor: req.query.publishGlassdoor === 'true',
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(result);
  } catch (err) {
    console.error('[jobs] list', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.get('/:id', requirePermission('jobs:read'), async (req: Request, res: Response) => {
  try {
    const agencyIds = await agencyIdsOr403(req, res);
    if (!agencyIds) return;
    const row = await getJobById(req.params.id, agencyIds);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error('[jobs] get', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Pending assignment requests targeting this job (awaiting approval). */
jobsRouter.get(
  '/:id/assignment-requests',
  requirePermission('jobs:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const job = await getJobById(req.params.id, agencyIds);
      if (!job) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const rows = await listJobAssignmentRequests(req.params.id, agencyIds);
      res.json({ data: rows });
    } catch (err) {
      console.error('[jobs] assignment-requests', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/** Available employees whose skills + licenses match this job. */
jobsRouter.get(
  '/:id/matching-employees',
  requirePermission('jobs:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const rows = await listMatchingEmployeesForJob({
        jobId: req.params.id,
        agencyIds,
        q,
      });
      if (rows === null) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json({ data: rows });
    } catch (err) {
      console.error('[jobs] matching-employees', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

jobsRouter.post('/', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }
    const agencyId = await resolveAgencyScope(req);
    if (!agencyId) {
      res.status(400).json({ error: 'No agency context' });
      return;
    }
    const body = parsed.data;
    const row = await createJob({
      input: {
        ...body,
        activeClientId: body.activeClientId || body.clientId!,
        employmentType: body.employmentType as 'full_time' | 'part_time' | 'contract' | 'temporary',
        publishLinkedin: body.publishLinkedin ?? body.publishSettings?.linkedin,
        publishIndeed: body.publishIndeed ?? body.publishSettings?.indeed,
        publishGlassdoor: body.publishGlassdoor ?? body.publishSettings?.glassdoor,
      },
      subCompanyId: agencyId,
      createdById: effectiveActorId(req) ?? req.user!.sub,
    });
    res.status(201).json(row);
  } catch (err) {
    if (httpError(err, res)) return;
    console.error('[jobs] create', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.patch('/:id', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }
    const agencyIds = await agencyIdsOr403(req, res);
    if (!agencyIds) return;
    const body = parsed.data;
    const row = await updateJob(req.params.id, agencyIds, {
      ...body,
      activeClientId: body.activeClientId || body.clientId,
      employmentType: body.employmentType as
        | 'full_time'
        | 'part_time'
        | 'contract'
        | 'temporary'
        | undefined,
      publishLinkedin: body.publishLinkedin ?? body.publishSettings?.linkedin,
      publishIndeed: body.publishIndeed ?? body.publishSettings?.indeed,
      publishGlassdoor: body.publishGlassdoor ?? body.publishSettings?.glassdoor,
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    if (httpError(err, res)) return;
    console.error('[jobs] update', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.patch('/:id/status', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const status = z.enum(['draft', 'open', 'closed', 'filled']).safeParse(req.body?.status);
    if (!status.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const agencyIds = await agencyIdsOr403(req, res);
    if (!agencyIds) return;
    const row = await updateJobStatus(req.params.id, agencyIds, status.data, {
      actorUserId: effectiveActorId(req) ?? req.user!.sub,
    });
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(row);
  } catch (err) {
    if (httpError(err, res)) return;
    console.error('[jobs] status', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.delete('/:id', requirePermission('jobs:write'), async (req: Request, res: Response) => {
  try {
    const agencyIds = await agencyIdsOr403(req, res);
    if (!agencyIds) return;
    const result = await deleteJob(req.params.id, agencyIds);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[jobs] delete', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

jobsRouter.post(
  '/:id/assignments',
  requirePermission('jobs:write'),
  async (req: Request, res: Response) => {
    try {
      const body = z
        .object({
          employeeId: z.string().uuid(),
          isBackup: z.boolean().optional(),
          allowSkillMismatch: z.boolean().optional(),
          assignmentId: z.string().uuid().optional().nullable(),
          workLocation: z.string().optional().nullable(),
          positionTitle: z.string().optional().nullable(),
          payRate: z.string().optional().nullable(),
          shiftSchedule: z.string().optional().nullable(),
          expectedDuration: z.string().optional().nullable(),
          supervisorInfo: z.string().optional().nullable(),
          requiredPpe: z.string().optional().nullable(),
          workplaceHazards: z.string().optional().nullable(),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'Invalid payload', details: body.error.flatten() });
        return;
      }
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const row = await placeEmployeeOnJob({
        jobId: req.params.id,
        agencyIds,
        assignedById: effectiveActorId(req) ?? req.user!.sub,
        ...body.data,
      });
      res.status(201).json(row);
    } catch (err) {
      if (httpError(err, res)) return;
      console.error('[jobs] place', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

jobsRouter.patch(
  '/:id/assignments/:assignmentId',
  requirePermission('jobs:write'),
  async (req: Request, res: Response) => {
    try {
      const isBackup = z.boolean().safeParse(req.body?.isBackup);
      if (!isBackup.success) {
        res.status(400).json({ error: 'isBackup required' });
        return;
      }
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const row = await toggleJobAssignmentRole({
        jobId: req.params.id,
        assignmentId: req.params.assignmentId,
        agencyIds,
        isBackup: isBackup.data,
      });
      res.json(row);
    } catch (err) {
      if (httpError(err, res)) return;
      console.error('[jobs] toggle role', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

jobsRouter.post(
  '/:id/assignments/:assignmentId/end',
  requirePermission('jobs:write'),
  async (req: Request, res: Response) => {
    try {
      const body = z
        .object({
          endReason: z.enum(['work_complete', 'not_performing', 'other']),
          endNotes: z.string().optional().nullable(),
          rating: z.number().int().min(1).max(5),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'Invalid payload', details: body.error.flatten() });
        return;
      }
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const row = await endJobPlacement({
        jobId: req.params.id,
        assignmentId: req.params.assignmentId,
        agencyIds,
        actorUserId: effectiveActorId(req) ?? req.user!.sub,
        ...body.data,
      });
      res.json(row);
    } catch (err) {
      if (httpError(err, res)) return;
      console.error('[jobs] end placement', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

jobsRouter.post(
  '/:id/assignments/:assignmentId/move',
  requirePermission('jobs:write'),
  async (req: Request, res: Response) => {
    try {
      const body = z
        .object({
          targetJobId: z.string().uuid(),
          isBackup: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'Invalid payload', details: body.error.flatten() });
        return;
      }
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const row = await moveJobPlacement({
        jobId: req.params.id,
        assignmentId: req.params.assignmentId,
        agencyIds,
        assignedById: effectiveActorId(req) ?? req.user!.sub,
        ...body.data,
      });
      res.json(row);
    } catch (err) {
      if (httpError(err, res)) return;
      console.error('[jobs] move', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

jobsRouter.post(
  '/:id/end-placements',
  requirePermission('jobs:write'),
  async (req: Request, res: Response) => {
    try {
      const body = z
        .object({
          finalStatus: z.enum(['closed', 'filled']),
          rows: z.array(
            z.object({
              employeeId: z.string().uuid(),
              endReason: z.enum(['work_complete', 'not_performing', 'other']),
              endNotes: z.string().optional().nullable(),
              rating: z.number().int().min(1).max(5),
            }),
          ),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'Invalid payload', details: body.error.flatten() });
        return;
      }
      const agencyIds = await agencyIdsOr403(req, res);
      if (!agencyIds) return;
      const row = await endAllJobPlacements({
        jobId: req.params.id,
        agencyIds,
        actorUserId: effectiveActorId(req) ?? req.user!.sub,
        ...body.data,
      });
      res.json(row);
    } catch (err) {
      if (httpError(err, res)) return;
      console.error('[jobs] end-all', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
