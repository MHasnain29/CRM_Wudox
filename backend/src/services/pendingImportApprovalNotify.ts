import prisma from '../config/database';
import { emitToUsers } from '../socket';
import { GLOBAL_APPROVAL_SCOPE } from '../types/approval';
import { dispatchNotificationToUser } from './notificationDispatch';

export type ImportUploaderApprovalGroup = {
  importedById: string;
  count: number;
  sampleName: string;
  clientId: string;
};

export function groupUploaderApprovals(
  rows: Array<{ importedById: string; name: string; clientId: string }>,
): ImportUploaderApprovalGroup[] {
  const map = new Map<string, ImportUploaderApprovalGroup>();
  for (const row of rows) {
    if (!row.importedById) continue;
    const cur = map.get(row.importedById);
    if (!cur) {
      map.set(row.importedById, {
        importedById: row.importedById,
        count: 1,
        sampleName: row.name,
        clientId: row.clientId,
      });
    } else {
      cur.count += 1;
    }
  }
  return [...map.values()];
}

/** In-app notice to whoever uploaded the CSV (one per uploader, not per row). */
export async function notifyImportUploadersOfApproval(params: {
  subCompanyId: string;
  actorUserId: string;
  groups: ImportUploaderApprovalGroup[];
}): Promise<void> {
  const groups = params.groups.filter(
    (g) => g.importedById && g.count > 0 && g.importedById !== params.actorUserId,
  );
  if (groups.length === 0) return;

  let subCompanyId = params.subCompanyId;
  if (!subCompanyId || subCompanyId === GLOBAL_APPROVAL_SCOPE) {
    const importer = await prisma.user.findUnique({
      where: { id: groups[0].importedById },
      select: { subCompanyId: true },
    });
    subCompanyId =
      importer?.subCompanyId ??
      (await prisma.subCompany.findFirst({ select: { id: true }, orderBy: { name: 'asc' } }))?.id ??
      '';
  }
  if (!subCompanyId) return;

  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { firstName: true, lastName: true, email: true },
  });
  const actorName =
    [actor?.firstName, actor?.lastName].filter(Boolean).join(' ').trim() || actor?.email || 'Reviewer';

  for (const g of groups) {
    const entityLabel = g.count === 1 ? g.sampleName : `${g.count} imported clients`;
    await dispatchNotificationToUser({
      eventKey: 'client_import_approved',
      userId: g.importedById,
      subCompanyId,
      context: {
        entityLabel,
        actorName,
        count: String(g.count),
      },
      link: g.count === 1 ? `/clients?client=${encodeURIComponent(g.clientId)}` : '/clients',
      relatedId: g.clientId,
    }).catch((err) => console.error('Import approval uploader notification failed', err));
  }

  emitToUsers(
    [...groups.map((g) => g.importedById), params.actorUserId],
    'client:refresh',
    { subCompanyId },
  );
}
