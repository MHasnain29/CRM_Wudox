import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';

export const updateClientContactSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  phoneExtension: z.string().max(20).optional(),
  linkedin: z.string().url().optional().or(z.literal('')),
  website: z.string().url().optional().or(z.literal('')),
  isPrimary: z.boolean().optional(),
});

export const updateClientSchema = z.object({
  name: z.string().min(1).max(500),
  industry: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  address: z.string().max(1000).optional(),
  companySize: z.string().max(100).optional(),
  tags: z.array(z.string().min(1).max(100).trim()).optional(),
  contacts: z.array(updateClientContactSchema).min(1).max(50),
  locationAddress: z
    .object({
      unit: z.string().max(50).optional(),
      streetAddress: z.string().max(300).optional(),
      city: z.string().max(100).optional(),
      region: z.string().max(100).optional(),
      postalCode: z.string().max(20).optional(),
      country: z.string().max(50).optional(),
    })
    .optional(),
});

export type UpdateClientBody = z.infer<typeof updateClientSchema>;

type DbClientTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function normalizeContacts(contacts: UpdateClientBody['contacts']) {
  const primaryContactIndex = contacts.findIndex((contact) => contact.isPrimary === true);
  return contacts.map((contact, index) => ({
    ...contact,
    isPrimary: primaryContactIndex >= 0 ? index === primaryContactIndex : index === 0,
  }));
}

