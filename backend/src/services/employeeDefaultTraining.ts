/**
 * Default onboarding trainings sent when an employee moves to Pending:
 * Ontario Health & Safety 4 Steps + WHMIS.
 */
import prisma from '../config/database';
import { sendEmployeeDefaultTrainingsEmail } from './email';
import { recordOutboundSentEmail } from './recordOutboundSentEmail';
import {
  formatTrainingSendError,
  resolveTrainingOutboundSender,
} from './trainingOutboundSender';

export const DEFAULT_EMPLOYEE_TRAININGS = [
  {
    title: 'Ontario Health & Safety — 4 Steps',
    url: 'https://www.labour.gov.on.ca/english/hs/elearn/worker/foursteps.php',
  },
  {
    title: 'WHMIS',
    url: 'https://aixsafety.com/',
  },
] as const;

export const DEFAULT_TRAINING_REQUIRED_COUNT = DEFAULT_EMPLOYEE_TRAININGS.length;

function normalizeUrlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function isDefaultTrainingUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const key = normalizeUrlKey(url);
  return DEFAULT_EMPLOYEE_TRAININGS.some((t) => normalizeUrlKey(t.url) === key);
}

/** Prefer stored title; otherwise map known default URLs. */
export function resolveTrainingTitle(
  title: string | null | undefined,
  url: string | null | undefined,
): string | null {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  if (!url?.trim()) return null;
  const key = normalizeUrlKey(url);
  const match = DEFAULT_EMPLOYEE_TRAININGS.find((t) => normalizeUrlKey(t.url) === key);
  return match?.title ?? null;
}

/** How many of the required default trainings have a certificate uploaded. */
export async function getDefaultTrainingCompletion(employeeId: string): Promise<{
  completedCount: number;
  requiredCount: number;
}> {
  const rows = await prisma.employeeTraining.findMany({
    where: { employeeId },
    select: { url: true, completedAt: true },
  });

  let completedCount = 0;
  for (const def of DEFAULT_EMPLOYEE_TRAININGS) {
    const key = normalizeUrlKey(def.url);
    const match = rows.find(
      (r) => r.url && normalizeUrlKey(r.url) === key && r.completedAt != null,
    );
    if (match) completedCount += 1;
  }

  return { completedCount, requiredCount: DEFAULT_TRAINING_REQUIRED_COUNT };
}

export async function assertEmployeeTrainingsComplete(employeeId: string): Promise<void> {
  const { completedCount, requiredCount } = await getDefaultTrainingCompletion(employeeId);
  if (completedCount < requiredCount) {
    throw Object.assign(
      new Error(
        `Both default trainings must be completed before Master (${completedCount}/${requiredCount} certificates uploaded). Open Training to upload certificates.`,
      ),
      { status: 400 },
    );
  }
}

function isPandaDocComplete(status: string | null | undefined): boolean {
  return status === 'document.completed' || status === 'document.paid';
}

export type EmployeeReadiness = {
  agreementStatus: 'incomplete' | 'complete';
  trainingCompletedCount: number;
  trainingRequiredCount: number;
};

/** Batch readiness for list/detail serialize (no N+1). */
export async function loadEmployeeReadinessMap(
  employees: Array<{
    id: string;
    onboardingPandaDocStatus?: string | null;
  }>,
): Promise<Map<string, EmployeeReadiness>> {
  const map = new Map<string, EmployeeReadiness>();
  if (employees.length === 0) return map;

  const ids = employees.map((e) => e.id);
  const [agreementDocs, trainings] = await Promise.all([
    prisma.employeeDocument.findMany({
      where: { employeeId: { in: ids }, type: 'agreement' },
      select: { employeeId: true },
      distinct: ['employeeId'],
    }),
    prisma.employeeTraining.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true, url: true, completedAt: true },
    }),
  ]);

  const hasAgreement = new Set(agreementDocs.map((d) => d.employeeId));
  const trainingsByEmployee = new Map<string, Array<{ url: string | null; completedAt: Date | null }>>();
  for (const t of trainings) {
    const list = trainingsByEmployee.get(t.employeeId) ?? [];
    list.push(t);
    trainingsByEmployee.set(t.employeeId, list);
  }

  for (const emp of employees) {
    const agreementComplete =
      isPandaDocComplete(emp.onboardingPandaDocStatus) || hasAgreement.has(emp.id);

    const rows = trainingsByEmployee.get(emp.id) ?? [];
    let completedCount = 0;
    for (const def of DEFAULT_EMPLOYEE_TRAININGS) {
      const key = normalizeUrlKey(def.url);
      if (rows.some((r) => r.url && normalizeUrlKey(r.url) === key && r.completedAt != null)) {
        completedCount += 1;
      }
    }

    map.set(emp.id, {
      agreementStatus: agreementComplete ? 'complete' : 'incomplete',
      trainingCompletedCount: completedCount,
      trainingRequiredCount: DEFAULT_TRAINING_REQUIRED_COUNT,
    });
  }

  return map;
}

