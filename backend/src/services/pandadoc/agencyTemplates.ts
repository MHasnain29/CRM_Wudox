import prisma from '../../config/database';

export type ProposalTemplateRole = 'temp' | 'direct' | 'both';

export type PandaDocTemplateAgencyMeta = {
  id: string;
  name: string;
  /** Which proposal-type slots this template fills for this agency. */
  roles: ProposalTemplateRole[];
};

/**
 * Template IDs this agency may list/send — from Settings → Proposal Templates
 * (temp / direct / both). Fail-closed: no row or all null → [].
 */
export async function getAllowedPandaDocTemplateIds(subCompanyId: string): Promise<string[]> {
  if (!subCompanyId) return [];
  const row = await prisma.proposalTypeTemplateMapping.findUnique({
    where: { subCompanyId },
    select: {
      tempTemplateId: true,
      directTemplateId: true,
      bothTemplateId: true,
    },
  });
  if (!row) return [];
  return idsFromMappingRow(row);
}

/** Union of mapped template IDs across many agencies (All Agencies view). */
export async function getAllowedPandaDocTemplateIdsForAgencies(
  subCompanyIds: string[],
): Promise<string[]> {
  const ids = [...new Set(subCompanyIds.filter(Boolean))];
  if (ids.length === 0) return [];
  if (ids.length === 1) return getAllowedPandaDocTemplateIds(ids[0]);

  const rows = await prisma.proposalTypeTemplateMapping.findMany({
    where: { subCompanyId: { in: ids } },
    select: {
      tempTemplateId: true,
      directTemplateId: true,
      bothTemplateId: true,
    },
  });
  const out = new Set<string>();
  for (const row of rows) {
    for (const id of idsFromMappingRow(row)) out.add(id);
  }
  return [...out];
}

/**
 * For each PandaDoc template ID: agencies that map it, plus Temp / Direct / Both roles.
 * Used on Documents cards for clear labeling.
 */
export async function getPandaDocTemplateMappingMeta(
  subCompanyIds: string[],
): Promise<Map<string, PandaDocTemplateAgencyMeta[]>> {
  const ids = [...new Set(subCompanyIds.filter(Boolean))];
  const map = new Map<string, PandaDocTemplateAgencyMeta[]>();
  if (ids.length === 0) return map;

  const rows = await prisma.proposalTypeTemplateMapping.findMany({
    where: { subCompanyId: { in: ids } },
    select: {
      tempTemplateId: true,
      directTemplateId: true,
      bothTemplateId: true,
      subCompany: { select: { id: true, name: true } },
    },
  });

  for (const row of rows) {
    const agencyId = row.subCompany.id;
    const agencyName = row.subCompany.name;
    const byTemplate = new Map<string, ProposalTemplateRole[]>();

    const add = (tid: string | null, role: ProposalTemplateRole) => {
      if (!tid) return;
      const roles = byTemplate.get(tid) ?? [];
      if (!roles.includes(role)) roles.push(role);
      byTemplate.set(tid, roles);
    };
    add(row.tempTemplateId, 'temp');
    add(row.directTemplateId, 'direct');
    add(row.bothTemplateId, 'both');

    for (const [tid, roles] of byTemplate) {
      const list = map.get(tid) ?? [];
      const existing = list.find((a) => a.id === agencyId);
      if (existing) {
        for (const r of roles) {
          if (!existing.roles.includes(r)) existing.roles.push(r);
        }
      } else {
        list.push({ id: agencyId, name: agencyName, roles });
      }
      map.set(tid, list);
    }
  }
  return map;
}

/** @deprecated Prefer getPandaDocTemplateMappingMeta */
export async function getPandaDocTemplateAgencyLabels(
  subCompanyIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const rich = await getPandaDocTemplateMappingMeta(subCompanyIds);
  const map = new Map<string, { id: string; name: string }[]>();
  for (const [tid, list] of rich) {
    map.set(
      tid,
      list.map(({ id, name }) => ({ id, name })),
    );
  }
  return map;
}

export function filterTemplatesByAllowedIds<T extends { id: string }>(
  templates: T[],
  allowedIds: string[],
): T[] {
  if (allowedIds.length === 0) return [];
  const allowed = new Set(allowedIds);
  return templates.filter((t) => allowed.has(t.id));
}

function idsFromMappingRow(row: {
  tempTemplateId: string | null;
  directTemplateId: string | null;
  bothTemplateId: string | null;
}): string[] {
  return [...new Set(
    [row.tempTemplateId, row.directTemplateId, row.bothTemplateId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  )];
}
