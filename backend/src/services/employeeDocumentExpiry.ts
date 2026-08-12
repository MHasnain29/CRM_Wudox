/**
 * Agency-scoped list of employee documents that are expired or expiring soon.
 */
import prisma from '../config/database';

export type ExpiringDocStatus = 'expired' | 'expiring';

export type ExpiringDocumentRow = {
  documentId: string;
  documentName: string;
  documentType: string;
  expiryDate: string;
  status: ExpiringDocStatus;
  daysUntil: number;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
};

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export async function listExpiringEmployeeDocuments(params: {
  agencyIds: string[];
  withinDays?: number;
  page?: number;
  limit?: number;
}): Promise<{
  data: ExpiringDocumentRow[];
  total: number;
  page: number;
  limit: number;
  expiredCount: number;
  expiringCount: number;
}> {
  const withinDays = Math.min(Math.max(params.withinDays ?? 90, 1), 365);
  const page = Math.max(params.page ?? 1, 1);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
  const today = startOfTodayUtc();
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() + withinDays);

  const agencyFilter =
    params.agencyIds.length === 1 ? params.agencyIds[0]! : { in: params.agencyIds };

  const where = {
    expiryDate: { not: null, lte: cutoff },
    employee: {
      addedBy: { subCompanyId: agencyFilter },
    },
  };

  const [total, expiredCount, expiringCount, rows] = await Promise.all([
    prisma.employeeDocument.count({ where }),
    prisma.employeeDocument.count({
      where: { ...where, expiryDate: { not: null, lt: today } },
    }),
    prisma.employeeDocument.count({
      where: { ...where, expiryDate: { not: null, gte: today, lte: cutoff } },
    }),
    prisma.employeeDocument.findMany({
      where,
      orderBy: { expiryDate: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        type: true,
        expiryDate: true,
        employee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  const data: ExpiringDocumentRow[] = rows.map((row) => {
    const expiry = row.expiryDate!;
    const expiryDay = new Date(
      Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate()),
    );
    const daysUntil = daysBetween(today, expiryDay);
    const status: ExpiringDocStatus = daysUntil < 0 ? 'expired' : 'expiring';
    return {
      documentId: row.id,
      documentName: row.name,
      documentType: row.type,
      expiryDate: expiryDay.toISOString().slice(0, 10),
      status,
      daysUntil,
      employeeId: row.employee.id,
      employeeFirstName: row.employee.firstName,
      employeeLastName: row.employee.lastName,
    };
  });

  return { data, total, page, limit, expiredCount, expiringCount };
}

/** Parse YYYY-MM-DD or ISO datetime into a Date (UTC midnight for date-only). */
export function parseExpiryDateInput(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('Invalid expiryDate'), { status: 400 });
  }
  return parsed;
}
