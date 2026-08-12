import { useState, useEffect, useMemo } from 'react';
import { fetchSuperUsers, fetchSubCompanies, updateManagedAgencies, createSuperUser, updateSuperUser, deleteSuperUser, fetchDatabaseManagers, createDatabaseManager } from '@/lib/api';
import type { ManagedAgencyEntry, DatabaseManagerRow } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Shield, Building2, UserPlus, Database, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { SuperUserRow } from '@/lib/api';
import { useCanManageAgencies, useHasPermission } from '@/lib/access';
import { useAuthStore } from '@/lib/authStore';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  director: 'Director',
  company_director: 'Company Director',
  operations_manager: 'Operations Manager',
};

const ROLE_STYLES: Record<string, string> = {
  super_admin: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  director: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  company_director: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  operations_manager: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
};

interface AgencyRow {
  subCompanyId: string;
  name: string;
  checked: boolean;
  agencyEmail: string;
  emailError: string;
  editing: boolean;
}

function buildAgencyRows(
  subCompanies: { id: string; name: string }[],
  existing: ManagedAgencyEntry[],
): AgencyRow[] {
  const map = new Map(existing.map((e) => [e.subCompanyId, e.agencyEmail ?? '']));
  return subCompanies.map((s) => {
    const existingEmail = map.get(s.id) ?? '';
    return {
      subCompanyId: s.id,
      name: s.name,
      checked: map.has(s.id),
      agencyEmail: existingEmail,
      emailError: '',
      editing: !existingEmail,
    };
  });
}

function validateAgencyRows(rows: AgencyRow[]): AgencyRow[] {
  return rows.map((r) => {
    if (!r.checked) return { ...r, emailError: '' };
    if (!r.agencyEmail.trim()) return { ...r, emailError: 'Email required' };
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.agencyEmail.trim());
    return { ...r, emailError: valid ? '' : 'Invalid email' };
  });
}

