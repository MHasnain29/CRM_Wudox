import prisma from '../config/database';

import { findOpenLeadForClient, syncClientStatusFromLeadOutcomes } from './leadClientStatus';

import { invalidateClientListCache } from './clientListCache';

import { emitToUsers } from '../socket';

import { dispatchNotificationToUser } from './notificationDispatch';
import { getApprovalEventKey } from './notificationRegistry';

import { createActivityLog } from './activityLog';

import { getAgencyBranding, sendLeadRequestApprovedEmail } from './email';

import { env } from '../config/env';



/** Final-approve a pending lead request (creates lead for requester). */

export async function executeLeadRequestApproval(

  requestId: string,

  approverUserId: string,

  comments?: string,

): Promise<{ ok: true } | { ok: false; error: string }> {

  const lr = await prisma.leadRequest.findUnique({

    where: { id: requestId },

    include: { client: true },

  });

  if (!lr) return { ok: false, error: 'Not found' };

  if (lr.status !== 'pending') return { ok: false, error: 'Request is no longer pending' };



  const existingOpenLead = await findOpenLeadForClient({

    clientId: lr.clientId,

    subCompanyId: lr.subCompanyId,

  });

  if (existingOpenLead) {

    return { ok: false, error: 'An open lead already exists for this client in this agency' };

  }



  const firstStage = await prisma.pipelineStage.findFirst({

    where: { OR: [{ subCompanyId: null }, { subCompanyId: lr.subCompanyId }] },

    orderBy: { orderIndex: 'asc' },

  });

  const stageId = firstStage?.id ?? 'new_lead';



  const otherPending = await prisma.leadRequest.findMany({

    where: {

      clientId: lr.clientId,

      subCompanyId: lr.subCompanyId,

      status: 'pending',

      id: { not: lr.id },

    },

    select: { id: true },

  });



  const deadlineSetting = await prisma.leadDeadlineSetting.findUnique({

    where: { subCompanyId: lr.subCompanyId },

    select: { days: true },

  });

  const deadlineDays = Math.max(0, deadlineSetting?.days ?? 7);

  const leadDeadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);



  await prisma.$transaction(async (tx) => {

    await tx.lead.create({

      data: {

        clientId: lr.clientId,

        ownerId: lr.requestedById,

        subCompanyId: lr.subCompanyId,

        stage: stageId,

        status: 'open',

        temperature: 'warm',

        lastActivity: new Date(),

        notes: lr.note,

        leadDeadline,

        reassignmentLocked: false,

        lockedAssociateId: null,

      },

    });



    await syncClientStatusFromLeadOutcomes({

      tx,

      clientId: lr.clientId,

      subCompanyId: lr.subCompanyId,

      touchLastActivityAt: new Date(),

    });



    await tx.leadRequest.update({

      where: { id: lr.id },

      data: { status: 'approved', reviewedById: approverUserId, reviewedAt: new Date() },

    });



    if (otherPending.length > 0) {

      await tx.leadRequest.updateMany({

        where: { id: { in: otherPending.map((r) => r.id) } },

        data: { status: 'rejected', reviewedById: approverUserId, reviewedAt: new Date() },

      });

    }



    if (comments?.trim()) {

      await tx.leadRequestComment.create({

        data: {

          requestId: lr.id,

          userId: approverUserId,

          userName: 'Approver',

          text: comments.trim(),

        },

      });

    }

  });



  await invalidateClientListCache(lr.subCompanyId);

  emitToUsers([lr.requestedById], 'lead:refresh', { subCompanyId: lr.subCompanyId });

  return { ok: true };

}



/** Notifications, activity, and email after a lead request is final-approved. */

export async function completeLeadRequestApprovalOutcome(params: {

  requestId: string;

  actorUserId: string;

  remarks?: string;

}): Promise<void> {

  const lr = await prisma.leadRequest.findUnique({

    where: { id: params.requestId },

    include: {

      client: { select: { id: true, name: true } },

      requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },

      manager: { select: { id: true } },

    },

  });

  if (!lr || lr.status !== 'approved') return;



  const actor = await prisma.user.findUnique({

    where: { id: params.actorUserId },

    select: { firstName: true, lastName: true, email: true },

  });

  const actorDisplayName =

    `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim() || actor?.email || 'Approver';



  const otherRejected = await prisma.leadRequest.findMany({

    where: {

      clientId: lr.clientId,

      subCompanyId: lr.subCompanyId,

      status: 'rejected',

      reviewedById: params.actorUserId,

      reviewedAt: { gte: new Date(Date.now() - 60_000) },

      id: { not: lr.id },

    },

    select: { id: true, requestedById: true },

  });



  const newLead = await prisma.lead.findFirst({

    where: { clientId: lr.clientId, subCompanyId: lr.subCompanyId },

    orderBy: { lastActivity: 'desc' },

    select: { id: true },

  });



  if (otherRejected.length > 0) {

    await Promise.all(
      otherRejected.map((r) =>
        dispatchNotificationToUser({
          userId: r.requestedById,
          subCompanyId: lr.subCompanyId,
          eventKey: 'lead_request_superseded',
          context: { entityLabel: lr.client.name },
          link: '/leads',
          relatedId: r.id,
        }),
      ),
    );

  }



  await Promise.all([
    dispatchNotificationToUser({
      userId: lr.requestedById,
      subCompanyId: lr.subCompanyId,
      eventKey: getApprovalEventKey('lead_request', 'approved'),
      context: { entityLabel: lr.client.name },
      link: '/leads',
      relatedId: newLead?.id ?? lr.id,
    }),
    ...(params.actorUserId !== lr.managerId
      ? [
          dispatchNotificationToUser({
            userId: lr.managerId,
            subCompanyId: lr.subCompanyId,
            eventKey: 'lead_request_approved_on_behalf',
            context: { entityLabel: lr.client.name, actorName: actorDisplayName },
            link: '/leads',
            relatedId: newLead?.id ?? lr.id,
          }),
        ]
      : []),
  ]);



  await createActivityLog({

    userId: params.actorUserId,

    userName: actorDisplayName,

    subCompanyId: lr.subCompanyId,

    type: 'lead_request_approved',

    description: `Approved lead request for "${lr.client.name}" (requested by ${lr.requestedBy.firstName} ${lr.requestedBy.lastName})`,

    metadata: { clientId: lr.clientId, leadId: newLead?.id, leadRequestId: lr.id },

  });



  if (lr.requestedBy.email) {

    const agency = await getAgencyBranding(lr.subCompanyId);

    sendLeadRequestApprovedEmail({

      toEmail: lr.requestedBy.email,

      toName:

        `${lr.requestedBy.firstName ?? ''} ${lr.requestedBy.lastName ?? ''}`.trim() ||

        lr.requestedBy.email,

      clientName: lr.client.name,

      leadsUrl: `${env.FRONTEND_URL}/leads`,

      agency,

    }).catch((err) => console.error('Failed to send lead approved email', err));

  }

}

