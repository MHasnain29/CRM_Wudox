/**
 * Idempotent RBAC demo seed: all system roles (hierarchy) + permission catalog + grants.
 * Run: npm run prisma:seed-rbac
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG, PERMISSIONS_BY_ROLE_KEY, ROLE_HIERARCHY } from './rbacDemoData';
import { seedRoleApprovalCapabilities } from '../src/services/approvalPolicy';

const prisma = new PrismaClient();

async function seedPermissions(client: PrismaClient): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  const groups = PERMISSION_CATALOG.filter((p) => p.isGroup);
  const leaves = PERMISSION_CATALOG.filter((p) => !p.isGroup);

  for (const p of groups) {
    const row = await client.rbacPermission.upsert({
      where: { key: p.key },
      create: {
        key: p.key,
        name: p.name,
        module: p.module,
        sortOrder: p.sortOrder,
        isGroup: true,
        isSystem: true,
      },
      update: { name: p.name, module: p.module, sortOrder: p.sortOrder, isGroup: true },
    });
    idByKey.set(p.key, row.id);
  }

  for (const p of leaves) {
    const parentId = p.parentKey ? idByKey.get(p.parentKey) ?? null : null;
    const row = await client.rbacPermission.upsert({
      where: { key: p.key },
      create: {
        key: p.key,
        name: p.name,
        module: p.module,
        parentId,
        sortOrder: p.sortOrder,
        isGroup: false,
        isSystem: true,
        actionType: p.actionType ?? null,
      },
      update: {
        name: p.name,
        module: p.module,
        parentId,
        sortOrder: p.sortOrder,
        actionType: p.actionType ?? null,
        isGroup: false,
      },
    });
    idByKey.set(p.key, row.id);
  }

  return idByKey;
}

async function seedRoles(client: PrismaClient): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();

  for (const r of ROLE_HIERARCHY) {
    const row = await client.rbacRole.upsert({
      where: { key: r.key },
      create: {
        key: r.key,
        name: r.name,
        description: r.description ?? null,
        sortOrder: r.sortOrder,
        scopeLevel: r.scopeLevel,
        isSystem: true,
        isActive: true,
      },
      update: {
        name: r.name,
        description: r.description ?? null,
        sortOrder: r.sortOrder,
        scopeLevel: r.scopeLevel,
        isSystem: true,
      },
    });
    idByKey.set(r.key, row.id);
  }

  for (const r of ROLE_HIERARCHY) {
    if (!r.parentKey) continue;
    const id = idByKey.get(r.key);
    const parentId = idByKey.get(r.parentKey);
    if (!id || !parentId) continue;
    await client.rbacRole.update({ where: { id }, data: { parentRoleId: parentId } });
  }

  return idByKey;
}

async function seedRolePermissions(
  client: PrismaClient,
  roleIds: Map<string, string>,
  permIds: Map<string, string>,
): Promise<void> {
  for (const [roleKey, permKeys] of Object.entries(PERMISSIONS_BY_ROLE_KEY)) {
    const roleId = roleIds.get(roleKey);
    if (!roleId) {
      console.warn(`  ⚠ Role not found: ${roleKey}`);
      continue;
    }

    await client.rolePermission.deleteMany({ where: { roleId } });

    const permissionIds = permKeys
      .map((k) => permIds.get(k))
      .filter((id): id is string => !!id);

    if (permissionIds.length > 0) {
      await client.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true,
      });
    }

    await client.rbacRole.update({
      where: { id: roleId },
      data: { version: { increment: 1 } },
    });
  }
}

async function linkUsersToRbacRoles(client: PrismaClient, roleIds: Map<string, string>): Promise<number> {
  const users = await client.user.findMany({ select: { id: true, role: true, roleId: true } });
  let linked = 0;
  for (const u of users) {
    const rbacId = roleIds.get(u.role);
    if (!rbacId || u.roleId === rbacId) continue;
    await client.user.update({ where: { id: u.id }, data: { roleId: rbacId } });
    linked++;
  }
  return linked;
}

/** Idempotent RBAC seed — safe to run after main `prisma:seed`. */
export async function seedRbac(client: PrismaClient = prisma): Promise<void> {
  const permIds = await seedPermissions(client);
  const roleIds = await seedRoles(client);
  await seedRolePermissions(client, roleIds, permIds);
  await linkUsersToRbacRoles(client, roleIds);
  await seedRoleApprovalCapabilities();
}

async function main() {
  console.log('🔐 Seeding RBAC demo data...');

  const permIds = await seedPermissions(prisma);
  console.log(`  ✓ ${permIds.size} permissions in catalog`);

  const roleIds = await seedRoles(prisma);
  console.log(`  ✓ ${roleIds.size} roles (hierarchy)`);

  await seedRolePermissions(prisma, roleIds, permIds);
  console.log('  ✓ Role permission grants');

  const linked = await linkUsersToRbacRoles(prisma, roleIds);
  console.log(`  ✓ Linked ${linked} users to rbac_roles`);

  const caps = await seedRoleApprovalCapabilities();
  console.log(`  ✓ ${caps} role approval capabilities`);

  console.log('✅ RBAC seed complete');
}

if (process.argv[1]?.includes('seed-rbac')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