export default function SuperUsers() {
  const canManageAgencies = useCanManageAgencies();
  const canUsersWrite = useHasPermission('users:write');
  const canAgenciesCrossOrg = useHasPermission('agencies:cross_org');
  const canAccess = canManageAgencies || (canUsersWrite && canAgenciesCrossOrg);

  const [superUsers, setSuperUsers] = useState<SuperUserRow[]>([]);
  const [databaseManagers, setDatabaseManagers] = useState<DatabaseManagerRow[]>([]);
  const [subCompanies, setSubCompanies] = useState<{ id: string; name: string; mainOrgId: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  // --- Assign dialog ---
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningUser, setAssigningUser] = useState<SuperUserRow | null>(null);
  const [assignRows, setAssignRows] = useState<AgencyRow[]>([]);

  // --- Edit dialog ---
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SuperUserRow | null>(null);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '' });
  const [editSaving, setEditSaving] = useState(false);

  // --- Delete dialog ---
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<SuperUserRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Add dialog ---
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDbDialogOpen, setAddDbDialogOpen] = useState(false);
  const [addDbForm, setAddDbForm] = useState({ firstName: '', lastName: '', email: '' });
  const [addingDb, setAddingDb] = useState(false);

  const isSuperAdmin = useAuthStore((s) => s.user?.role === 'super_admin');
  const [addForm, setAddForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'operations_manager' as 'director' | 'company_director' | 'operations_manager',
  });
  const [addRows, setAddRows] = useState<AgencyRow[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersList, dbList, subList] = await Promise.all([
        fetchSuperUsers(),
        fetchDatabaseManagers(),
        fetchSubCompanies(),
      ]);
      setSuperUsers(usersList);
      setDatabaseManagers(dbList);
      setSubCompanies(subList);
    } catch {
      toast.error('Failed to load super users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const agencyIdsWithCompanyDirector = useMemo(
    () =>
      new Set(
        superUsers
          .filter((u) => u.role === 'company_director' && u.isActive)
          .map((u) => u.subCompanyId),
      ),
    [superUsers],
  );

  const companyDirectorAgencyRows = useMemo(
    () => addRows.filter((row) => !agencyIdsWithCompanyDirector.has(row.subCompanyId)),
    [addRows, agencyIdsWithCompanyDirector],
  );

  // Re-init addRows whenever subCompanies loads or add dialog opens
  useEffect(() => {
    if (addDialogOpen) {
      setAddRows(buildAgencyRows(subCompanies, []));
    }
  }, [addDialogOpen, subCompanies]);

  const openAssignDialog = (user: SuperUserRow) => {
    if (user.role !== 'operations_manager') return;
    setAssigningUser(user);
    setAssignRows(buildAgencyRows(subCompanies, user.managedAgencies ?? []));
    setAssignDialogOpen(true);
  };

  const updateRow = (
    setter: React.Dispatch<React.SetStateAction<AgencyRow[]>>,
    subCompanyId: string,
    patch: Partial<AgencyRow>,
  ) => {
    setter((prev) =>
      prev.map((r) =>
        r.subCompanyId === subCompanyId
          ? { ...r, ...patch, emailError: '' }
          : r,
      ),
    );
  };

  const handleSaveManagedAgencies = async () => {
    if (!assigningUser) return;
    const validated = validateAgencyRows(assignRows);
    if (validated.some((r) => r.emailError)) {
      setAssignRows(validated);
      return;
    }
    const managedAgencies: ManagedAgencyEntry[] = validated
      .filter((r) => r.checked)
      .map((r) => ({ subCompanyId: r.subCompanyId, agencyEmail: r.agencyEmail.trim() || null }));
    if (managedAgencies.length === 0) {
      toast.error('Select at least one agency');
      return;
    }
    setSaving(true);
    try {
      await updateManagedAgencies(assigningUser.id, managedAgencies);
      toast.success('Managed agencies updated');
      setAssignDialogOpen(false);
      setAssigningUser(null);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (user: SuperUserRow) => {
    setEditingUser(user);
    setEditForm({ firstName: user.firstName, lastName: user.lastName, email: user.email });
    setEditDialogOpen(true);
  };

  const handleEditSuperUser = async () => {
    if (!editingUser) return;
    setEditSaving(true);
    try {
      await updateSuperUser(editingUser.id, editForm);
      toast.success('Super user updated');
      setEditDialogOpen(false);
      setEditingUser(null);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteSuperUser = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    try {
      await deleteSuperUser(deletingUser.id);
      toast.success(`${deletingUser.firstName} ${deletingUser.lastName} deleted`);
      setDeleteDialogOpen(false);
      setDeletingUser(null);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddSuperUser = async () => {
    const { firstName, lastName, email, role } = addForm;
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error('First name, last name, and email are required');
      return;
    }
    if (role === 'operations_manager') {
      const validated = validateAgencyRows(addRows);
      const checkedRows = validated.filter((r) => r.checked);
      if (checkedRows.length === 0) {
        toast.error('Select at least one agency for the Operations Manager');
        return;
      }
      if (validated.some((r) => r.emailError)) {
        setAddRows(validated);
        return;
      }
      const managedAgencies: ManagedAgencyEntry[] = checkedRows.map((r) => ({
        subCompanyId: r.subCompanyId,
        agencyEmail: r.agencyEmail.trim() || null,
      }));
      setAdding(true);
      try {
        await createSuperUser({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), role, managedAgencies });
        toast.success('Super user created. They will receive an email with login link and temporary password.');
        setAddDialogOpen(false);
        setAddForm({ firstName: '', lastName: '', email: '', role: 'operations_manager' });
        loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create super user');
      } finally {
        setAdding(false);
      }
    } else if (role === 'company_director') {
      const selected = companyDirectorAgencyRows.find((r) => r.checked);
      if (!selected) {
        toast.error(
          companyDirectorAgencyRows.length === 0
            ? 'Every agency already has a Company Director'
            : 'Select exactly one agency for the Company Director',
        );
        return;
      }
      setAdding(true);
      try {
        await createSuperUser({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role,
          subCompanyId: selected.subCompanyId,
        });
        toast.success(
          'Company Director created. Approval routes updated; any Sales Managers for this agency now report to them.',
        );
        setAddDialogOpen(false);
        setAddForm({ firstName: '', lastName: '', email: '', role: 'operations_manager' });
        loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create super user');
      } finally {
        setAdding(false);
      }
    } else {
      setAdding(true);
      try {
        await createSuperUser({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), role });
        toast.success('Super user created. They will receive an email with login link and temporary password.');
        setAddDialogOpen(false);
        setAddForm({ firstName: '', lastName: '', email: '', role: 'operations_manager' });
        loadData();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create super user');
      } finally {
        setAdding(false);
      }
    }
  };

  if (!canAccess) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You do not have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-7 w-7" />
            Super Users
          </h1>
          <p className="text-muted-foreground">
            Director, Company Director (per agency under Director), and Operations Managers — assign agencies on create; Company Directors are bound to one agency.
          </p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Add Super User
          </Button>
        )}
      </div>

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading...</div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Assigned agencies</TableHead>
                {isSuperAdmin && <TableHead className="w-[200px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {superUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No super users found
                  </TableCell>
                </TableRow>
              ) : (
                superUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.firstName} {user.lastName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_STYLES[user.role] ?? 'bg-muted text-muted-foreground ring-1 ring-border'}`}>
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.role === 'operations_manager' ? (
                        (user.managedAgencies ?? []).length ? (
                          <span className="text-sm text-muted-foreground">
                            {(user.managedAgencies ?? [])
                              .map((a) => {
                                const name = subCompanies.find((s) => s.id === a.subCompanyId)?.name ?? a.subCompanyId;
                                return a.agencyEmail ? `${name} (${a.agencyEmail})` : name;
                              })
                              .join(', ')}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">None assigned</span>
                        )
                      ) : user.role === 'company_director' ? (
                        <span className="text-sm text-muted-foreground">
                          {subCompanies.find((s) => s.id === user.subCompanyId)?.name ?? user.subCompanyId}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Access to all agencies</span>
                      )}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {user.role === 'operations_manager' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openAssignDialog(user)}
                              className="gap-1"
                            >
                              <Building2 className="h-3.5 w-3.5" />
                              Assign agencies
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(user)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setDeletingUser(user); setDeleteDialogOpen(true); }}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-4 pt-4 border-t">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Database className="h-6 w-6" />
              Database Managers
            </h2>
            <p className="text-muted-foreground text-sm">
              Org-global role — not tied to any agency. Adds clients to the global database pending Director / Operations Manager approval.
            </p>
          </div>
          {isSuperAdmin && (
            <Button onClick={() => setAddDbDialogOpen(true)} className="gap-2" variant="outline">
              <UserPlus className="h-4 w-4" />
              Add Database Manager
            </Button>
          )}
        </div>
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {databaseManagers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    No database managers yet
                  </TableCell>
                </TableRow>
              ) : (
                databaseManagers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.firstName} {user.lastName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? 'secondary' : 'outline'}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={addDbDialogOpen} onOpenChange={setAddDbDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add Database Manager</DialogTitle>
            <DialogDescription>
              Creates an agency-independent user who submits global database clients for approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="db-first">First name</Label>
                <Input
                  id="db-first"
                  value={addDbForm.firstName}
                  onChange={(e) => setAddDbForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="db-last">Last name</Label>
                <Input
                  id="db-last"
                  value={addDbForm.lastName}
                  onChange={(e) => setAddDbForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-email">Email</Label>
              <Input
                id="db-email"
                type="email"
                value={addDbForm.email}
                onChange={(e) => setAddDbForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDbDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={addingDb || !addDbForm.email.trim() || !addDbForm.firstName.trim() || !addDbForm.lastName.trim()}
              onClick={async () => {
                setAddingDb(true);
                try {
                  await createDatabaseManager({
                    email: addDbForm.email.trim(),
                    firstName: addDbForm.firstName.trim(),
                    lastName: addDbForm.lastName.trim(),
                  });
                  toast.success('Database Manager created. Welcome email sent with temporary password.');
                  setAddDbDialogOpen(false);
                  setAddDbForm({ firstName: '', lastName: '', email: '' });
                  loadData();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Failed to create Database Manager');
                } finally {
                  setAddingDb(false);
                }
              }}
            >
              {addingDb ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Super User dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Add Super User</DialogTitle>
            <DialogDescription>
              Create a Director, Company Director (per agency), or Operations Manager. They will receive an email with a login link and temporary password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-firstName">First name *</Label>
                <Input
                  id="add-firstName"
                  value={addForm.firstName}
                  onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
                  placeholder="Jane"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-lastName">Last name *</Label>
                <Input
                  id="add-lastName"
                  value={addForm.lastName}
                  onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">Email *</Label>
              <Input
                id="add-email"
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Role *</Label>
              <Select
                value={addForm.role}
                onValueChange={(v: 'director' | 'company_director' | 'operations_manager') =>
                  setAddForm((f) => ({ ...f, role: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="director">Director</SelectItem>
                  <SelectItem value="company_director">Company Director</SelectItem>
                  <SelectItem value="operations_manager">Operations Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addForm.role === 'company_director' && (
              <div className="space-y-2">
                <Label>Agency *</Label>
                <p className="text-xs text-muted-foreground">
                  One Company Director per agency. They report to the org Director and receive full director powers for that agency only.
                </p>
                {companyDirectorAgencyRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-md p-3">
                    All agencies already have a Company Director. Create a new agency in Settings first, or deactivate the existing Company Director.
                  </p>
                ) : (
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {companyDirectorAgencyRows.map((row) => (
                      <label
                        key={row.subCompanyId}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
                      >
                        <input
                          type="radio"
                          name="company-director-agency"
                          checked={row.checked}
                          onChange={() =>
                            setAddRows((prev) =>
                              prev.map((r) => ({
                                ...r,
                                checked: r.subCompanyId === row.subCompanyId,
                              })),
                            )
                          }
                        />
                        <span className="text-sm">{row.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {addForm.role === 'operations_manager' && (
              <div className="space-y-2">
                <Label>Assigned agencies *</Label>
                <p className="text-xs text-muted-foreground">
                  Check an agency and enter the email address this Operations Manager will send from for that agency.
                </p>
                <AgencyEmailTable rows={addRows} onChange={setAddRows} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddSuperUser} disabled={adding}>
              {adding ? 'Creating...' : 'Create & send email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign agencies dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Assign agencies to Operations Manager</DialogTitle>
            <DialogDescription>
              {assigningUser && `${assigningUser.firstName} ${assigningUser.lastName}`} — select agencies and set a sending email for each.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <AgencyEmailTable rows={assignRows} onChange={setAssignRows} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveManagedAgencies} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit super user dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Super User</DialogTitle>
            <DialogDescription>Update name and email for this user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-firstName">First name</Label>
                <Input
                  id="edit-firstName"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-lastName">Last name</Label>
                <Input
                  id="edit-lastName"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editSaving}>Cancel</Button>
            <Button
              onClick={handleEditSuperUser}
              disabled={editSaving || !editForm.firstName.trim() || !editForm.lastName.trim() || !editForm.email.trim()}
            >
              {editSaving ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Super User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground">
                {deletingUser?.firstName} {deletingUser?.lastName}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSuperUser} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Yes, delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgencyEmailTable({
  rows,
  onChange,
}: {
  rows: AgencyRow[];
  onChange: React.Dispatch<React.SetStateAction<AgencyRow[]>>;
}) {
  const toggle = (subCompanyId: string) => {
    onChange((prev) =>
      prev.map((r) =>
        r.subCompanyId === subCompanyId
          ? { ...r, checked: !r.checked, emailError: '' }
          : r,
      ),
    );
  };

  const setEmail = (subCompanyId: string, email: string) => {
    onChange((prev) =>
      prev.map((r) =>
        r.subCompanyId === subCompanyId ? { ...r, agencyEmail: email, emailError: '' } : r,
      ),
    );
  };

  const startEditing = (subCompanyId: string) => {
    onChange((prev) =>
      prev.map((r) => (r.subCompanyId === subCompanyId ? { ...r, editing: true } : r)),
    );
  };

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No agencies found. Create agencies in Settings first.</p>;
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="w-8 px-3 py-2"></th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Agency</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Sending email</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.subCompanyId} className="border-b last:border-0">
              <td className="px-3 py-2">
                <Checkbox
                  checked={row.checked}
                  onCheckedChange={() => toggle(row.subCompanyId)}
                />
              </td>
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2">
                {row.checked && !row.editing && row.agencyEmail ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground truncate">{row.agencyEmail}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => startEditing(row.subCompanyId)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Input
                      type="email"
                      placeholder={row.checked ? 'agency@example.com' : '—'}
                      value={row.agencyEmail}
                      disabled={!row.checked}
                      onChange={(e) => setEmail(row.subCompanyId, e.target.value)}
                      className={row.emailError ? 'border-destructive' : ''}
                    />
                    {row.emailError && (
                      <p className="text-xs text-destructive">{row.emailError}</p>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
