import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, Save, Shield, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/authStore';
import { Can } from '@/components/Can';
import {
  type DataScopeLevel,
  type RbacPermissionTreeNode,
  type RbacRoleDetail,
  type RbacRoleTreeNode,
  collectLeavesUnder,
  collectLeafPermissionKeys,
  createRbacRole,
  deleteRbacRole,
  fetchPermissionsCatalog,
  resetSystemRolesToDefaults,
  fetchRoleDetail,
  fetchRolePermissionKeys,
  fetchRoleUsers,
  type RbacRoleUserRow,
  fetchRolesTree,
  flattenRoles,
  saveRolePermissions,
  updateRbacRole,
} from '@/lib/rbacApi';
import { useApprovalMetadata } from '@/hooks/useApprovalMetadata';
import { formatUserAgencyLabel } from '@/lib/agencyIndependentRoles';
import { RoleSideBadge, groupPermissionModulesBySide } from '@/workspaces';

const SCOPE_OPTIONS: { value: DataScopeLevel; label: string; hint: string }[] = [
  { value: 'global', label: 'Global', hint: 'All agencies' },
  { value: 'agency', label: 'Agency', hint: 'Full sub-company' },
  { value: 'team', label: 'Team', hint: 'Self + direct reports' },
  { value: 'own', label: 'Own', hint: 'Own records only' },
];

function slugifyRoleKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function findPermissionLabel(catalog: RbacPermissionTreeNode[], key: string): string {
  for (const node of catalog) {
    if (!node.isGroup && node.key === key) return node.name;
    for (const child of node.children) {
      if (!child.isGroup && child.key === key) return child.name;
      if (child.isGroup) {
        const nested = findPermissionLabel([child], key);
        if (nested !== key) return nested;
      }
    }
  }
  return key;
}

type DetailTab = 'access' | 'permissions';

