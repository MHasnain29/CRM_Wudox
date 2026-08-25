/**
 * Upserts only missing system RBAC roles (and that role's grants).
 * Never rewrites other roles' role_permissions — unlike full seed-rbac.
 */
import prisma from '../config/database';
import { PERMISSIONS_BY_ROLE_KEY, SYSTEM_ROLE_KEYS } from '../config/systemRolePermissions';

type RoleSeed = {
  key: string;
  name: string;
  description?: string;
  parentKey: string | null;
  sortOrder: number;
  scopeLevel: 'own' | 'team' | 'agency' | 'global';
};

export async function ensureMissingSystemRoles(): Promise<void> {
  const existing = await prisma.rbacRole.findMany({
    where: { key: { in: [...SYSTEM_ROLE_KEYS] } },
    select: { key: true, isActive: true },
  });
  const present = new Set(existing.filter((r) => r.isActive).map((r) => r.key));
  const missing = SYSTEM_ROLE_KEYS.filter((k) => !present.has(k));
  if (missing.length === 0) return;

  const seedPath = '../../prisma/rbacDemoData';
  const { ROLE_HIERARCHY } = await import(seedPath) as { ROLE_HIERARCHY: RoleSeed[] };
  const seedByKey = new Map(ROLE_HIERARCHY.map((r) => [r.key, r]));

  console.log(`[rbac] ${missing.length} system role(s) missing — upserting without full seed: ${missing.join(', ')}`);

  for (const key of missing) {
    const seed = seedByKey.get(key);
    if (!seed) {
      console.warn(`[rbac] No ROLE_HIERARCHY entry for ${key} — skipped`);
      continue;
    }

    const row = await prisma.rbacRole.upsert({
      where: { key },
      create: {
        key: seed.key,
        name: seed.name,
        description: seed.description ?? null,
        sortOrder: seed.sortOrder,
        scopeLevel: seed.scopeLevel,
        isSystem: true,
        isActive: true,
      },
      update: {
        name: seed.name,
        description: seed.description ?? null,
        sortOrder: seed.sortOrder,
        scopeLevel: seed.scopeLevel,
        isSystem: true,
        isActive: true,
      },
    });

    if (seed.parentKey) {
      const parent = await prisma.rbacRole.findUnique({
        where: { key: seed.parentKey },
        select: { id: true },
      });
      if (parent) {
        await prisma.rbacRole.update({
          where: { id: row.id },
          data: { parentRoleId: parent.id },
        });
      }
    }

    const permKeys = PERMISSIONS_BY_ROLE_KEY[key] ?? [];
    const perms = permKeys.length
      ? await prisma.rbacPermission.findMany({
          where: { key: { in: permKeys } },
          select: { id: true },
        })
      : [];

    await prisma.rolePermission.deleteMany({ where: { roleId: row.id } });
    if (perms.length > 0) {
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: row.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
    await prisma.rbacRole.update({
      where: { id: row.id },
      data: { version: { increment: 1 } },
    });
  }

  console.log('[rbac] Missing system roles synchronized (other role grants unchanged)');
}
