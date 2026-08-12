import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Headphones, Loader2, PhoneIncoming } from 'lucide-react';
import { CallRecordingPlayer } from '@/components/CallRecordingPlayer';
import {
  fetchInboundCalls,
  fetchInboundCallStreamToken,
  fetchMyRingGroups,
  type ApiInboundCall,
  type InboundInbox,
} from '@/lib/phoneSystemApi';
import { cn } from '@/lib/utils';

const outcomeColors: Record<string, string> = {
  answered: 'bg-green-500/15 text-green-700 dark:text-green-400',
  voicemail: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  no_answer: 'bg-muted text-muted-foreground',
  abandoned: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  busy: 'bg-destructive/15 text-destructive',
  failed: 'bg-destructive/15 text-destructive',
};

type MainTab = 'history' | 'voicemails';
type VoicemailInboxTab = 'mine' | `group:${string}` | 'all';

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return '–';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatPhone(e164: string): string {
  if (e164.startsWith('+1') && e164.length === 12) {
    const n = e164.slice(2);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return e164;
}

function mailboxLabel(call: ApiInboundCall): string {
  return call.voicemailBoxName ?? call.ringGroupName ?? '–';
}

interface InboundCallsTabProps {
  currentUserId: string;
  subCompanyId: string;
  canViewAllInbox?: boolean;
  viewUserId?: string;
  agencyIds?: string[];
  ownerIds?: string[];
  compact?: boolean;
}

export function InboundCallsTab({
  currentUserId,
  subCompanyId,
  canViewAllInbox = false,
  viewUserId,
  agencyIds,
  ownerIds,
  compact = false,
}: InboundCallsTabProps) {
  const [mainTab, setMainTab] = useState<MainTab>('history');
  const [voicemailInboxTab, setVoicemailInboxTab] = useState<VoicemailInboxTab>('mine');
  const [detailCall, setDetailCall] = useState<ApiInboundCall | null>(null);
  const [activeRecordingCallId, setActiveRecordingCallId] = useState<string | null>(null);

  const { data: ringGroups = [] } = useQuery({
    queryKey: ['my-ring-groups', subCompanyId, currentUserId],
    queryFn: () => fetchMyRingGroups(subCompanyId),
    enabled: Boolean(subCompanyId && currentUserId),
    staleTime: 5 * 60_000,
  });

  const voicemailInboxParams = useMemo((): {
    inbox: InboundInbox;
    ringGroupId?: string;
  } => {
    if (voicemailInboxTab === 'all') return { inbox: 'all' };
    if (voicemailInboxTab === 'mine') return { inbox: 'mine' };
    const groupId = voicemailInboxTab.startsWith('group:')
      ? voicemailInboxTab.slice(6)
      : undefined;
    return { inbox: 'ring_group', ringGroupId: groupId };
  }, [voicemailInboxTab]);

  const listUserId = viewUserId ?? currentUserId;

  const historyFilterKey = useMemo(
    () =>
      [
        'history',
        listUserId,
        subCompanyId,
        agencyIds?.join(','),
        ownerIds?.join(','),
        canViewAllInbox,
      ].join('|'),
    [listUserId, subCompanyId, agencyIds, ownerIds, canViewAllInbox],
  );

  const voicemailFilterKey = useMemo(
    () =>
      [
        'voicemail',
        listUserId,
        subCompanyId,
        agencyIds?.join(','),
        ownerIds?.join(','),
        voicemailInboxTab,
      ].join('|'),
    [listUserId, subCompanyId, agencyIds, ownerIds, voicemailInboxTab],
  );

  const historyInbox: InboundInbox = canViewAllInbox ? 'all' : 'answered';

  const { data: historyData, isLoading: historyLoading, isError: historyError } = useQuery({
    queryKey: ['inbound-calls', historyFilterKey],
    queryFn: () =>
      fetchInboundCalls({
        limit: 100,
        userId: viewUserId,
        agencyIds,
        ownerIds: canViewAllInbox ? ownerIds : undefined,
        inbox: historyInbox,
        outcome: 'answered',
      }),
    enabled: Boolean(listUserId && subCompanyId) && mainTab === 'history',
    staleTime: 60_000,
  });

  const { data: voicemailData, isLoading: voicemailLoading, isError: voicemailError } = useQuery({
    queryKey: ['inbound-calls', voicemailFilterKey],
    queryFn: () =>
      fetchInboundCalls({
        limit: 100,
        userId: viewUserId,
        agencyIds,
        ownerIds: voicemailInboxTab === 'all' ? ownerIds : undefined,
        inbox: voicemailInboxParams.inbox,
        ringGroupId: voicemailInboxParams.ringGroupId,
        outcome: 'voicemail',
      }),
    enabled: Boolean(listUserId && subCompanyId) && mainTab === 'voicemails',
    staleTime: 60_000,
  });

  const historyCalls = historyData?.data ?? [];
  const voicemailCalls = voicemailData?.data ?? [];

  const historyWithDuration = historyCalls.filter((c) => c.durationSec != null && c.durationSec > 0);
  const avgDurationSec =
    historyWithDuration.length > 0
      ? Math.round(
          historyWithDuration.reduce((s, c) => s + (c.durationSec ?? 0), 0) /
            historyWithDuration.length,
        )
      : 0;
  const withRecording = historyCalls.filter((c) => c.hasRecording).length;

  const voicemailEmptyMessage = useMemo(() => {
    if (voicemailInboxTab === 'mine') {
      return 'No voicemails on your direct line. Team and ring-group messages appear under their group tabs.';
    }
    if (voicemailInboxTab === 'all') {
      return 'No voicemails for this agency yet.';
    }
    const group = ringGroups.find((g) => voicemailInboxTab === `group:${g.id}`);
    return group
      ? `No voicemails in ${group.name} yet.`
      : 'No voicemails in this team inbox yet.';
  }, [voicemailInboxTab, ringGroups]);

  const detailTitle = detailCall?.outcome === 'voicemail' ? 'Voicemail details' : 'Call details';

  return (
    <div className="space-y-4">
      {!compact && (
        <Tabs
          value={mainTab}
          onValueChange={(v) => setMainTab(v as MainTab)}
          className="w-full"
        >
          <TabsList>
            <TabsTrigger value="history">Call history</TabsTrigger>
            <TabsTrigger value="voicemails">Voicemails</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {mainTab === 'history' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total answered
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {historyLoading ? '–' : historyCalls.length}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  With recording
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">
                  {historyLoading ? '–' : withRecording}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg duration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {historyLoading ? '–' : formatDuration(avgDurationSec)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Ring groups
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{ringGroups.length || '–'}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneIncoming className="h-4 w-4" />
                Inbound call history
              </CardTitle>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading calls…
                </div>
              ) : historyError ? (
                <p className="text-center py-10 text-destructive">Failed to load inbound calls.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      {canViewAllInbox ? <TableHead>Answered by</TableHead> : null}
                      <TableHead>Ring group</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyCalls.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canViewAllInbox ? 8 : 7}
                          className="text-center py-10 text-muted-foreground"
                        >
                          No answered inbound calls yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      historyCalls.map((call) => (
                        <TableRow key={call.id}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(call.startedAt), 'MMM d, yyyy h:mm a')}
                          </TableCell>
                          <TableCell className="font-medium">{formatPhone(call.fromNumber)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatPhone(call.toNumber)}
                          </TableCell>
                          {canViewAllInbox ? (
                            <TableCell className="text-muted-foreground">
                              {call.answeredByName ?? '–'}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-muted-foreground text-sm">
                            {call.ringGroupName ?? '–'}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn(outcomeColors[call.outcome])}>
                              {call.outcome.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDuration(call.durationSec)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {call.hasRecording ? (
                                <Headphones className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                              ) : null}
                              <Button size="sm" variant="ghost" onClick={() => setDetailCall(call)}>
                                View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {!compact && (
            <Tabs
              value={voicemailInboxTab}
              onValueChange={(v) => setVoicemailInboxTab(v as VoicemailInboxTab)}
              className="w-full"
            >
              <TabsList className="flex flex-wrap h-auto gap-1">
                <TabsTrigger value="mine">My voicemails</TabsTrigger>
                {ringGroups.map((g) => (
                  <TabsTrigger key={g.id} value={`group:${g.id}`}>
                    {g.name}
                  </TabsTrigger>
                ))}
                {canViewAllInbox ? <TabsTrigger value="all">All voicemails</TabsTrigger> : null}
              </TabsList>
            </Tabs>
          )}

          {ringGroups.length === 0 && voicemailInboxTab === 'mine' && !compact ? (
            <p className="text-xs text-muted-foreground">
              You are not in a ring group — team inboxes appear after an admin adds you under
              Settings → Phone System → Ring Groups.
            </p>
          ) : null}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Voicemails</p>
                <p className="text-2xl font-semibold">{voicemailCalls.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">With recording</p>
                <p className="text-2xl font-semibold text-amber-600">
                  {voicemailCalls.filter((c) => c.hasRecording).length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">Team inboxes</p>
                <p className="text-2xl font-semibold">{ringGroups.length || '–'}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PhoneIncoming className="h-4 w-4" />
                {voicemailInboxTab === 'mine'
                  ? 'My voicemails'
                  : voicemailInboxTab === 'all'
                    ? 'All voicemails'
                    : ringGroups.find((g) => voicemailInboxTab === `group:${g.id}`)?.name ??
                      'Team voicemails'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {voicemailLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading voicemails…
                </div>
              ) : voicemailError ? (
                <p className="text-center py-10 text-destructive">Failed to load voicemails.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Mailbox</TableHead>
                      <TableHead>Ring group</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {voicemailCalls.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                          {voicemailEmptyMessage}
                        </TableCell>
                      </TableRow>
                    ) : (
                      voicemailCalls.map((call) => (
                        <TableRow key={call.id}>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(call.startedAt), 'MMM d, h:mm a')}
                          </TableCell>
                          <TableCell>{formatPhone(call.fromNumber)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatPhone(call.toNumber)}
                          </TableCell>
                          <TableCell>
                            {mailboxLabel(call) !== '–' ? (
                              <Badge variant="secondary">{mailboxLabel(call)}</Badge>
                            ) : (
                              '–'
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {call.ringGroupName ?? '–'}
                          </TableCell>
                          <TableCell>{formatDuration(call.durationSec)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {call.hasRecording ? (
                                <Headphones className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                              ) : null}
                              <Button size="sm" variant="ghost" onClick={() => setDetailCall(call)}>
                                View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Sheet
        open={!!detailCall}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCall(null);
            setActiveRecordingCallId(null);
          }
        }}
      >
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detailTitle}</SheetTitle>
          </SheetHeader>
          {detailCall && (
            <div className="space-y-4 pt-4 text-sm">
              <div>
                <p className="text-muted-foreground">From</p>
                <p className="font-medium">{formatPhone(detailCall.fromNumber)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">To (called number)</p>
                <p className="font-medium">{formatPhone(detailCall.toNumber)}</p>
              </div>
              {detailCall.outcome === 'voicemail' ? (
                <div>
                  <p className="text-muted-foreground">Mailbox</p>
                  <p className="font-medium">{mailboxLabel(detailCall)}</p>
                </div>
              ) : null}
              <div>
                <p className="text-muted-foreground">Ring group</p>
                <p className="font-medium">{detailCall.ringGroupName ?? '–'}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <p className="text-muted-foreground">Department</p>
                  <p className="font-medium">{detailCall.departmentLabel ?? '–'}</p>
                </div>
                {detailCall.answeredByName ? (
                  <div>
                    <p className="text-muted-foreground">Answered by</p>
                    <p className="font-medium">{detailCall.answeredByName}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-muted-foreground">Outcome</p>
                  <Badge className={cn(outcomeColors[detailCall.outcome])}>
                    {detailCall.outcome.replace('_', ' ')}
                  </Badge>
                </div>
              </div>
              {detailCall.participantNames.length > 0 ? (
                <div>
                  <p className="text-muted-foreground">Rang</p>
                  <p className="font-medium">{detailCall.participantNames.join(', ')}</p>
                </div>
              ) : null}
              <div className="flex gap-4">
                <div>
                  <p className="text-muted-foreground">Talk time</p>
                  <p className="font-medium">{formatDuration(detailCall.durationSec)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Ring time</p>
                  <p className="font-medium">{formatDuration(detailCall.ringDurationSec)}</p>
                </div>
              </div>
              {detailCall.hasRecording ? (
                <div>
                  <p className="text-muted-foreground flex items-center gap-1 mb-1">
                    <Headphones className="h-4 w-4" /> Recording
                  </p>
                  <CallRecordingPlayer
                    callId={detailCall.id}
                    fallbackDuration={detailCall.durationSec ?? undefined}
                    isActive={activeRecordingCallId === detailCall.id}
                    onPlay={setActiveRecordingCallId}
                    fetchStreamToken={fetchInboundCallStreamToken}
                  />
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
