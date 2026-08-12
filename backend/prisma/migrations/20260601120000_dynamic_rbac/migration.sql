-- Dynamic RBAC: roles hierarchy, permission catalog, role grants

CREATE TYPE "DataScopeLevel" AS ENUM ('global', 'agency', 'team', 'own');
CREATE TYPE "PermissionActionType" AS ENUM ('read', 'write', 'delete', 'custom');

CREATE TABLE "rbac_roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_role_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "scope_level" "DataScopeLevel" NOT NULL DEFAULT 'own',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rbac_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rbac_roles_key_key" ON "rbac_roles"("key");
CREATE INDEX "rbac_roles_parent_role_id_idx" ON "rbac_roles"("parent_role_id");
CREATE INDEX "rbac_roles_sort_order_idx" ON "rbac_roles"("sort_order");

CREATE TABLE "rbac_permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT,
    "parent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "action_type" "PermissionActionType",
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rbac_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rbac_permissions_key_key" ON "rbac_permissions"("key");
CREATE INDEX "rbac_permissions_parent_id_idx" ON "rbac_permissions"("parent_id");
CREATE INDEX "rbac_permissions_module_idx" ON "rbac_permissions"("module");

CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_parent_role_id_fkey" FOREIGN KEY ("parent_role_id") REFERENCES "rbac_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rbac_permissions" ADD CONSTRAINT "rbac_permissions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "rbac_permissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "rbac_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "role_id" TEXT;
CREATE INDEX "users_role_id_idx" ON "users"("role_id");
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "rbac_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
