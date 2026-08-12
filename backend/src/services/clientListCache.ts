import prisma from '../config/database';
import { getRedis, isRedisEnabled } from '../config/redis';

/** Clear list cache for all agencies in the same main org (after a global client is created). */
export async function invalidateClientListCacheForMainOrg(subCompanyId: string): Promise<void> {
  const own = await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: { mainOrgId: true },
  });
  if (!own?.mainOrgId) {
    await invalidateClientListCache(subCompanyId);
    return;
  }
  const siblings = await prisma.subCompany.findMany({
    where: { mainOrgId: own.mainOrgId },
    select: { id: true },
  });
  await Promise.all(siblings.map((s) => invalidateClientListCache(s.id)));
}

export async function invalidateClientListCache(subCompanyId: string): Promise<void> {
  const redis = getRedis();
  if (!isRedisEnabled() || !redis) return;

  const pattern = `clients:${subCompanyId}:*`;
  let cursor = '0';

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    console.error('Failed to invalidate client list cache', { subCompanyId, error });
  }
}
