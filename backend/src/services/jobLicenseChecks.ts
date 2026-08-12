/**
 * Job license requirement enforcement.
 * Licenses live as EmployeeDocument rows named `license — <LicenseType> — <fileName>`
 * (uploaded from the employee form) with an expiry date. A job with
 * licenseRequired demands one non-expired license doc per required type.
 */
import prisma from '../config/database';

const LICENSE_NAME_PREFIX = 'license — ';

export type JobLicenseFields = {
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
};

export type LicenseDocFields = {
  name: string;
  expiryDate: Date | null;
};

export type LicenseCheckResult = {
  ok: boolean;
  missing: string[];
  expired: string[];
};

/** Sync check against already-loaded license documents. */
export function evaluateEmployeeJobLicenses(
  docs: LicenseDocFields[],
  job: JobLicenseFields,
  now: Date = new Date(),
): LicenseCheckResult {
  if (!job.licenseRequired) return { ok: true, missing: [], expired: [] };
  const requiredTypes = job.requiredLicenseTypes.filter((t) => t.trim());
  if (requiredTypes.length === 0) return { ok: true, missing: [], expired: [] };

  const missing: string[] = [];
  const expired: string[] = [];

  for (const type of requiredTypes) {
    const typePrefix = `${LICENSE_NAME_PREFIX}${type}`.toLowerCase();
    const matches = docs.filter((d) => {
      const name = d.name.toLowerCase();
      // Exact `license — <type>` or `license — <type> — <fileName>` so one
      // type can't prefix-match another.
      return name === typePrefix || name.startsWith(`${typePrefix} — `);
    });
    if (matches.length === 0) {
      missing.push(type);
    } else if (!matches.some((d) => d.expiryDate != null && d.expiryDate > now)) {
      expired.push(type);
    }
  }

  return { ok: missing.length === 0 && expired.length === 0, missing, expired };
}

export function employeeHasValidLicensesForJob(
  docs: LicenseDocFields[],
  job: JobLicenseFields,
  now?: Date,
): boolean {
  return evaluateEmployeeJobLicenses(docs, job, now).ok;
}

export async function loadEmployeeLicenseDocs(
  employeeId: string,
): Promise<LicenseDocFields[]> {
  return prisma.employeeDocument.findMany({
    where: {
      employeeId,
      name: { startsWith: LICENSE_NAME_PREFIX, mode: 'insensitive' },
    },
    select: { name: true, expiryDate: true },
  });
}

/**
 * Throws a 400 error listing missing/expired license types when the employee
 * does not satisfy the job's license requirement. No-op when the job doesn't
 * require licenses.
 */
export async function assertEmployeeMeetsJobLicenses(
  employeeId: string,
  job: JobLicenseFields,
): Promise<void> {
  const docs = await loadEmployeeLicenseDocs(employeeId);
  const result = evaluateEmployeeJobLicenses(docs, job);
  if (result.ok) return;

  const parts: string[] = [];
  if (result.missing.length > 0) {
    parts.push(`Employee is missing a valid license: ${result.missing.join(', ')}`);
  }
  if (result.expired.length > 0) {
    parts.push(`Employee license is expired: ${result.expired.join(', ')}`);
  }
  throw Object.assign(new Error(parts.join('. ')), { status: 400 });
}
