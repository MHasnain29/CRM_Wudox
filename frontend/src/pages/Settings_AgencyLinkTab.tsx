import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, AlertTriangle, Search, Users2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchAllLinkGroups,
  fetchUsersForLinking,
  linkAgencyUsers,
  type LinkedAccount,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoleLabel } from '@/lib/roleLabels';
import { AgencyLinkGroupCard } from '@/components/settings/AgencyLinkGroupCard';

interface UserPick {
  agencyId: string;
  userId: string;
  search: string;
}

const EMPTY_PICK: UserPick = { agencyId: '', userId: '', search: '' };

export function AgencyLinkTab() {
  const { subCompanies } = useStore();
  const qc = useQueryClient();

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [pickA, setPickA] = useState<UserPick>(EMPTY_PICK);
  const [pickB, setPickB] = useState<UserPick>(EMPTY_PICK);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['all-link-groups'],
    queryFn: fetchAllLinkGroups,
  });

  const { data: usersA = [], isLoading: loadingA } = useQuery({
    queryKey: ['users-for-linking', pickA.agencyId],
    queryFn: () => fetchUsersForLinking(pickA.agencyId),
    enabled: !!pickA.agencyId,
  });

  const { data: usersB = [], isLoading: loadingB } = useQuery({
    queryKey: ['users-for-linking', pickB.agencyId],
    queryFn: () => fetchUsersForLinking(pickB.agencyId),
    enabled: !!pickB.agencyId,
  });

  const linkMutation = useMutation({
    mutationFn: ({ userIdA, userIdB }: { userIdA: string; userIdB: string }) =>
      linkAgencyUsers(userIdA, userIdB),
    onSuccess: () => {
      toast.success('Accounts linked successfully.');
      qc.invalidateQueries({ queryKey: ['all-link-groups'] });
      qc.invalidateQueries({ queryKey: ['my-linked-accounts'] });
      closeLinkModal();
    },
    onError: (err: Error) => {
      toast.error(err?.message ?? 'Failed to link accounts');
    },
  });

  function closeLinkModal() {
    setLinkModalOpen(false);
    setPickA(EMPTY_PICK);
    setPickB(EMPTY_PICK);
  }

  function filteredUsers(users: LinkedAccount[], search: string) {
    const q = search.toLowerCase();
    return q
      ? users.filter(
          (u) =>
            u.firstName.toLowerCase().includes(q) ||
            u.lastName.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            getRoleLabel(u.role).toLowerCase().includes(q),
        )
      : users;
  }

  const userASelected = usersA.find((u) => u.userId === pickA.userId);
  const userBSelected = usersB.find((u) => u.userId === pickB.userId);
  const rolesMismatch = !!userASelected && !!userBSelected && userASelected.role !== userBSelected.role;
  const scopeMismatch =
    !!userASelected &&
    !!userBSelected &&
    !!userASelected.dataScopeLevel &&
    !!userBSelected.dataScopeLevel &&
    userASelected.dataScopeLevel !== userBSelected.dataScopeLevel;
  const designationInvalid = rolesMismatch || scopeMismatch;
  const canSubmit =
    !!pickA.userId && !!pickB.userId && !linkMutation.isPending && !designationInvalid;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users2 className="h-4 w-4" />
                Agency Link Groups
              </CardTitle>
              <CardDescription>
                Users in the same link group can switch between their agency accounts without
                re-entering a password. Only the same role and scope level can be linked. Use the
                ⋮ menu on a group to edit or delete it.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setLinkModalOpen(true)}>
              <Link2 className="h-4 w-4 mr-1.5" />
              Link Two Users
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked account groups yet.</p>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <AgencyLinkGroupCard key={group.groupId} group={group} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={linkModalOpen} onOpenChange={(open) => { if (!open) closeLinkModal(); }}>
        <DialogContent className="max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Link Two Users Across Agencies</DialogTitle>
            <DialogDescription>
              Select one user from each agency. Both must have the same role (designation) and
              data-scope level.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6 py-2">
            <UserPicker
              label="User A"
              agencies={subCompanies}
              pick={pickA}
              users={usersA}
              loading={loadingA}
              onAgencyChange={(id) => setPickA({ agencyId: id, userId: '', search: '' })}
              onSearchChange={(s) => setPickA((p) => ({ ...p, search: s, userId: '' }))}
              onSelect={(userId) => setPickA((p) => ({ ...p, userId }))}
              filteredUsers={filteredUsers(usersA, pickA.search)}
            />
            <UserPicker
              label="User B"
              agencies={subCompanies}
              pick={pickB}
              users={usersB}
              loading={loadingB}
              onAgencyChange={(id) => setPickB({ agencyId: id, userId: '', search: '' })}
              onSearchChange={(s) => setPickB((p) => ({ ...p, search: s, userId: '' }))}
              onSelect={(userId) => setPickB((p) => ({ ...p, userId }))}
              filteredUsers={filteredUsers(usersB, pickB.search)}
            />
          </div>

          {designationInvalid && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                {rolesMismatch ? (
                  <>
                    Role mismatch: <strong>{getRoleLabel(userASelected!.role)}</strong> vs{' '}
                    <strong>{getRoleLabel(userBSelected!.role)}</strong>. Only the same designation
                    can be linked.
                  </>
                ) : (
                  <>
                    Scope level mismatch: <strong>{userASelected!.dataScopeLevel}</strong> vs{' '}
                    <strong>{userBSelected!.dataScopeLevel}</strong>. Both must have the same
                    data-scope level.
                  </>
                )}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeLinkModal}>
              Cancel
            </Button>
            <Button
              disabled={!canSubmit}
              onClick={() => {
                linkMutation.mutate({ userIdA: pickA.userId, userIdB: pickB.userId });
              }}
            >
              {linkMutation.isPending ? 'Linking...' : 'Confirm Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UserPickerProps {
  label: string;
  agencies: { id: string; name: string }[];
  pick: UserPick;
  users: LinkedAccount[];
  loading: boolean;
  filteredUsers: LinkedAccount[];
  onAgencyChange: (id: string) => void;
  onSearchChange: (s: string) => void;
  onSelect: (userId: string) => void;
}

