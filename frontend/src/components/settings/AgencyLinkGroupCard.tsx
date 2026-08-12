/**
 * Admin card for one link group: Edit (members) + Delete (dissolve group).
 * Wired thinly into Settings → Agency Link tab.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil, Trash2, Unlink, UserPlus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  dissolveLinkGroup,
  fetchUsersForLinking,
  linkAgencyUsers,
  unlinkAgencyUser,
  type LinkedAccount,
  type LinkGroup,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import { getRoleLabel } from '@/lib/roleLabels';

type Props = {
  group: LinkGroup;
};

export function AgencyLinkGroupCard({ group }: Props) {
  const qc = useQueryClient();
  const { subCompanies } = useStore();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; name: string } | null>(null);

  const [addAgencyId, setAddAgencyId] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addSearch, setAddSearch] = useState('');

  const { data: usersAdd = [], isLoading: loadingAdd } = useQuery({
    queryKey: ['users-for-linking', addAgencyId],
    queryFn: () => fetchUsersForLinking(addAgencyId),
    enabled: !!addAgencyId && addOpen,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['all-link-groups'] });
    qc.invalidateQueries({ queryKey: ['my-linked-accounts'] });
  };

  const unlinkMutation = useMutation({
    mutationFn: (userId: string) => unlinkAgencyUser(userId),
    onSuccess: () => {
      toast.success('Member removed from group.');
      setRemoveTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to remove member'),
  });

  const dissolveMutation = useMutation({
    mutationFn: () => dissolveLinkGroup(group.groupId),
    onSuccess: () => {
      toast.success('Link group deleted.');
      setDeleteOpen(false);
      setEditOpen(false);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to delete group'),
  });

  const addMutation = useMutation({
    mutationFn: (newUserId: string) =>
      linkAgencyUsers(group.members[0]!.userId, newUserId),
    onSuccess: () => {
      toast.success('User added to group.');
      setAddOpen(false);
      setAddAgencyId('');
      setAddUserId('');
      setAddSearch('');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message ?? 'Failed to add user'),
  });

  const requiredRole = group.members[0]?.role;
  const requiredScope = group.members[0]?.dataScopeLevel;

  const filteredAddUsers = (() => {
    const q = addSearch.toLowerCase();
    const list = usersAdd.filter((u) => {
      if (group.members.some((m) => m.userId === u.userId)) return false;
      if (requiredRole && u.role !== requiredRole) return false;
      if (
        requiredScope &&
        u.dataScopeLevel &&
        u.dataScopeLevel !== requiredScope
      ) {
        return false;
      }
      return true;
    });
    if (!q) return list;
    return list.filter(
      (u) =>
        u.firstName.toLowerCase().includes(q) ||
        u.lastName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        getRoleLabel(u.role).toLowerCase().includes(q),
    );
  })();

  const selectedAdd = usersAdd.find((u) => u.userId === addUserId);
  const addRoleMismatch =
    !!selectedAdd && !!requiredRole && selectedAdd.role !== requiredRole;

  return (
    <>
      <div className="rounded-lg border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground font-mono">
              Group · {group.members.length} members
            </span>
            {group.members.some((m) => !m.isActive) && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                Has inactive member
              </Badge>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                aria-label="Link group options"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Edit link group
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAddOpen(true)}>
                <UserPlus className="h-3.5 w-3.5 mr-2" />
                Add user
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete link group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap gap-2">
          {group.members.map((member) => (
            <MemberChip key={member.userId} member={member} />
          ))}
        </div>
      </div>

      {/* Edit members */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Edit link group</DialogTitle>
            <DialogDescription>
              Remove a member or add another account. Removing the second-to-last member dissolves
              the group.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {group.members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {member.firstName} {member.lastName}
                    {!member.isActive && (
                      <span className="ml-1 text-destructive text-xs">(inactive)</span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {member.subCompanyName} · {getRoleLabel(member.role)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() =>
                    setRemoveTarget({
                      userId: member.userId,
                      name: `${member.firstName} ${member.lastName}`,
                    })
                  }
                >
                  <Unlink className="h-3.5 w-3.5 mr-1" />
                  Remove
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              Add user
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete entire group */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete link group</DialogTitle>
            <DialogDescription>
              This removes every member from the group. They will no longer see linked-account
              filters or Switch Agency for these accounts.
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
            {group.members.map((m) => (
              <li key={m.userId}>
                {m.firstName} {m.lastName} · {m.subCompanyName}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={dissolveMutation.isPending}
              onClick={() => dissolveMutation.mutate()}
            >
              {dissolveMutation.isPending ? 'Deleting…' : 'Delete group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove one member */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Remove <strong>{removeTarget?.name}</strong> from this link group?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={unlinkMutation.isPending}
              onClick={() => removeTarget && unlinkMutation.mutate(removeTarget.userId)}
            >
              {unlinkMutation.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add user */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false);
            setAddAgencyId('');
            setAddUserId('');
            setAddSearch('');
          }
        }}
      >
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Add user to group</DialogTitle>
            <DialogDescription>
              Current members:{' '}
              {group.members.map((m) => `${m.firstName} ${m.lastName}`).join(', ')}.
              Only users with the same role
              {requiredRole ? ` (${getRoleLabel(requiredRole)})` : ''} can be added.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Select
              value={addAgencyId}
              onValueChange={(id) => {
                setAddAgencyId(id);
                setAddUserId('');
                setAddSearch('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select agency..." />
              </SelectTrigger>
              <SelectContent>
                {subCompanies.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {addAgencyId && (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users..."
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                {loadingAdd ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : filteredAddUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No available users.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto border rounded-lg divide-y">
                    {filteredAddUsers.map((u: LinkedAccount) => (
                      <button
                        key={u.userId}
                        type="button"
                        onClick={() => setAddUserId(u.userId)}
                        className={`w-full text-left px-2.5 py-2 text-sm hover:bg-accent transition-colors ${
                          addUserId === u.userId ? 'bg-accent' : ''
                        }`}
                      >
                        <div className="font-medium text-xs">
                          {u.firstName} {u.lastName}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {u.email} · {getRoleLabel(u.role)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selectedAdd && (
                  <p className="text-xs text-primary">
                    Selected: {selectedAdd.firstName} {selectedAdd.lastName}
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!addUserId || addMutation.isPending || addRoleMismatch}
              onClick={() => addUserId && addMutation.mutate(addUserId)}
            >
              {addMutation.isPending ? 'Adding…' : 'Add to group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MemberChip({ member }: { member: LinkedAccount }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium">
          {member.firstName} {member.lastName}
          {!member.isActive && (
            <span className="ml-1 text-destructive">(inactive)</span>
          )}
        </span>
        <span className="text-[11px] text-muted-foreground truncate">
          {member.subCompanyName} · {getRoleLabel(member.role)}
        </span>
      </div>
    </div>
  );
}
