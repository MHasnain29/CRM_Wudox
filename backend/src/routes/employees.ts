/**
 * Employees API — applicants and worker records.
 * Pipeline: local draft → save (docs upload + PandaDoc + pending) →
 * RM approve → master → client assignment approval / instant job roster → active.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import { requirePermission } from '../middleware/requirePermission';
import { resolveListAgencyScope, resolveAgencyScope } from '../config/agencyScope';
import { resolveRecruitmentOwnerWhere } from '../services/recruitmentOwnerScope';
import { ensureAccessContext } from '../utils/requestPermission';
import {
  listEmployees,
  getEmployeeById,
  getEmployeeCounts,
  createEmployee,
  updateEmployee,
  approveEmployee,
  rejectEmployee,
  addEmployeeNote,
  uploadEmployeeDocument,
  updateEmployeeDocumentExpiry,
  deleteEmployeeDocument,
  getEmployeeDocumentBuffer,
} from '../services/employees';
import {
  listExpiringEmployeeDocuments,
  parseExpiryDateInput,
} from '../services/employeeDocumentExpiry';
import { submitEmployeeForApproval } from '../services/employeeApproval';
import {
  listEmployeeAssignments,
  createEmployeeAssignment,
} from '../services/employeeAssignments';
import {
  sendAssignmentTrainingMessage,
  uploadAssignmentTrainingCertificate,
} from '../services/employeeAssignmentTraining';
import {
  listEmployeeTrainings,
  sendEmployeeTrainingMessage,
  uploadEmployeeTrainingCertificate,
  resendEmployeeTrainingEmail,
} from '../services/employeeTraining';
import { sendDefaultEmployeeTrainings } from '../services/employeeDefaultTraining';
import { endEmployeeAssignment } from '../services/jobPlacements';
import {
  sendEmployeeOnboardingAgreement,
  getEmployeeOnboardingStatus,
  syncEmployeeOnboardingAgreement,
} from '../services/employeeOnboardingDocs';
import {
  listEmployeeJobMatchBoard,
  listMatchingJobsForEmployee,
} from '../services/employeeJobMatching';

const workExperienceSchema = z.object({
  companyName: z.string().min(1).max(255),
  contactNumber: z.string().max(50).optional().nullable(),
  position: z.string().max(255).optional().nullable(),
  duration: z.string().max(100).optional().nullable(),
  sortOrder: z.number().int().min(1).max(2),
});

const uiExtrasLicenseSchema = z.object({
  licenseType: z.string().max(200),
  expiryDate: z.string().max(32),
  docId: z.string().max(64).nullable(),
});

const uiExtrasEducationSchema = z.object({
  level: z.string().max(200),
  fromYear: z.string().max(10),
  endYear: z.string().max(10),
  graduated: z.enum(['', 'yes', 'no']),
  courseStudied: z.string().max(255),
  diplomaName: z.string().max(255),
});

const uiExtrasExperienceSchema = z.object({
  companyName: z.string().max(255),
  contactNumber: z.string().max(50),
  position: z.string().max(255),
  duration: z.string().max(100),
});

/**
 * Form-only extras. Fields are optional (no Zod defaults) so a partial PATCH
 * does not wipe sibling keys — service merges with existing JSON.
 * SIN digits are intentionally not in the schema.
 */
const uiExtrasSchema = z.object({
  skills: z.array(z.string().max(100)).max(50).optional(),
  noWorkExperience: z.boolean().optional(),
  extraEducation: z.array(uiExtrasEducationSchema).max(50).optional(),
  extraExperiences: z.array(uiExtrasExperienceSchema).max(50).optional(),
  assignedClientId: z.string().max(64).optional(),
  assignedClientName: z.string().max(255).optional(),
  photoIdType: z.string().max(100).optional(),
  photoIdNumber: z.string().max(100).optional(),
  photoIdExpiry: z.string().max(32).optional(),
  statusDocExpiry: z.string().max(32).optional(),
  sinDocExpiry: z.string().max(32).optional(),
  licensesNotApplicable: z.boolean().optional(),
  licenses: z.array(uiExtrasLicenseSchema).max(50).optional(),
  profilePhotoDocId: z.string().max(64).nullable().optional(),
});

const createBodySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  phone: z.string().min(1).max(50),
  gender: z.enum(['male', 'female', 'other']),
  dateOfBirth: z.string().optional().nullable(),
  address: z.string().min(1).max(500),
  addressLine2: z.string().max(500).optional().nullable(),
  city: z.string().min(1).max(100),
  province: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  country: z.string().max(100).optional().nullable(),
  emergencyContactName: z.string().min(1).max(200),
  emergencyContactPhone: z.string().min(1).max(50),
  educationLevel: z.string().min(1).max(200),
  educationFromYear: z.number().int().min(1950).max(2100).optional().nullable(),
  educationEndYear: z.number().int().min(1950).max(2100).optional().nullable(),
  graduated: z.boolean(),
  courseStudied: z.string().max(255).optional().nullable(),
  diplomaName: z.string().max(255).optional().nullable(),
  experienceDuties: z.string().min(1).max(10000),
  availableFrom: z.string().min(1),
  availabilityTypes: z.array(z.enum(['full_time', 'part_time'])).min(1),
  skills: z.array(z.string().max(100)).default([]),
  residencyStatus: z.enum(['citizen', 'pr', 'student', 'refugee', 'work_permit']),
  shiftsAvailable: z.array(z.string().max(50)).min(1),
  ableTwelveHourShift: z.boolean(),
  englishProficiency: z.array(z.string().max(50)).min(1),
  workExperiences: z.array(workExperienceSchema).length(2),
  employeeType: z.literal('external').default('external'),
  workStatus: z.enum(['none', 'active', 'scheduled']).optional().nullable(),
  hourlyRate: z.number().min(0).optional().nullable(),
  salaryPaymentMethod: z.enum(['cheque', 'deposit']).optional().nullable(),
  bankName: z.string().max(200).optional().nullable(),
  bankInstitutionNumber: z.string().max(10).optional().nullable(),
  bankTransitNumber: z.string().max(20).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  uiExtras: uiExtrasSchema.optional(),
});

const updateBodySchema = createBodySchema.partial().extend({
  employeeType: z.literal('external').optional(),
  workStatus: z.enum(['none', 'active', 'scheduled']).optional().nullable(),
  position: z.string().max(255).optional().nullable(),
  department: z.string().max(255).optional().nullable(),
  hourlyRate: z.number().min(0).optional().nullable(),
  salaryPaymentMethod: z.enum(['cheque', 'deposit']).optional().nullable(),
  bankName: z.string().max(200).optional().nullable(),
  bankInstitutionNumber: z.string().max(10).optional().nullable(),
  bankTransitNumber: z.string().max(20).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(100)).optional(),
  workExperiences: z.array(workExperienceSchema).length(2).optional(),
  skills: z.array(z.string().max(100)).optional(),
  availabilityTypes: z.array(z.enum(['full_time', 'part_time'])).min(1).optional(),
  uiExtras: uiExtrasSchema.optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  workStatus: z.enum(['none', 'active', 'scheduled']).optional(),
  pipelineBucket: z
    .enum(['unregistered', 'pending', 'master', 'active'])
    .optional(),
  tags: z.string().optional(),
  tagAny: z.string().optional(),
  excludeTags: z.string().optional(),
  city: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  employeeType: z.enum(['internal', 'external']).optional(),
  agencyIds: z.string().optional(),
  subCompanyId: z.string().uuid().optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().min(1).max(2000),
});

const noteBodySchema = z.object({
  content: z.string().min(1).max(5000),
});

const expiryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'expiryDate must be YYYY-MM-DD or ISO datetime')
  .nullable()
  .optional();