function RoleTreeItem({
  node,
  depth,
  selectedId,
  onSelect,
  rolePermissions,
  liveGranted,
}: {
  node: RbacRoleTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  rolePermissions: Record<string, string[]>;
  /** Live granted set for the selected role (updates as checkboxes change). */
  liveGranted: Set<string> | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const permissionKeys = isSelected && liveGranted
    ? [...liveGranted]
    : (rolePermissions[node.id] ?? []);

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/80 ${
          isSelected ? 'bg-primary/10 text-primary font-medium' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="p-0.5 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Shield className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="truncate">{node.name}</span>
        <RoleSideBadge permissionKeys={permissionKeys} className="shrink-0" />
        {node.isSystem && (
          <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">
            System
          </Badge>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((c) => (
            <RoleTreeItem
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              rolePermissions={rolePermissions}
              liveGranted={liveGranted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionModule({
  node,
  granted,
  canEdit,
  onToggleLeaf,
  onToggleModule,
}: {
  node: RbacPermissionTreeNode;
  granted: Set<string>;
  canEdit: boolean;
  onToggleLeaf: (key: string, checked: boolean) => void;
  onToggleModule: (node: RbacPermissionTreeNode, checked: boolean) => void;
}) {
  const leaves = collectLeavesUnder(node);
  const checkedCount = leaves.filter((l) => granted.has(l.key)).length;
  const allChecked = leaves.length > 0 && checkedCount === leaves.length;
  const someChecked = checkedCount > 0 && !allChecked;

  if (!node.isGroup && node.children.length === 0) {
    return (
      <label className="flex items-center gap-2 py-1 pl-6 text-sm cursor-pointer">
        <Checkbox
          checked={granted.has(node.key)}
          disabled={!canEdit}
          onCheckedChange={(v) => onToggleLeaf(node.key, v === true)}
        />
        <span>{node.name}</span>
        <span className="text-xs text-muted-foreground font-mono">{node.key}</span>
      </label>
    );
  }

  return (
    <Collapsible defaultOpen className="border rounded-lg mb-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Checkbox
          checked={allChecked ? true : someChecked ? 'indeterminate' : false}
          disabled={!canEdit}
          onCheckedChange={(v) => onToggleModule(node, v === true)}
        />
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-sm font-medium [&[data-state=open]>svg]:rotate-180">
          <ChevronDown className="h-4 w-4 transition-transform" />
          {node.name}
          <span className="text-xs text-muted-foreground font-normal">
            {checkedCount}/{leaves.length}
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="px-3 pb-3 space-y-1">
        {node.children.map((child) =>
          child.isGroup ? (
            <div key={child.id} className="mt-2 pl-2 border-l">
              <PermissionModule
                node={child}
                granted={granted}
                canEdit={canEdit}
                onToggleLeaf={onToggleLeaf}
                onToggleModule={onToggleModule}
              />
            </div>
          ) : (
            <label key={child.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
              <Checkbox
                checked={granted.has(child.key)}
                disabled={!canEdit}
                onCheckedChange={(v) => onToggleLeaf(child.key, v === true)}
              />
              <span>{child.name}</span>
              <span className="text-xs text-muted-foreground font-mono">{child.key}</span>
            </label>
          ),
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RolesPermissionsTab() {
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('roles:write');
  const canCreate = permissions.includes('roles:create') || canWrite;
  const canDelete = permissions.includes('roles:delete') || canWrite;
  const { metadata: approvalMetadata } = useApprovalMetadata();

  const [rolesTree, setRolesTree] = useState<RbacRoleTreeNode[]>([]);
  const [permCatalog, setPermCatalog] = useState<RbacPermissionTreeNode[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [loadingTree, setLoadingTree] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RbacRoleDetail | null>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [dirtyPerms, setDirtyPerms] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingSection, setSavingSection] = useState<'meta' | 'perms' | 'all' | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('access');

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editParentId, setEditParentId] = useState<string | '__none__'>('__none__');
  const [editScope, setEditScope] = useState<DataScopeLevel>('own');
  const [dirtyMeta, setDirtyMeta] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newParentId, setNewParentId] = useState<string>('__none__');
  const [newScope, setNewScope] = useState<DataScopeLevel>('own');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetDefaultsOpen, setResetDefaultsOpen] = useState(false);
  const [resettingDefaults, setResettingDefaults] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [roleUsers, setRoleUsers] = useState<RbacRoleUserRow[]>([]);
  const [loadingRoleUsers, setLoadingRoleUsers] = useState(false);

  const flatRoles = useMemo(() => flattenRoles(rolesTree), [rolesTree]);
  const parentOptions = useMemo(
    () => flatRoles.filter((r) => r.id !== selectedId),
    [flatRoles, selectedId],
  );

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    try {
      const [roles, perms] = await Promise.all([fetchRolesTree(), fetchPermissionsCatalog()]);
      setRolesTree(roles);
      setPermCatalog(perms);
      const flat = flattenRoles(roles);
      const entries = await Promise.all(
        flat.map(async (r) => {
          try {
            const keys = await fetchRolePermissionKeys(r.id);
            return [r.id, keys] as const;
          } catch {
            return [r.id, [] as string[]] as const;
          }
        }),
      );
      setRolePermissions(Object.fromEntries(entries));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load roles');
    } finally {
      setLoadingTree(false);
    }
  }, []);

  const hasUnsavedChanges = dirtyMeta || dirtyPerms;

  const confirmDiscardChanges = useCallback(() => {
    if (!hasUnsavedChanges) return true;
    return window.confirm('You have unsaved changes. Discard them?');
  }, [hasUnsavedChanges]);

  const loadDetail = useCallback(async (roleId: string) => {
    setLoadingDetail(true);
    try {
      const [d, keys] = await Promise.all([fetchRoleDetail(roleId), fetchRolePermissionKeys(roleId)]);
      setDetail(d);
      setEditName(d.name);
      setEditDescription(d.description ?? '');
      setEditParentId(d.parentRoleId ?? '__none__');
      setEditScope(d.scopeLevel);
      setGranted(new Set(keys));
      setRolePermissions((prev) => ({ ...prev, [roleId]: keys }));
      setDirtyPerms(false);
      setDirtyMeta(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load role');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (selectedId || rolesTree.length === 0) return;
    const first = flattenRoles(rolesTree)[0];
    if (first) setSelectedId(first.id);
  }, [rolesTree, selectedId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else {
      setDetail(null);
      setGranted(new Set());
    }
  }, [selectedId, loadDetail]);

  const parentRoleName = useMemo(() => {
    if (!detail?.parentRoleId) return null;
    return flatRoles.find((r) => r.id === detail.parentRoleId)?.name ?? null;
  }, [detail?.parentRoleId, flatRoles]);

  const scopeLabel = SCOPE_OPTIONS.find((o) => o.value === editScope)?.label ?? editScope;

  const handleSelectRole = (id: string) => {
    if (id === selectedId) return;
    if (!confirmDiscardChanges()) return;
    setDetailTab('access');
    setSelectedId(id);
  };

  const handleDetailTabChange = (next: DetailTab) => {
    if (next === detailTab) return;
    if (!confirmDiscardChanges()) return;
    setDetailTab(next);
  };

  const saving = savingSection !== null;

  const toggleLeaf = (key: string, checked: boolean) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
    setDirtyPerms(true);
  };

  const toggleModule = (node: RbacPermissionTreeNode, checked: boolean) => {
    const leaves = collectLeavesUnder(node);
    setGranted((prev) => {
      const next = new Set(prev);
      for (const l of leaves) {
        if (checked) next.add(l.key);
        else next.delete(l.key);
      }
      return next;
    });
    setDirtyPerms(true);
  };

  const applyBulkAction = (action: 'read' | 'write' | 'delete') => {
    const allLeaves = collectLeafPermissionKeys(permCatalog);
    const matching = allLeaves.filter((k) => k.endsWith(`:${action}`));
    setGranted((prev) => {
      const next = new Set(prev);
      for (const k of matching) next.add(k);
      return next;
    });
    setDirtyPerms(true);
  };

  const copyFromParent = async () => {
    if (!detail?.parentRoleId) return;
    try {
      const keys = await fetchRolePermissionKeys(detail.parentRoleId);
      setGranted(new Set(keys));
      setDirtyPerms(true);
      toast.success('Copied permissions from parent role');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to copy');
    }
  };

  const handleSavePermissions = async () => {
    if (!selectedId || !canWrite) return;
    setSavingSection('perms');
    try {
      const saved = await saveRolePermissions(selectedId, [...granted]);
      setRolePermissions((prev) => ({ ...prev, [selectedId]: saved }));
      setDirtyPerms(false);
      await useAuthStore.getState().refreshPermissionsFromServer();
      toast.success('Permissions saved. Your session was refreshed; other users must log in again.');
      await loadDetail(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save permissions');
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveMeta = async () => {
    if (!selectedId || !detail || !canWrite) return;
    setSavingSection('meta');
    try {
      const updated = await updateRbacRole(selectedId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        parentRoleId: editParentId === '__none__' ? null : editParentId,
        scopeLevel: editScope,
      });
      setDetail(updated);
      setDirtyMeta(false);
      toast.success('Role updated');
      await loadTree();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveAll = async () => {
    if (!selectedId || !canWrite) return;
    setSavingSection('all');
    try {
      if (dirtyMeta && detail) {
        const updated = await updateRbacRole(selectedId, {
          name: editName.trim(),
          description: editDescription.trim() || null,
          parentRoleId: editParentId === '__none__' ? null : editParentId,
          scopeLevel: editScope,
        });
        setDetail(updated);
        setDirtyMeta(false);
      }
      if (dirtyPerms) {
        const saved = await saveRolePermissions(selectedId, [...granted]);
        setRolePermissions((prev) => ({ ...prev, [selectedId]: saved }));
        setDirtyPerms(false);
        await useAuthStore.getState().refreshPermissionsFromServer();
      }
      toast.success('All role changes saved');
      await loadTree();
      await loadDetail(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingSection(null);
    }
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    const key = (newKey.trim() || slugifyRoleKey(newName)).toLowerCase();
    if (!key) {
      toast.error('Enter a role name or key');
      return;
    }
    setSavingSection('meta');
    try {
      const created = await createRbacRole({
        key,
        name: newName.trim(),
        parentRoleId: newParentId === '__none__' ? null : newParentId,
        scopeLevel: newScope,
      });
      toast.success('Role created');
      setCreateOpen(false);
      setNewName('');
      setNewKey('');
      await loadTree();
      setSelectedId(created.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create role');
    } finally {
      setSavingSection(null);
    }
  };

  const openUsersDialog = async () => {
    if (!selectedId || !detail) return;
    setUsersOpen(true);
    setLoadingRoleUsers(true);
    try {
      const users = await fetchRoleUsers(selectedId);
      setRoleUsers(users);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load users');
      setRoleUsers([]);
    } finally {
      setLoadingRoleUsers(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !canDelete || !detail) return;
    setSavingSection('meta');
    try {
      await deleteRbacRole(selectedId);
      toast.success('Role deactivated');
      setDeleteOpen(false);
      setSelectedId(null);
      setDetail(null);
      await loadTree();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete role');
    } finally {
      setSavingSection(null);
    }
  };

  const handleResetSystemRolesToDefaults = async () => {
    if (!canWrite) return;
    setResettingDefaults(true);
    try {
      const result = await resetSystemRolesToDefaults();
      setResetDefaultsOpen(false);
      await useAuthStore.getState().refreshPermissionsFromServer();
      await loadTree();
      if (selectedId) {
        await loadDetail(selectedId);
      }
      const count = result.resetRoleKeys.length;
      if (count === 0) {
        toast.warning('No system roles were found in the database to reset');
      } else {
        toast.success(`Reset ${count} system role(s) to default permissions`, {
          description: 'Your session was refreshed. Other users must log out and log back in.',
        });
      }
      if (result.skippedRoleKeys.length > 0) {
        toast.warning(`Skipped missing roles: ${result.skippedRoleKeys.join(', ')}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reset roles');
    } finally {
      setResettingDefaults(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Roles &amp; Permissions
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage role hierarchy, data access, and which actions each role can perform. UI buttons
            are hidden when permission is missing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Can permission="roles:write">
            <Button variant="outline" onClick={() => setResetDefaultsOpen(true)} disabled={resettingDefaults}>
              {resettingDefaults ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reset system roles to defaults
            </Button>
          </Can>
          <Can permission={['roles:create', 'roles:write']}>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New role
            </Button>
          </Can>
        </div>
      </div>

      <AlertDialog open={resetDefaultsOpen} onOpenChange={setResetDefaultsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset system roles to defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores default permissions and approval capabilities for all 14 built-in roles
              (Super Admin, Director, Company Director, Sales Associate, etc.) from the application baseline. Custom
              roles are not changed. Anyone already logged in must sign out and back in to pick up
              the new permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingDefaults}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetSystemRolesToDefaults} disabled={resettingDefaults}>
              {resettingDefaults ? 'Resetting…' : 'Reset defaults'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 min-h-[520px]">
        <Card className="overflow-hidden">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Role hierarchy</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4 max-h-[600px] overflow-y-auto">
            {loadingTree ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rolesTree.length === 0 ? (
              <div className="px-2 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No roles in the database. From the <code className="text-xs">backend</code> folder run{' '}
                  <code className="text-xs">npm run prisma:seed-rbac</code>, then reload.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => loadTree()}>
                  Reload roles
                </Button>
              </div>
            ) : (
              rolesTree.map((r) => (
                <RoleTreeItem
                  key={r.id}
                  node={r}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={handleSelectRole}
                  rolePermissions={rolePermissions}
                  liveGranted={selectedId ? granted : null}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          {!selectedId ? (
            <CardContent className="py-16 text-center text-muted-foreground">
              Select a role from the tree
            </CardContent>
          ) : loadingDetail ? (
            <CardContent className="py-16 flex justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </CardContent>
          ) : !detail ? (
            <CardContent className="py-16 text-center text-muted-foreground">Role not found</CardContent>
          ) : (
            <>
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle>{detail.name}</CardTitle>
                      <RoleSideBadge permissionKeys={[...granted]} />
                    </div>
                    <CardDescription className="font-mono text-xs mt-1">{detail.key}</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openUsersDialog}
                      disabled={detail.userCount === 0}
                      className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold gap-1 transition-colors hover:bg-muted disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={detail.userCount === 0 ? 'No users on this role' : 'View users'}
                    >
                      <Users className="h-3 w-3" />
                      {detail.userCount} {detail.userCount === 1 ? 'user' : 'users'}
                    </button>
                    {detail.isSystem && <Badge variant="secondary">System</Badge>}
                    <Can permission={['roles:delete', 'roles:write']}>
                      {!detail.isSystem && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                onClick={() => setDeleteOpen(true)}
                                disabled={detail.userCount > 0}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete role
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {detail.userCount > 0 && (
                            <TooltipContent>
                              Reassign or remove all {detail.userCount} user
                              {detail.userCount === 1 ? '' : 's'} before deleting this role.
                            </TooltipContent>
                          )}
                        </Tooltip>
                      )}
                    </Can>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span>
                    <span className="text-muted-foreground">Scope:</span>{' '}
                    <Badge variant="outline">{scopeLabel}</Badge>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Parent:</span>{' '}
                    {parentRoleName ?? 'None (root)'}
                  </span>
                </div>

                <Tabs value={detailTab} onValueChange={(v) => handleDetailTabChange(v as DetailTab)}>
                  <TabsList>
                    <TabsTrigger value="access" className="gap-1.5">
                      Data access
                      {dirtyMeta && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                    </TabsTrigger>
                    <TabsTrigger value="permissions" className="gap-1.5">
                      Permissions
                      {dirtyPerms && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="access" className="space-y-4 mt-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Display name</Label>
                        <Input
                          value={editName}
                          disabled={!canWrite}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            setDirtyMeta(true);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Parent role</Label>
                        <Select
                          value={editParentId}
                          disabled={!canWrite || detail.isSystem}
                          onValueChange={(v) => {
                            setEditParentId(v);
                            setDirtyMeta(true);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="None (root)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">None (root)</SelectItem>
                            {parentOptions.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {'—'.repeat(r.depth)}
                                {r.depth > 0 ? ' ' : ''}
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Description</Label>
                        <Textarea
                          value={editDescription}
                          disabled={!canWrite}
                          rows={2}
                          onChange={(e) => {
                            setEditDescription(e.target.value);
                            setDirtyMeta(true);
                          }}
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Data scope</Label>
                        <Select
                          value={editScope}
                          disabled={!canWrite}
                          onValueChange={(v) => {
                            setEditScope(v as DataScopeLevel);
                            setDirtyMeta(true);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCOPE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label} — {o.hint}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Controls which records users with this role see (API row-level filters).
                        </p>
                      </div>
                    </div>
                    <Can permission="roles:write">
                      <Button onClick={handleSaveMeta} disabled={!dirtyMeta || saving}>
                        {savingSection === 'meta' || savingSection === 'all' ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Save role details
                      </Button>
                    </Can>
                  </TabsContent>

                  <TabsContent value="permissions" className="space-y-4 mt-4">
                    {approvalMetadata && (
                      <p className="text-sm text-muted-foreground rounded-md border px-3 py-2 bg-muted/20">
                        Approval routes are configured under Settings → Approvals. Roles in a route need
                        permission keys such as{' '}
                        {[
                          ...new Set(
                            approvalMetadata.workflows.flatMap((w) =>
                              [w.forwardPermission, w.finalPermission, w.finalPermissionFallback].filter(
                                Boolean,
                              ) as string[],
                            ),
                          ),
                        ]
                          .slice(0, 6)
                          .map((k) => findPermissionLabel(permCatalog, k))
                          .join(', ')}
                        {approvalMetadata.workflows.length > 0 ? '…' : ''} — grant them here.
                      </p>
                    )}
                    <Can permission="roles:write">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => applyBulkAction('read')}>
                          Grant all Read
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => applyBulkAction('write')}>
                          Grant all Write
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => applyBulkAction('delete')}>
                          Grant all Delete
                        </Button>
                        {detail.parentRoleId && (
                          <Button type="button" variant="secondary" size="sm" onClick={copyFromParent}>
                            Copy from parent
                          </Button>
                        )}
                      </div>
                    </Can>

                    <div className="max-h-[420px] overflow-y-auto pr-1 space-y-4">
                      {groupPermissionModulesBySide(permCatalog, (m) => m.module ?? m.key).map((group) => (
                        <div key={group.key}>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                            {group.label}
                          </p>
                          {group.items.map((mod) => (
                            <PermissionModule
                              key={mod.id}
                              node={mod}
                              granted={granted}
                              canEdit={canWrite}
                              onToggleLeaf={toggleLeaf}
                              onToggleModule={toggleModule}
                            />
                          ))}
                        </div>
                      ))}
                    </div>

                    <Can permission="roles:write">
                      <Button onClick={handleSavePermissions} disabled={!dirtyPerms || saving}>
                        {savingSection === 'perms' || savingSection === 'all' ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Save permissions
                      </Button>
                    </Can>
                  </TabsContent>
                </Tabs>

                <Can permission="roles:write">
                  {hasUnsavedChanges && (
                    <div className="flex justify-end pt-2 border-t">
                      <Button onClick={handleSaveAll} disabled={saving}>
                        {savingSection === 'all' ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Save all changes
                      </Button>
                    </div>
                  )}
                </Can>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>Add a custom role under the hierarchy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (!newKey.trim()) setNewKey(slugifyRoleKey(e.target.value));
                }}
                placeholder="Regional Sales Lead"
              />
            </div>
            <div className="space-y-2">
              <Label>Key</Label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="regional_sales_lead"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Parent role</Label>
              <Select value={newParentId} onValueChange={setNewParentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (root)</SelectItem>
                  {flatRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {'—'.repeat(r.depth)}
                      {r.depth > 0 ? ' ' : ''}
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data scope</Label>
              <Select value={newScope} onValueChange={(v) => setNewScope(v as DataScopeLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Users — {detail?.name}</DialogTitle>
            <DialogDescription>
              Accounts with this role ({detail?.key}). Inactive users are listed at the bottom.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-[120px]">
            {loadingRoleUsers ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : roleUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No users assigned.</p>
            ) : (
              <ul className="divide-y">
                {roleUsers.map((u) => (
                  <li key={u.id} className="py-3 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">
                        {u.firstName} {u.lastName}
                      </span>
                      {!u.isActive && (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatUserAgencyLabel(u.role, u.subCompanyName)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {permissions.includes('users:directory') && (
              <Button variant="outline" asChild>
                <Link to="/users" onClick={() => setUsersOpen(false)}>
                  Open Users page
                </Link>
              </Button>
            )}
            <Button onClick={() => setUsersOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom role?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate &quot;{detail?.name}&quot; ({detail?.key}). It will no longer appear in
              assignable roles. System roles cannot be deleted. Users must be reassigned first; child roles
              under this role must be removed or reparented.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground"
            >
              {saving ? 'Deleting…' : 'Delete role'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
