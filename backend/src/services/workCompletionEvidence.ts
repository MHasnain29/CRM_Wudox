import { Prisma, TaskStatus } from '@prisma/client';
import prisma from '../config/database';

export function completionTransition(fromStatus: string, toStatus: string, completeStatus: string) {
  if (fromStatus === toStatus) return null;
  if (toStatus === completeStatus) return 'completed' as const;
  if (fromStatus === completeStatus) return 'reopened' as const;
  return null;
}

/** Lock the entity before checking its status, so concurrent retries cannot create duplicate evidence. */
export async function updateTaskWithCompletionEvidence(input: {
  id: string;
  actorId: string;
  data: Prisma.TaskUpdateInput;
  requestedStatus?: TaskStatus;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tasks WHERE id = ${input.id} FOR UPDATE`);
    const current = await tx.task.findUniqueOrThrow({ where: { id: input.id } });
    const nextStatus = input.requestedStatus ?? current.status;
    const transition = completionTransition(current.status, nextStatus, 'done');
    const occurredAt = new Date();
    const task = await tx.task.update({
      where: { id: input.id },
      data: {
        ...input.data,
        ...(input.requestedStatus !== undefined ? { status: nextStatus } : {}),
        ...(transition ? { completedAt: transition === 'completed' ? occurredAt : null } : {}),
      },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (transition) {
      await tx.workCompletionEvent.create({
        data: {
          kind: 'task', entityId: task.id, userId: task.ownerId, actorId: input.actorId,
          subCompanyId: task.subCompanyId, type: transition, occurredAt,
          fromStatus: current.status, toStatus: nextStatus, dueAt: task.dueDate,
        },
      });
    }
    return { task, previousStatus: current.status, transition };
  });
}

export async function updateFollowUpWithCompletionEvidence(input: {
  id: string;
  actorId: string;
  data: Prisma.FollowUpUpdateInput;
  requestedCompleted?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM follow_ups WHERE id = ${input.id} FOR UPDATE`);
    const current = await tx.followUp.findUniqueOrThrow({ where: { id: input.id } });
    const nextCompleted = input.requestedCompleted ?? current.completed;
    const fromStatus = current.completed ? 'done' : 'pending';
    const toStatus = nextCompleted ? 'done' : 'pending';
    const transition = completionTransition(fromStatus, toStatus, 'done');
    const occurredAt = new Date();
    const followUp = await tx.followUp.update({
      where: { id: input.id },
      data: {
        ...input.data,
        ...(input.requestedCompleted !== undefined ? { completed: nextCompleted } : {}),
        ...(transition ? { completedAt: transition === 'completed' ? occurredAt : null } : {}),
      },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        comments: true,
      },
    });
    if (transition) {
      await tx.workCompletionEvent.create({
        data: {
          kind: 'follow_up', entityId: followUp.id, userId: followUp.ownerId, actorId: input.actorId,
          subCompanyId: followUp.subCompanyId, type: transition, occurredAt,
          fromStatus, toStatus, dueAt: followUp.dueDate,
        },
      });
    }
    return { followUp, transition };
  });
}