/**
 * Ensure default training rows exist and email both links.
 * By default emails only when new rows are created (avoid spam).
 * Pass forceEmail: true (onboarding send) to always attempt delivery.
 * Does not throw on email failure — returns emailed/error for the caller.
 */
export async function sendDefaultEmployeeTrainings(params: {
  employeeId: string;
  sentByUserId: string;
  agencyIds: string[];
  /** When true, always attempt the training email even if rows already exist. */
  forceEmail?: boolean;
}): Promise<{ created: number; emailed: boolean; error?: string }> {
  const emp = await prisma.employee.findFirst({
    where: {
      id: params.employeeId,
      addedBy: {
        subCompanyId:
          params.agencyIds.length === 1 ? params.agencyIds[0] : { in: params.agencyIds },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      addedBy: { select: { subCompanyId: true } },
    },
  });
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  const existing = await prisma.employeeTraining.findMany({
    where: { employeeId: emp.id },
    select: { url: true },
  });
  const existingKeys = new Set(
    existing.filter((r) => r.url).map((r) => normalizeUrlKey(r.url!)),
  );

  const missing = DEFAULT_EMPLOYEE_TRAININGS.filter(
    (t) => !existingKeys.has(normalizeUrlKey(t.url)),
  );

  const now = new Date();
  let created = 0;
  if (missing.length > 0) {
    for (const t of missing) {
      const row = await prisma.employeeTraining.create({
        data: {
          employeeId: emp.id,
          url: t.url,
          sentAt: now,
          channel: 'email',
          sentById: params.sentByUserId,
        },
      });
      created += 1;
      try {
        await prisma.$executeRaw`
          UPDATE "employee_trainings" SET "title" = ${t.title} WHERE "id" = ${row.id}
        `;
      } catch (err) {
        console.warn('[employeeDefaultTraining] could not set title (run migration?)', err);
      }
    }
  }

  const shouldEmail = created > 0 || Boolean(params.forceEmail);
  if (!shouldEmail) {
    return { created: 0, emailed: false };
  }

  const email = emp.email?.trim();
  if (!email) {
    return {
      created,
      emailed: false,
      error: 'Employee email is required to send training email',
    };
  }

  const subCompanyId = emp.addedBy.subCompanyId ?? params.agencyIds[0]!;
  const candidateName = `${emp.firstName} ${emp.lastName}`.trim();

  const outbound = await resolveTrainingOutboundSender({
    sentByUserId: params.sentByUserId,
    subCompanyId,
  });
  if (!outbound.ok) {
    return { created, emailed: false, error: outbound.error };
  }

  try {
    const sent = await sendEmployeeDefaultTrainingsEmail({
      toEmail: email,
      candidateName,
      sentByName: outbound.sender.sentByName,
      trainings: DEFAULT_EMPLOYEE_TRAININGS.map((t) => ({ title: t.title, url: t.url })),
      agency: outbound.sender.agency,
      from: outbound.sender.from,
    });
    await recordOutboundSentEmail({
      fromUserId: params.sentByUserId,
      fromName: outbound.sender.from.name,
      fromEmail: outbound.sender.from.email,
      subject: sent.subject,
      body: sent.html,
      subCompanyId,
      to: [{ name: candidateName, email }],
      source: 'employee_default_training',
    });
    return { created, emailed: true };
  } catch (err) {
    console.error('[employeeDefaultTraining] failed to send training email', err);
    return { created, emailed: false, error: formatTrainingSendError(err) };
  }
}