const uploadBodySchema = z.object({
  name: z.string().min(1).max(255),
  fileBase64: z.string().min(1),
  mimeType: z.string().max(128).optional(),
  type: z.enum(['resume', 'photo_id', 'sin', 'proof_of_status', 'agreement', 'bank_deposit', 'other']).default('resume'),
  expiryDate: expiryDateSchema,
});

const patchDocumentBodySchema = z.object({
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'expiryDate must be YYYY-MM-DD or ISO datetime')
    .nullable(),
});

const expiringDocsQuerySchema = z.object({
  withinDays: z.coerce.number().min(1).max(365).default(90),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(200).default(100),
  agencyIds: z.string().optional(),
  subCompanyId: z.string().uuid().optional(),
});

const assignmentDetailsSchema = {
  workLocation: z.string().max(500).optional().nullable(),
  positionTitle: z.string().max(200).optional().nullable(),
  payRate: z.string().max(100).optional().nullable(),
  shiftSchedule: z.string().max(500).optional().nullable(),
  expectedDuration: z.string().max(200).optional().nullable(),
  supervisorInfo: z.string().max(1000).optional().nullable(),
  requiredPpe: z.string().max(1000).optional().nullable(),
  workplaceHazards: z.string().max(2000).optional().nullable(),
};

const assignmentBodySchema = z.object({
  targetType: z.enum(['client', 'job']),
  clientId: z.string().uuid().optional().nullable(),
  activeClientId: z.string().uuid().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  isBackup: z.boolean().optional(),
  allowSkillMismatch: z.boolean().optional(),
  ...assignmentDetailsSchema,
});

async function resolveAgencyIds(req: Request, agencyIdsParam?: string): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req, agencyIdsParam);
  if (!scope) return null;
  const filter = scope.scopeFilter.subCompanyId;
  return typeof filter === 'string' ? [filter] : filter.in;
}

export const employeesRouter = Router();
employeesRouter.use(authenticate);
employeesRouter.use(actAsMiddleware);

employeesRouter.get(
  '/counts',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      // Same agency resolution as GET / — honor agencyIds, else subCompanyId
      // (apiFetch may inject viewedSubCompanyId as subCompanyId for elevated users).
      const agencyParam =
        (typeof req.query.agencyIds === 'string' ? req.query.agencyIds : undefined) ??
        (typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId : undefined);
      const agencyIds = await resolveAgencyIds(req, agencyParam);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const ownerWhere = await resolveRecruitmentOwnerWhere(req, 'addedById', agencyIds);
      const counts = await getEmployeeCounts(agencyIds, ownerWhere);
      return res.json({ data: counts });
    } catch (err) {
      console.error('[employees/counts]', err);
      return res.status(500).json({ error: 'Failed to load employee counts' });
    }
  },
);

employeesRouter.get(
  '/documents/expiring',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const parsed = expiringDocsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const q = parsed.data;
      const agencyIds = await resolveAgencyIds(req, q.agencyIds ?? q.subCompanyId);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const result = await listExpiringEmployeeDocuments({
        agencyIds,
        withinDays: q.withinDays,
        page: q.page,
        limit: q.limit,
      });
      return res.json(result);
    } catch (err) {
      console.error('[employees/documents/expiring]', err);
      return res.status(500).json({ error: 'Failed to load expiring documents' });
    }
  },
);

employeesRouter.get(
  '/',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const q = parsed.data;
      const agencyIds = await resolveAgencyIds(req, q.agencyIds ?? q.subCompanyId);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const ownerWhere = await resolveRecruitmentOwnerWhere(req, 'addedById', agencyIds);

      const result = await listEmployees({
        page: q.page,
        limit: q.limit,
        search: q.search,
        approvalStatus: q.approvalStatus,
        workStatus: q.workStatus,
        pipelineBucket: q.pipelineBucket,
        tags: q.tags?.split(',').filter(Boolean),
        tagAny: q.tagAny?.split(',').filter(Boolean),
        excludeTags: q.excludeTags?.split(',').filter(Boolean),
        city: q.city,
        province: q.province,
        employeeType: q.employeeType,
        agencyIds,
        ownerWhere,
      });
      return res.json(result);
    } catch (err) {
      console.error('[employees/list]', err);
      return res.status(500).json({ error: 'Failed to load employees' });
    }
  },
);

