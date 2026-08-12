import type { Request } from 'express';
import prisma from '../config/database';
import { getUserIdsWithPermissionInAgency } from './accessContext';
import { requestHasPermission } from '../utils/requestPermission';

export async function canReviewProposals(req: Request): Promise<boolean> {
  return requestHasPermission(req, 'proposals:review');
}

export async function proposalReviewerIds(subCompanyId: string): Promise<string[]> {
  return getUserIdsWithPermissionInAgency(subCompanyId, 'proposals:review');
}

export async function findActiveProposalReviewers(subCompanyId: string) {
  const ids = await getUserIdsWithPermissionInAgency(subCompanyId, 'proposals:review');
  if (ids.length === 0) return [];
  return prisma.user.findMany({
    where: { subCompanyId, isActive: true, id: { in: ids } },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
}
