/**
 * Ensures all system RBAC roles from code exist in the database.
 * Runs once on server start when any system role row is missing (e.g. after deploy without seed-rbac).
 */
import prisma from '../config/database';
import { SYSTEM_ROLE_KEYS } from '../config/systemRolePermissions';

export async function ensureSystemRbacRoles(): Promise<void> {
  const existing = await prisma.rbacRole.count({
    where: { key: { in: [...SYSTEM_ROLE_KEYS] }, isActive: true },
  });
  if (existing >= SYSTEM_ROLE_KEYS.length) return;

  const missing = SYSTEM_ROLE_KEYS.length - existing;
  console.log(`[rbac] ${missing} system role(s) missing — running RBAC seed…`);
  // Non-literal path so tsc does not pull prisma/ outside rootDir
  const seedRbacPath = '../../prisma/seed-rbac';
  const { seedRbac } = await import(seedRbacPath) as {
    seedRbac: (db: typeof prisma) => Promise<void>;
  };
  await seedRbac(prisma);
  console.log('[rbac] System roles synchronized');
}