export function pendingEditToUpdateBody(row: {
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  tags: string[];
  contacts: unknown;
  locationAddress: unknown;
}): UpdateClientBody | null {
  const contactsRaw = row.contacts;
  const loc = row.locationAddress;
  const raw = {
    name: row.name,
    industry: row.industry ?? undefined,
    location: row.location ?? undefined,
    address: row.address ?? undefined,
    companySize: row.companySize ?? undefined,
    tags: row.tags?.length ? row.tags : undefined,
    contacts: Array.isArray(contactsRaw) ? contactsRaw : [],
    locationAddress:
      loc && typeof loc === 'object' && !Array.isArray(loc)
        ? (loc as UpdateClientBody['locationAddress'])
        : undefined,
  };
  const parsed = updateClientSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Apply approved client detail changes (shared by director approve + auto-approve job). */
export async function performManualClientUpdate(
  tx: DbClientTx,
  params: {
    clientId: string;
    subCompanyId: string;
    data: UpdateClientBody;
  },
) {
  const { clientId, subCompanyId, data } = params;
  const normalizedContacts = normalizeContacts(data.contacts);
  const uniqueTags = [...new Set((data.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];

  const client = await tx.client.update({
    where: { id: clientId },
    data: {
      name: data.name.trim(),
      industry: data.industry?.trim() ?? null,
      location: data.location?.trim() ?? null,
      address: data.address?.trim() ?? null,
      companySize: data.companySize?.trim() ?? null,
      updatedAt: new Date(),
    },
  });

  const existingContacts = await tx.clientContact.findMany({
    where: { clientId },
    select: { id: true },
  });
  const existingIds = new Set(existingContacts.map((c) => c.id));
  const incomingIds = new Set(
    normalizedContacts.map((c) => c.id).filter((id): id is string => !!id && existingIds.has(id)),
  );

  for (const contact of normalizedContacts) {
    const payload = {
      name: contact.name.trim(),
      title: contact.title?.trim() ?? null,
      email: contact.email?.trim() || null,
      phone: contact.phone?.trim() ?? null,
      phoneExtension: contact.phoneExtension?.trim() ?? null,
      linkedin: contact.linkedin?.trim() || null,
      website: contact.website?.trim() || null,
      isPrimary: contact.isPrimary,
    };
    if (contact.id && existingIds.has(contact.id)) {
      await tx.clientContact.update({ where: { id: contact.id }, data: payload });
    } else {
      await tx.clientContact.create({ data: { clientId, ...payload } });
    }
  }

  const removableIds = [...existingIds].filter((id) => !incomingIds.has(id));
  if (removableIds.length > 0 && existingIds.size - removableIds.length >= 1) {
    await tx.clientContact.deleteMany({ where: { id: { in: removableIds }, clientId } });
  }

  if (data.locationAddress && (data.locationAddress.streetAddress || data.locationAddress.city)) {
    const addr = data.locationAddress;
    const fullAddress = [addr.unit, addr.streetAddress, addr.city, addr.region, addr.postalCode]
      .filter(Boolean)
      .join(', ');
    const primaryLocation = await tx.clientLocation.findFirst({
      where: { clientId, isPrimary: true },
      select: { id: true },
    });
    const locationData = {
      name: addr.city || 'Primary',
      address: (fullAddress || addr.streetAddress) ?? null,
      city: addr.city ?? null,
      region: addr.region ?? null,
      postalCode: addr.postalCode ?? null,
      country: addr.country ?? null,
      isPrimary: true,
    };
    if (primaryLocation) {
      await tx.clientLocation.update({ where: { id: primaryLocation.id }, data: locationData });
    } else {
      await tx.clientLocation.create({ data: { clientId, ...locationData } });
    }
  }

  await tx.clientTag.deleteMany({
    where: { clientId, subCompanyId },
  });
  if (uniqueTags.length > 0) {
    await tx.clientTag.createMany({
      data: uniqueTags.map((tag) => ({ clientId, subCompanyId, tag })),
      skipDuplicates: true,
    });
  }

  if (data.industry?.trim()) {
    const industryName = data.industry.trim();
    await tx.allowedIndustry.upsert({
      where: { subCompanyId_name: { subCompanyId, name: industryName } },
      update: {},
      create: { subCompanyId, name: industryName },
    });
  }

  await tx.clientSubCompany.updateMany({
    where: { clientId, subCompanyId },
    data: { lastActivity: new Date() },
  });

  return tx.client.findUnique({
    where: { id: client.id },
    include: {
      contacts: true,
      locations: true,
      tags: { where: { subCompanyId } },
    },
  });
}

export function buildPendingEditPayload(
  data: UpdateClientBody,
  meta: {
    subCompanyId: string;
    clientId: string;
    submittedById: string;
    submitterRole: string | null;
  },
): Prisma.PendingClientEditUncheckedCreateInput {
  const normalizedContacts = normalizeContacts(data.contacts);
  const uniqueTags = [...new Set((data.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  return {
    subCompanyId: meta.subCompanyId,
    clientId: meta.clientId,
    submittedById: meta.submittedById,
    name: data.name.trim(),
    industry: data.industry?.trim() ?? null,
    location: data.location?.trim() ?? null,
    address: data.address?.trim() ?? null,
    companySize: data.companySize?.trim() ?? null,
    tags: uniqueTags,
    contacts: normalizedContacts as unknown as Prisma.InputJsonValue,
    locationAddress: data.locationAddress
      ? (data.locationAddress as unknown as Prisma.InputJsonValue)
      : undefined,
    submitterRole: meta.submitterRole,
    submittedAt: new Date(),
    managerApprovedAt: null,
    managerApprovedById: null,
  };
}

export type ContactChangeContact = UpdateClientBody['contacts'][number];

export type QueueOrApplyClientContactChangeResult =
  | {
      kind: 'applied';
      client: NonNullable<Awaited<ReturnType<typeof performManualClientUpdate>>>;
    }
  | {
      kind: 'queued';
      pendingEditId: string;
      clientId: string;
      name: string;
      message: string;
    }
  | {
      kind: 'auto_approved';
      pendingEditId: string;
      clientId: string;
      name: string;
      message: string;
    }
  | {
      kind: 'misconfigured';
      error: string;
    };

/** Load live client fields + merge proposed contacts, then apply or queue via client_manual_edit. */
export async function queueOrApplyClientContactChange(params: {
  clientId: string;
  subCompanyId: string;
  proposedContacts: ContactChangeContact[];
  actorUserId: string;
  /** JWT subject — included in socket refresh when acting-as */
  jwtUserId?: string;
  actorRole: string | undefined;
  actorEmail: string | null | undefined;
  submitterPermissions: string[];
  bypassApproval: boolean;
  activityDescription: string;
  activityType?: string;
}): Promise<QueueOrApplyClientContactChangeResult> {
  const {
    clientId,
    subCompanyId,
    proposedContacts,
    actorUserId,
    jwtUserId,
    actorRole,
    actorEmail,
    submitterPermissions,
    bypassApproval,
    activityDescription,
    activityType = 'client_pending_edit',
  } = params;

  const refreshUserIds = [...new Set([actorUserId, ...(jwtUserId ? [jwtUserId] : [])])];

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      locations: { where: { isPrimary: true }, take: 1 },
      tags: { where: { subCompanyId }, select: { tag: true } },
    },
  });
  if (!client) {
    throw new Error('Client not found');
  }

  const primaryLoc = client.locations[0];
  const data: UpdateClientBody = {
    name: client.name,
    industry: client.industry ?? undefined,
    location: client.location ?? undefined,
    address: client.address ?? undefined,
    companySize: client.companySize ?? undefined,
    tags: client.tags.map((t) => t.tag),
    contacts: proposedContacts,
    locationAddress: primaryLoc
      ? {
          streetAddress: primaryLoc.address ?? undefined,
          city: primaryLoc.city ?? undefined,
          region: primaryLoc.region ?? undefined,
          postalCode: primaryLoc.postalCode ?? undefined,
          country: primaryLoc.country ?? undefined,
        }
      : undefined,
  };

  const parsed = updateClientSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid contact change payload: ${parsed.error.message}`);
  }
  const body = parsed.data;

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true, email: true },
  });
  const userName =
    [actor?.firstName, actor?.lastName].filter(Boolean).join(' ').trim() ||
    actor?.email ||
    actorEmail ||
    'User';

  if (bypassApproval) {
    const updated = await prisma.$transaction(async (tx) =>
      performManualClientUpdate(tx, {
        clientId,
        subCompanyId,
        data: body,
      }),
    );
    if (!updated) throw new Error('Failed to update client contacts');

    const { invalidateClientListCache } = await import('./clientListCache');
    const { createActivityLog } = await import('./activityLog');
    const { emitToUsers } = await import('../socket');

    await invalidateClientListCache(subCompanyId);
    await createActivityLog({
      userId: actorUserId,
      userName,
      subCompanyId,
      type: activityType === 'contact_added' || activityType === 'contact_updated' ? activityType : 'client_updated',
      description: activityDescription,
      metadata: { clientId, clientName: updated.name },
    });
    emitToUsers(refreshUserIds, 'client:refresh', { subCompanyId });

    return { kind: 'applied', client: updated };
  }

  const pendingPayload = buildPendingEditPayload(body, {
    subCompanyId,
    clientId,
    submittedById: actorUserId,
    submitterRole: actorRole ?? null,
  });

  const pendingRow = await prisma.pendingClientEdit.upsert({
    where: {
      clientId_subCompanyId: { clientId, subCompanyId },
    },
    create: pendingPayload,
    update: {
      ...pendingPayload,
      submittedAt: new Date(),
      currentStepIndex: 0,
      approvalChain: [],
    },
  });

  const { submitEntityForApproval, notifyChainTargetUsers } = await import('./approvalActions');
  const { createActivityLog } = await import('./activityLog');
  const { emitToUsers } = await import('../socket');

  const editApproval = await submitEntityForApproval({
    workflow: 'client_manual_edit',
    entityId: pendingRow.id,
    subCompanyId,
    submitterUserId: actorUserId,
    submitterRoleKey: actorRole ?? 'sales_associate',
    submitterPermissions,
  });

  await createActivityLog({
    userId: actorUserId,
    userName,
    subCompanyId,
    type: activityType,
    description: editApproval.autoApproved
      ? `Contact change for client "${pendingRow.name}" approved via agency approval settings`
      : `Submitted contact change for client "${pendingRow.name}" for approval`,
    metadata: {
      pendingEditId: pendingRow.id,
      clientId,
      clientName: pendingRow.name,
      autoApproved: editApproval.autoApproved,
    },
  });

  if (editApproval.autoApproved) {
    emitToUsers(refreshUserIds, 'client:refresh', { subCompanyId });
    return {
      kind: 'auto_approved',
      pendingEditId: pendingRow.id,
      clientId,
      name: pendingRow.name,
      message: 'Edit was approved immediately per agency approval settings.',
    };
  }

  if (!editApproval.targetRoleKey) {
    return {
      kind: 'misconfigured',
      error:
        'No approval path configured for client manual edit. Check Settings → Approvals and Settings → Roles.',
    };
  }

  const editApproverIds = await notifyChainTargetUsers({
    subCompanyId,
    targetRoleKey: editApproval.targetRoleKey,
    eventKey: 'client_pending_edit_alert',
    context: { entityLabel: pendingRow.name, actorName: userName },
    link: '/clients?tab=pending',
    relatedId: pendingRow.id,
  });
  emitToUsers([...editApproverIds, ...refreshUserIds], 'client:refresh', { subCompanyId });

  return {
    kind: 'queued',
    pendingEditId: pendingRow.id,
    clientId,
    name: pendingRow.name,
    message:
      'Edit submitted for director approval. Changes will be applied after a director or super admin approves.',
  };
}

export function mapDbContactsToUpdateBody(
  contacts: Array<{
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    phoneExtension: string | null;
    linkedin: string | null;
    website: string | null;
    isPrimary: boolean;
  }>,
): ContactChangeContact[] {
  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title ?? undefined,
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    phoneExtension: c.phoneExtension ?? undefined,
    linkedin: c.linkedin ?? undefined,
    website: c.website ?? undefined,
    isPrimary: c.isPrimary,
  }));
}