/** Open/draft jobs with available Master employees matching skills + licenses. */
employeesRouter.get(
  '/job-matches',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req, req.query.agencyIds as string | undefined);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const page = req.query.page ? Number(req.query.page) : 1;
      const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      // "My jobs only" — owner filter narrows the Jobs side; candidates stay agency-wide.
      const jobOwnerWhere = await resolveRecruitmentOwnerWhere(req, 'createdById', agencyIds);
      const result = await listEmployeeJobMatchBoard({ agencyIds, page, pageSize, q, jobOwnerWhere });
      return res.json(result);
    } catch (err) {
      console.error('[employees/job-matches]', err);
      return res.status(500).json({ error: 'Failed to load job matches' });
    }
  },
);

employeesRouter.get(
  '/:id',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const emp = await getEmployeeById(req.params.id, agencyIds);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: emp });
    } catch (err) {
      console.error('[employees/get]', err);
      return res.status(500).json({ error: 'Failed to load employee' });
    }
  },
);

employeesRouter.post(
  '/',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const subCompanyId = await resolveAgencyScope(req);
      if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

      const emp = await createEmployee(parsed.data, effectiveActorId(req));
      return res.status(201).json({ data: emp });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400) {
        return res.status(400).json({ error: (err as Error).message });
      }
      console.error('[employees/create]', err);
      return res.status(500).json({ error: 'Failed to create employee' });
    }
  },
);

employeesRouter.patch(
  '/:id',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = updateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const emp = await updateEmployee(req.params.id, agencyIds, parsed.data);
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: emp });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400) {
        return res.status(400).json({ error: (err as Error).message });
      }
      console.error('[employees/update]', err);
      return res.status(500).json({ error: 'Failed to update employee' });
    }
  },
);

employeesRouter.post(
  '/:id/submit-for-approval',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const subCompanyId = await resolveAgencyScope(req);
      if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

      const ctx = await ensureAccessContext(req);
      if (!ctx) return res.status(403).json({ error: 'Forbidden' });

      const result = await submitEmployeeForApproval({
        employeeId: req.params.id,
        agencyIds,
        subCompanyId,
        submitterUserId: effectiveActorId(req),
        submitterRoleKey: ctx.roleKey,
        submitterPermissions: ctx.permissions,
      });
      return res.json({ data: result.employee, approval: result });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/submit-for-approval]', err);
      return res.status(500).json({ error: 'Failed to submit employee for approval' });
    }
  },
);

employeesRouter.get(
  '/:id/assignments',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const rows = await listEmployeeAssignments(req.params.id, agencyIds);
      if (rows === null) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: rows });
    } catch (err) {
      console.error('[employees/assignments/list]', err);
      return res.status(500).json({ error: 'Failed to load assignments' });
    }
  },
);

/** Open/draft jobs matching this employee's skills + licenses. */
employeesRouter.get(
  '/:id/matching-jobs',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req, req.query.agencyIds as string | undefined);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const activeClientId =
        typeof req.query.activeClientId === 'string' ? req.query.activeClientId : undefined;
      const statusRaw = req.query.status;
      const statuses =
        typeof statusRaw === 'string'
          ? (statusRaw.split(',') as ('draft' | 'open' | 'closed' | 'filled')[])
          : undefined;
      const rows = await listMatchingJobsForEmployee({
        employeeId: req.params.id,
        agencyIds,
        activeClientId,
        statuses,
      });
      if (rows === null) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: rows });
    } catch (err) {
      console.error('[employees/matching-jobs]', err);
      return res.status(500).json({ error: 'Failed to load matching jobs' });
    }
  },
);

