import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAgencyUsers } from '@/hooks/useAgencyUsers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { DemoStaffExtension, DemoRingGroup, DemoVoicemailBox } from '@/lib/phoneSystemTypes';
import {
  assignDefaultStaffExtensions,
  collectDialableUserExtensions,
  isStaffExtensionInUse,
  ringGroupsForUser,
  STAFF_EXTENSION_START,
} from '@/lib/phoneSystemExtensions';

interface StaffExtensionsTabProps {
  agencyId: string;
  staffExtensions: DemoStaffExtension[];
  ringGroups: DemoRingGroup[];
  voicemailBoxes: DemoVoicemailBox[];
  onStaffExtensionsChange: (
    updater: DemoStaffExtension[] | ((prev: DemoStaffExtension[]) => DemoStaffExtension[]),
  ) => void;
  onSaved?: () => void;
}

export function StaffExtensionsTab({
  agencyId,
  staffExtensions,
  ringGroups,
  voicemailBoxes,
  onStaffExtensionsChange,
  onSaved,
}: StaffExtensionsTabProps) {
  const { users, loading, userLabel } = useAgencyUsers(agencyId);
  const autoAssignedRef = useRef(false);

  useEffect(() => {
    autoAssignedRef.current = false;
  }, [agencyId]);

  useEffect(() => {
    if (loading || users.length === 0 || autoAssignedRef.current) return;

    const hasUnassigned = users.some((u) => {
      const ext = staffExtensions.find((s) => s.userId === u.id)?.extension.trim();
      return !ext;
    });
    if (!hasUnassigned) return;

    const next = assignDefaultStaffExtensions(users, staffExtensions, ringGroups, voicemailBoxes);
    const before = new Map(staffExtensions.map((s) => [s.userId, s.extension]));
    const changed =
      next.length !== staffExtensions.length ||
      next.some((s) => before.get(s.userId) !== s.extension);

    if (changed) {
      onStaffExtensionsChange(next);
      onSaved?.();
    }
    autoAssignedRef.current = true;
  }, [
    loading,
    users,
    staffExtensions,
    ringGroups,
    voicemailBoxes,
    onStaffExtensionsChange,
    onSaved,
  ]);

  const extByUserId = new Map(staffExtensions.map((s) => [s.userId, s.extension]));
  const dialableCount = collectDialableUserExtensions(staffExtensions, ringGroups).length;

  const setExtensionForUser = (userId: string, raw: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const extension = raw.replace(/\D/g, '').slice(0, 6);
    const userName = userLabel(user);

    if (extension && isStaffExtensionInUse(extension, staffExtensions, user.id)) {
      toast.error('That extension is already assigned to another user');
      return;
    }

    if (!extension) {
      const groups = ringGroupsForUser(user.id, ringGroups);
      if (groups.length > 0) {
        toast.info(`Removed ${userName} from ring group${groups.length > 1 ? 's' : ''}: ${groups.join(', ')}`);
      }
    }

    onStaffExtensionsChange((prev) => {
      const without = prev.filter((s) => s.userId !== user.id);
      if (!extension) return without;
      return [...without, { userId: user.id, userName, extension }];
    });
    onSaved?.();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Staff extensions</CardTitle>
        <CardDescription>
          Assign a PBX extension to each CRM user. Unassigned users are auto-numbered from{' '}
          {STAFF_EXTENSION_START} on first visit. Ring Groups use this same list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{dialableCount} extensions set</Badge>
          <Badge variant="outline">{users.length} active users</Badge>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading agency users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No active users for this agency. Add users under Users first.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User (from system)</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-[140px]">PBX extension</TableHead>
                <TableHead>Ring groups</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const groups = ringGroupsForUser(user.id, ringGroups);
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{userLabel(user)}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground capitalize">
                      {user.role.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell>
                      <Label className="sr-only">Extension for {userLabel(user)}</Label>
                      <Input
                        className="h-8 font-mono w-28"
                        placeholder="e.g. 101"
                        value={extByUserId.get(user.id) ?? ''}
                        onChange={(e) => setExtensionForUser(user.id, e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {groups.length > 0 ? groups.join(', ') : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <p className="text-xs text-muted-foreground">
          Users with an extension appear on the Call Flow <strong>Extension dial</strong> node and
          in the Ring Groups <strong>Add member</strong> dropdown.
        </p>
      </CardContent>
    </Card>
  );
}
