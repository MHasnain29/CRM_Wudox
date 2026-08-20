import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useAgencyUsers } from '@/hooks/useAgencyUsers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Timer, RefreshCw, Unplug, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface HubstaffStatus {
  connected: boolean;
  id?: string;
  hubstaffOrgId?: number;
  orgName?: string | null;
  syncEnabled?: boolean;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  linkedCount?: number;
  unlinkedCount?: number;
}

interface HubstaffMemberLink {
  id: string;
  hubstaffUserId: number;
  hubstaffName: string | null;
  hubstaffEmail: string | null;
  userId: string | null;
  autoMatched: boolean;
  user?: { id: string; firstName: string; lastName: string; email: string; role: string } | null;
}

interface OrgChoice {
  id: number;
  name: string;
}

const UNMAPPED = '__none__';

export function HubstaffTab() {
  const { currentUser, currentSubCompany } = useStore();
  const agencyId = currentSubCompany?.id ?? currentUser?.subCompanyId ?? null;
  const { users } = useAgencyUsers(agencyId);

  const [status, setStatus] = useState<HubstaffStatus | null>(null);
  const [members, setMembers] = useState<HubstaffMemberLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [token, setToken] = useState('');
  const [orgChoices, setOrgChoices] = useState<OrgChoice[] | null>(null);
  const [chosenOrgId, setChosenOrgId] = useState<string>('');
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await apiFetch<{ data: HubstaffStatus }>('/hubstaff/status');
    if (res.ok) setStatus(res.data.data);
    setLoading(false);
  }, []);

  const loadMembers = useCallback(async () => {
    const res = await apiFetch<{ data: HubstaffMemberLink[] }>('/hubstaff/members');
    if (res.ok) setMembers(res.data.data ?? []);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.connected) loadMembers();
  }, [status?.connected, loadMembers]);

  const handleConnect = async () => {
    const pat = rotatedToken ?? token.trim();
    if (!pat) {
      toast.error('Paste your Hubstaff personal access token first');
      return;
    }
    setConnecting(true);
    const body: Record<string, unknown> = { personalAccessToken: pat };
    if (orgChoices && chosenOrgId) body.organizationId = Number(chosenOrgId);

    const res = await apiFetch<{
      data: {
        connected?: boolean;
        requiresOrganizationChoice?: boolean;
        organizations?: OrgChoice[];
        rotatedToken?: string;
        newLinks?: number;
      };
    }>('/hubstaff/connect', { method: 'POST', body: JSON.stringify(body) });
    setConnecting(false);

    if (!res.ok) {
      toast.error(res.error || 'Failed to connect Hubstaff');
      return;
    }
    if (res.data.data.requiresOrganizationChoice) {
      setOrgChoices(res.data.data.organizations ?? []);
      setRotatedToken(res.data.data.rotatedToken ?? null);
      toast.info('This token can see multiple organizations — pick one to finish connecting');
      return;
    }
    toast.success(
      `Hubstaff connected${res.data.data.newLinks ? ` — ${res.data.data.newLinks} member(s) found` : ''}`,
    );
    setToken('');
    setOrgChoices(null);
    setRotatedToken(null);
    setChosenOrgId('');
    loadStatus();
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Hubstaff? Synced time data is kept, but syncing stops.')) return;
    const res = await apiFetch('/hubstaff/disconnect', { method: 'DELETE' });
    if (!res.ok) {
      toast.error(res.error || 'Failed to disconnect');
      return;
    }
    toast.success('Hubstaff disconnected');
    setMembers([]);
    loadStatus();
  };

  const handleSync = async () => {
    setSyncing(true);
    const res = await apiFetch<{ data: { upserted: number; newLinks: number } }>('/hubstaff/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setSyncing(false);
    if (!res.ok) {
      toast.error(res.error || 'Sync failed');
      return;
    }
    toast.success(`Synced ${res.data.data.upserted} daily record(s)`);
    loadStatus();
    loadMembers();
  };

  const handleLink = async (hubstaffUserId: number, userId: string | null) => {
    const res = await apiFetch<{ data: HubstaffMemberLink }>(
      `/hubstaff/members/${hubstaffUserId}/link`,
      { method: 'PUT', body: JSON.stringify({ userId }) },
    );
    if (!res.ok) {
      toast.error(res.error || 'Failed to update mapping');
      return;
    }
    setMembers((prev) => prev.map((m) => (m.hubstaffUserId === hubstaffUserId ? res.data.data : m)));
    toast.success('Mapping updated');
  };

  return (
    <TabsContent value="hubstaff" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Hubstaff Time Tracking
          </CardTitle>
          <CardDescription>
            Connect your Hubstaff organization to sync tracked hours and activity for every mapped
            user. Data refreshes automatically every 30 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">
                  Connected to <span className="font-semibold">{status.orgName ?? `org #${status.hubstaffOrgId}`}</span>
                </span>
                <Badge variant="secondary">{status.linkedCount ?? 0} mapped</Badge>
                {(status.unlinkedCount ?? 0) > 0 && (
                  <Badge variant="outline" className="text-orange-600 border-orange-200">
                    {status.unlinkedCount} unmapped
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Last sync:{' '}
                {status.lastSyncAt ? format(parseISO(status.lastSyncAt), 'MMM d, yyyy h:mm a') : 'never'}
              </p>
              {status.lastSyncError && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{status.lastSyncError}</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSync} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Sync now
                </Button>
                <Button size="sm" variant="outline" onClick={handleDisconnect}>
                  <Unplug className="h-4 w-4 mr-1" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="hubstaff-pat">Personal access token</Label>
                <Input
                  id="hubstaff-pat"
                  type="password"
                  placeholder="Paste your Hubstaff personal access token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={!!rotatedToken}
                />
                <p className="text-xs text-muted-foreground">
                  Create one at developer.hubstaff.com → Personal Access Tokens. It only needs
                  read access to organizations, users, and activities.
                </p>
              </div>
              {orgChoices && (
                <div className="space-y-1.5">
                  <Label>Organization</Label>
                  <Select value={chosenOrgId} onValueChange={setChosenOrgId}>
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Choose the organization to sync" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgChoices.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button onClick={handleConnect} disabled={connecting || (!!orgChoices && !chosenOrgId)}>
                {connecting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {orgChoices ? 'Finish connecting' : 'Connect Hubstaff'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User mapping</CardTitle>
            <CardDescription>
              Hubstaff members are auto-matched to CRM users by email. Fix any that could not be
              matched — unmapped members' time is synced but not shown on the Time Tracking page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No Hubstaff members yet — run a sync to load them.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hubstaff member</TableHead>
                    <TableHead>Hubstaff email</TableHead>
                    <TableHead>CRM user</TableHead>
                    <TableHead className="w-24">Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.hubstaffName ?? `#${m.hubstaffUserId}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.hubstaffEmail ?? '—'}</TableCell>
                      <TableCell>
                        <Select
                          value={m.userId ?? UNMAPPED}
                          onValueChange={(v) => handleLink(m.hubstaffUserId, v === UNMAPPED ? null : v)}
                        >
                          <SelectTrigger className="w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>— Not mapped —</SelectItem>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.firstName} {u.lastName} ({u.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {m.userId ? (
                          <Badge variant={m.autoMatched ? 'secondary' : 'outline'}>
                            {m.autoMatched ? 'auto' : 'manual'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-orange-600 border-orange-200">
                            unmapped
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}