employeesRouter.post(
  '/:id/assignments',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = assignmentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const subCompanyId = await resolveAgencyScope(req);
      if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

      const ctx = await ensureAccessContext(req);
      if (!ctx) return res.status(403).json({ error: 'Forbidden' });

      const result = await createEmployeeAssignment({
        input: {
          employeeId: req.params.id,
          targetType: parsed.data.targetType,
          clientId: parsed.data.clientId,
          activeClientId: parsed.data.activeClientId,
          jobId: parsed.data.jobId,
          isBackup: parsed.data.isBackup,
          allowSkillMismatch: parsed.data.allowSkillMismatch,
          workLocation: parsed.data.workLocation,
          positionTitle: parsed.data.positionTitle,
          payRate: parsed.data.payRate,
          shiftSchedule: parsed.data.shiftSchedule,
          expectedDuration: parsed.data.expectedDuration,
          supervisorInfo: parsed.data.supervisorInfo,
          requiredPpe: parsed.data.requiredPpe,
          workplaceHazards: parsed.data.workplaceHazards,
        },
        agencyIds,
        subCompanyId,
        submitterUserId: effectiveActorId(req),
        submitterRoleKey: ctx.roleKey,
        submitterPermissions: ctx.permissions,
      });
      return res.status(201).json({
        data: result.assignment,
        approval: result,
        clientTraining: 'clientTraining' in result ? result.clientTraining : undefined,
        assignmentEmail: 'assignmentEmail' in result ? result.assignmentEmail : undefined,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/assignments/create]', err);
      return res.status(500).json({ error: 'Failed to create assignment' });
    }
  },
);

const employeeTrainingSendSchema = z.object({
  url: z.string().min(1).max(2000),
  channel: z.enum(['email']).default('email'),
  title: z.string().max(255).optional().nullable(),
});

const assignmentTrainingSendSchema = z.object({
  message: z.string().min(1).max(500),
  channel: z.enum(['email', 'sms']).default('email'),
});

const trainingCertificateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fileBase64: z.string().min(1),
  mimeType: z.string().max(100).optional(),
});

employeesRouter.post(
  '/:id/trainings/ensure-defaults',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      await sendDefaultEmployeeTrainings({
        employeeId: req.params.id,
        sentByUserId: effectiveActorId(req),
        agencyIds,
      });
      const rows = await listEmployeeTrainings({
        employeeId: req.params.id,
        agencyIds,
      });
      return res.json({ data: rows });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/trainings/ensure-defaults]', err);
      return res.status(500).json({ error: 'Failed to ensure default trainings' });
    }
  },
);

employeesRouter.get(
  '/:id/trainings',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const rows = await listEmployeeTrainings({
        employeeId: req.params.id,
        agencyIds,
      });
      return res.json({ data: rows });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        return res.status(404).json({ error: (err as Error).message });
      }
      console.error('[employees/trainings/list]', err);
      return res.status(500).json({ error: 'Failed to load trainings' });
    }
  },
);

employeesRouter.post(
  '/:id/trainings/send',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = employeeTrainingSendSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const training = await sendEmployeeTrainingMessage({
        employeeId: req.params.id,
        url: parsed.data.url,
        channel: parsed.data.channel,
        title: parsed.data.title,
        sentByUserId: effectiveActorId(req),
        agencyIds,
      });
      return res.status(201).json({ data: training });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/trainings/send]', err);
      return res.status(500).json({ error: 'Failed to send training URL' });
    }
  },
);

employeesRouter.post(
  '/:id/trainings/:trainingId/resend',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const training = await resendEmployeeTrainingEmail({
        trainingId: req.params.trainingId,
        employeeId: req.params.id,
        sentByUserId: effectiveActorId(req),
        agencyIds,
      });
      return res.json({ data: training });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/trainings/resend]', err);
      return res.status(500).json({ error: 'Failed to resend training email' });
    }
  },
);

employeesRouter.post(
  '/:id/trainings/:trainingId/certificate',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = trainingCertificateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const training = await uploadEmployeeTrainingCertificate({
        trainingId: req.params.trainingId,
        employeeId: req.params.id,
        agencyIds,
        uploadedById: effectiveActorId(req),
        fileBase64: parsed.data.fileBase64,
        mimeType: parsed.data.mimeType,
        name: parsed.data.name,
      });
      return res.json({ data: training });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/trainings/certificate]', err);
      return res.status(500).json({ error: 'Failed to upload training certificate' });
    }
  },
);

