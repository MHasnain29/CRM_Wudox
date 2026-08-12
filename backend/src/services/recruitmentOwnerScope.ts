/**
 * Owner ("my records") filter for the agency-scoped recruitment list pages
 * (Jobs, Employees, Active Clients, Job Matches).
 *
 * These lists are scoped by agency; this layers an OPTIONAL owner filter keyed
 * on a creator field (Job.createdById / Employee.addedById / ActiveClient.createdById).
 *
 * Contract (matches the marketing list routes):
 *  - No `ownerIds` in the query → returns null → no owner narrowing (unchanged behavior).
 *  - Linked / act-as → expand across the link group (own/team/agency per role).
 *  - Otherwise fail-closed with a leak guard:
 *      · agency/global scope → may filter by any requested ids (already allowed to see them)
 *      · team scope → intersect requested ids with own reportees (+ self)
 *      · own scope → forced to self only
 *
 * The frontend sends `ownerIds=[self]` for the own-default (no chip) case, so
 * "no chip selected → my records" holds for every role, including directors.
 */
import type { Request } from 'express';
import prisma from '../config/database';
import {
  expandLinkedOwnerScope,
  linkedExpansionToWhere,
  ownerExactFromQuery,
} from './linkedOwnerExpand';
import { ensureAccessContext } from '../utils/requestPermission';
import { canViewAllDataInAgency, canViewTeamData } from './accessContext';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function resolveRecruitmentOwnerWhere(
  req: Request,
  ownerField: 'createdById' | 'addedById',
  agencyIds: string[],
): Promise<Record<string, unknown> | null> {
  const raw = typeof req.query.ownerIds === 'string' ? req.query.ownerIds : '';
  const ownerIdsList = raw ? raw.split(',').filter((id) => UUID_RE.test(id)) : [];
  if (ownerIdsList.length === 0) return null;

  const userId = req.user!.sub;

  // Linked anchors / act-as: expand own/team/agency scopes across the link group.
  const linked = await expandLinkedOwnerScope(
    userId,
    req.user!.subCompanyId,
    ownerIdsList,
    { exact: ownerExactFromQuery(req.query) },
  );
  if (linked) {
    return linkedExpansionToWhere(linked, ownerField);
  }

  const ctx = await ensureAccessContext(req);
  if (ctx && canViewAllDataInAgency(ctx)) {
    return { [ownerField]: { in: ownerIdsList } };
  }
  if (ctx && canViewTeamData(ctx)) {
    const reportees = await prisma.user.findMany({
      where: {
        subCompanyId: agencyIds[0],
        OR: [{ id: userId }, { reportingManagerIds: { has: userId } }],
      },
      select: { id: true },
    });
    const allowed = new Set(reportees.map((u) => u.id));
    const safe = ownerIdsList.filter((id) => allowed.has(id));
    return { [ownerField]: { in: safe.length > 0 ? safe : [userId] } };
  }
  // Own scope — only ever your own records.
  return { [ownerField]: userId };
}