function UserPicker({
  label,
  agencies,
  pick,
  users,
  loading,
  filteredUsers,
  onAgencyChange,
  onSearchChange,
  onSelect,
}: UserPickerProps) {
  const [showList, setShowList] = useState(!pick.userId);

  function handleAgencyChange(id: string) {
    setShowList(true);
    onAgencyChange(id);
  }

  function handleSelect(userId: string) {
    onSelect(userId);
    setShowList(false);
  }

  const selected = users.find((u) => u.userId === pick.userId);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>

      <Select value={pick.agencyId} onValueChange={handleAgencyChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select agency..." />
        </SelectTrigger>
        <SelectContent>
          {agencies.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pick.agencyId && selected && !showList && (
        <div
          className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 px-2.5 py-2 cursor-pointer hover:bg-primary/10 transition-colors"
          onClick={() => setShowList(true)}
        >
          <div>
            <p className="text-xs font-medium text-primary">✓ {selected.firstName} {selected.lastName}</p>
            <p className="text-[11px] text-muted-foreground">{selected.email}</p>
          </div>
          <span className="text-[11px] text-muted-foreground underline">Change</span>
        </div>
      )}

      {pick.agencyId && showList && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={pick.search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 h-8 text-sm"
              autoFocus
            />
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : filteredUsers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No available users.</p>
          ) : (
            <div className="max-h-44 overflow-y-auto border rounded-lg divide-y">
              {filteredUsers.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => handleSelect(u.userId)}
                  className={`w-full text-left px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${
                    pick.userId === u.userId ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <div className="font-medium text-xs">{u.firstName} {u.lastName}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {u.email} · {getRoleLabel(u.role)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