employeesRouter.post(
  '/:id/assignments/:assignmentId/training/send',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = assignmentTrainingSendSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const assignment = await sendAssignmentTrainingMessage({
        assignmentId: req.params.assignmentId,
        employeeId: req.params.id,
        message: parsed.data.message,
        channel: parsed.data.channel,
        sentByUserId: effectiveActorId(req),
        agencyIds,
      });
      return res.json({ data: assignment });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/assignments/training/send]', err);
      return res.status(500).json({ error: 'Failed to send training message' });
    }
  },
);

employeesRouter.post(
  '/:id/assignments/:assignmentId/training/certificate',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = trainingCertificateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      const assignment = await uploadAssignmentTrainingCertificate({
        assignmentId: req.params.assignmentId,
        employeeId: req.params.id,
        agencyIds,
        uploadedById: effectiveActorId(req),
        fileBase64: parsed.data.fileBase64,
        mimeType: parsed.data.mimeType,
        name: parsed.data.name,
      });
      return res.status(201).json({ data: assignment });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/assignments/training/certificate]', err);
      return res.status(500).json({ error: 'Failed to upload training certificate' });
    }
  },
);

employeesRouter.post(
  '/:id/assignments/:assignmentId/end',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = z
        .object({
          endReason: z.enum(['work_complete', 'not_performing', 'other']),
          endNotes: z.string().optional().nullable(),
          rating: z.number().int().min(1).max(5),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      await endEmployeeAssignment({
        employeeId: req.params.id,
        assignmentId: req.params.assignmentId,
        agencyIds,
        actorUserId: effectiveActorId(req),
        ...parsed.data,
      });
      return res.json({ success: true });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/assignments/end]', err);
      return res.status(500).json({ error: 'Failed to end assignment' });
    }
  },
);

employeesRouter.post(
  '/:id/onboarding/send',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const subCompanyId = await resolveAgencyScope(req);
      if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });
      const result = await sendEmployeeOnboardingAgreement({
        employeeId: req.params.id,
        agencyIds,
        subCompanyId,
        actorId: effectiveActorId(req),
      });
      return res.json({ data: result });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/onboarding/send]', err);
      return res.status(500).json({ error: 'Failed to send onboarding agreement' });
    }
  },
);

employeesRouter.get(
  '/:id/onboarding/status',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const result = await getEmployeeOnboardingStatus(req.params.id, agencyIds);
      if (!result) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: result });
    } catch (err) {
      console.error('[employees/onboarding/status]', err);
      return res.status(500).json({ error: 'Failed to load onboarding status' });
    }
  },
);

employeesRouter.post(
  '/:id/onboarding/sync',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const result = await syncEmployeeOnboardingAgreement({
        employeeId: req.params.id,
        agencyIds,
        actorId: effectiveActorId(req),
      });
      return res.json({ data: result });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400 || status === 404 || status === 502) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/onboarding/sync]', err);
      return res.status(500).json({ error: 'Failed to sync onboarding agreement' });
    }
  },
);

employeesRouter.post(
  '/:id/approve',
  requirePermission('employees:approve'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const emp = await approveEmployee(req.params.id, agencyIds, effectiveActorId(req));
      if (!emp) return res.status(404).json({ error: 'Employee not found or not pending' });
      return res.json({ data: emp });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 400 || status === 404) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error('[employees/approve]', err);
      return res.status(500).json({ error: 'Failed to approve employee' });
    }
  },
);

employeesRouter.post(
  '/:id/reject',
  requirePermission('employees:approve'),
  async (req: Request, res: Response) => {
    try {
      const parsed = rejectBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const emp = await rejectEmployee(
        req.params.id,
        agencyIds,
        effectiveActorId(req),
        parsed.data.reason,
      );
      if (!emp) return res.status(404).json({ error: 'Employee not found or not pending' });
      return res.json({ data: emp });
    } catch (err) {
      console.error('[employees/reject]', err);
      return res.status(500).json({ error: 'Failed to reject employee' });
    }
  },
);

