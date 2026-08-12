import prisma from '../config/database';

export async function getRestrictedUserIds(clientId: string): Promise<string[]> {
  const rows = await prisma.clientRestriction.findMany({
    where: { clientId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function isUserRestrictedFromClient(clientId: string, userId: string): Promise<boolean> {
  const row = await prisma.clientRestriction.findUnique({
    where: { clientId_userId: { clientId, userId } },
    select: { userId: true },
  });
  return Boolean(row);
}

/**
 * Add or remove a user from the client's restriction list.
 * Returns the updated list of restricted user IDs.
 */
export async function setUserClientRestriction(
  clientId: string,
  userId: string,
  restricted: boolean,
): Promise<string[]> {
  if (restricted) {
    await prisma.clientRestriction.upsert({
      where: { clientId_userId: { clientId, userId } },
      create: { clientId, userId },
      update: {},
    });
  } else {
    await prisma.clientRestriction.deleteMany({
      where: { clientId, userId },
    });
  }
  return getRestrictedUserIds(clientId);
}
