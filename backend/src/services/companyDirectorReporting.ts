import prisma from '../config/database';

/** Active Company Director user for an agency, if any. */
export async function findActiveCompanyDirectorForAgency(subCompanyId: string): Promise<string | null> {
  const row = await prisma.user.findFirst({
    where: { subCompanyId, role: 'company_director', isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return row?.id ?? null;
}

/** Org Director user ids for the same main org as an agency (includes org-level directors with no home agency). */
export async function findOrgDirectorIdsForAgency(subCompanyId: string): Promise<string[]> {
  const agency = await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: { mainOrgId: true },
  });
  if (!agency?.mainOrgId) return [];

  const ids = new Set<string>();

  const linked = await prisma.user.findMany({
    where: {
      role: 'director',
      isActive: true,
      subCompany: { mainOrgId: agency.mainOrgId },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const u of linked) ids.add(u.id);

  // Org-level directors (subCompanyId null) — include when agency users report to them
  const orgLevelDirectors = await prisma.user.findMany({
    where: { role: 'director', isActive: true, subCompanyId: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const d of orgLevelDirectors) {
    const usedInAgency = await prisma.user.count({
      where: {
        subCompanyId,
        isActive: true,
        reportingManagerIds: { has: d.id },
      },
    });
    if (usedInAgency > 0) ids.add(d.id);
  }

  return [...ids];
}

/** Org Director for the same main org as an agency (cross-agency tree root). */
export async function findOrgDirectorForAgency(subCompanyId: string): Promise<string | null> {
  const ids = await findOrgDirectorIdsForAgency(subCompanyId);
  return ids[0] ?? null;
}

/** Company Director defaults to reporting to org Director. */
export async function resolveCompanyDirectorReportingIds(subCompanyId: string): Promise<string[]> {
  const orgDirectorId = await findOrgDirectorForAgency(subCompanyId);
  return orgDirectorId ? [orgDirectorId] : [];
}

/** Default Sales Manager reporting to agency Company Director when none provided. */
export async function resolveSalesManagerReportingIds(
  subCompanyId: string,
  reportingManagerIds: string[] | undefined,
): Promise<string[]> {
  const cdId = await findActiveCompanyDirectorForAgency(subCompanyId);
  if (!cdId) return reportingManagerIds ?? [];

  const ids = reportingManagerIds ?? [];
  if (ids.length === 0) return [cdId];

  const managerUsers = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { role: true },
  });
  if (managerUsers.some((m) => m.role === 'director')) return [cdId];

  return ids;
}

/** Enforce SM → agency CD when a Company Director exists for that agency. */
export async function validateSalesManagerReporting(
  subCompanyId: string,
  reportingManagerIds: string[],
): Promise<string | null> {
  const cdId = await findActiveCompanyDirectorForAgency(subCompanyId);
  if (!cdId) return null;
  if (!reportingManagerIds.length) {
    return 'Sales Manager must report to the agency Company Director when one is assigned.';
  }
  if (!reportingManagerIds.includes(cdId)) {
    return 'Sales Manager must report to the agency Company Director when one is assigned.';
  }
  return null;
}

/** After assigning a Company Director, point agency SMs still on org Director to the CD. */
export async function repointSalesManagersToCompanyDirector(subCompanyId: string): Promise<number> {
  const cdId = await findActiveCompanyDirectorForAgency(subCompanyId);
  if (!cdId) return 0;

  const orgDirectorId = await findOrgDirectorForAgency(subCompanyId);
  const inactiveCdIds = (
    await prisma.user.findMany({
      where: { subCompanyId, role: 'company_director', isActive: false },
      select: { id: true },
    })
  ).map((u) => u.id);

  const salesManagers = await prisma.user.findMany({
    where: { subCompanyId, role: 'sales_manager', isActive: true },
    select: { id: true, reportingManagerIds: true },
  });

  let updated = 0;
  for (const sm of salesManagers) {
    if (sm.reportingManagerIds.includes(cdId)) continue;
    const reportsToOrgDirector = Boolean(orgDirectorId && sm.reportingManagerIds.includes(orgDirectorId));
    const reportsToInactiveCd = sm.reportingManagerIds.some((id) => inactiveCdIds.includes(id));
    const unassigned = sm.reportingManagerIds.length === 0;
    if (!reportsToOrgDirector && !reportsToInactiveCd && !unassigned) continue;
    await prisma.user.update({
      where: { id: sm.id },
      data: { reportingManagerIds: [cdId] },
    });
    updated++;
  }
  return updated;
}

/** One active Company Director per agency. */
export async function validateNewCompanyDirectorForAgency(subCompanyId: string): Promise<string | null> {
  const existing = await findActiveCompanyDirectorForAgency(subCompanyId);
  if (existing) {
    return 'This agency already has an active Company Director. Deactivate the existing one before assigning another.';
  }
  return null;
}