employeesRouter.post(
  '/:id/notes',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = noteBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const user = req.user!;
      const userName = user.email || 'User';
      const emp = await addEmployeeNote(
        req.params.id,
        agencyIds,
        effectiveActorId(req),
        userName,
        parsed.data.content,
      );
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ data: emp });
    } catch (err) {
      console.error('[employees/notes]', err);
      return res.status(500).json({ error: 'Failed to add note' });
    }
  },
);

employeesRouter.post(
  '/:id/documents',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = uploadBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      let expiryDate: Date | null | undefined;
      try {
        expiryDate = parseExpiryDateInput(parsed.data.expiryDate);
      } catch (err: unknown) {
        return res.status(400).json({ error: (err as Error).message });
      }

      const doc = await uploadEmployeeDocument({
        employeeId: req.params.id,
        agencyIds,
        uploadedById: effectiveActorId(req),
        name: parsed.data.name,
        fileBase64: parsed.data.fileBase64,
        mimeType: parsed.data.mimeType,
        type: parsed.data.type,
        expiryDate,
      });
      if (!doc) return res.status(404).json({ error: 'Employee not found' });
      return res.status(201).json({ data: doc });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400) {
        return res.status(400).json({ error: (err as Error).message });
      }
      console.error('[employees/documents]', err);
      return res.status(500).json({ error: 'Failed to upload document' });
    }
  },
);

employeesRouter.patch(
  '/:id/documents/:docId',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const parsed = patchDocumentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      }
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });

      let expiryDate: Date | null;
      try {
        expiryDate = parseExpiryDateInput(parsed.data.expiryDate) ?? null;
      } catch (err: unknown) {
        return res.status(400).json({ error: (err as Error).message });
      }

      const doc = await updateEmployeeDocumentExpiry({
        employeeId: req.params.id,
        docId: req.params.docId,
        agencyIds,
        expiryDate,
      });
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      return res.json({ data: doc });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 400) {
        return res.status(400).json({ error: (err as Error).message });
      }
      console.error('[employees/documents/patch]', err);
      return res.status(500).json({ error: 'Failed to update document' });
    }
  },
);

employeesRouter.get(
  '/:id/documents/:docId/download',
  requirePermission('employees:read'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const result = await getEmployeeDocumentBuffer(req.params.id, req.params.docId, agencyIds);
      if (!result) return res.status(404).json({ error: 'Document not found' });
      if (!result.body) {
        if (result.url.startsWith('http')) {
          return res.redirect(result.url);
        }
        return res.status(404).json({ error: 'File not found in storage' });
      }
      const isPdf =
        result.contentType.includes('pdf') ||
        result.fileName.toLowerCase().endsWith('.pdf');
      res.setHeader('Content-Type', result.contentType);
      res.setHeader(
        'Content-Disposition',
        `${isPdf ? 'inline' : 'attachment'}; filename="${encodeURIComponent(result.fileName)}"`,
      );
      return res.send(result.body);
    } catch (err) {
      console.error('[employees/documents/download]', err);
      return res.status(500).json({ error: 'Failed to download document' });
    }
  },
);

employeesRouter.delete(
  '/:id/documents/:docId',
  requirePermission('employees:write'),
  async (req: Request, res: Response) => {
    try {
      const agencyIds = await resolveAgencyIds(req);
      if (!agencyIds?.length) return res.status(403).json({ error: 'Agency context required' });
      const ok = await deleteEmployeeDocument(req.params.id, req.params.docId, agencyIds);
      if (!ok) return res.status(404).json({ error: 'Document not found' });
      return res.status(204).send();
    } catch (err) {
      console.error('[employees/documents/delete]', err);
      return res.status(500).json({ error: 'Failed to delete document' });
    }
  },
);
