import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Phone, Loader2, Headphones, FileText, TrendingUp, PhoneIncoming } from 'lucide-react';
import { useClientPagination, SectionPaginationBar } from '@/components/SectionPagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InboundCallsTab } from '@/components/phone-system/InboundCallsTab';
import { MyCallExtensionBadge } from '@/components/phone-system/MyCallExtensionBadge';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { format } from 'date-fns';
import { fetchCalls, fetchCallById, type ApiCall, type ApiUser } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CallRecordingPlayer } from '@/components/CallRecordingPlayer';
import { MyConversionRateCard } from '@/components/MyConversionRateCard';
import { useAgencyFilter } from '@/hooks/useAgencyFilter';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { PersonSectionHeader, PersonCardIdentity } from '@/components/PersonSectionHeader';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useSearchParams } from 'react-router-dom';
import { getUserRoleTitle } from '@/lib/roleLabels';

// ─── Palette: one colour per agency section (cycles) ────────────────────────
const AGENCY_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

function formatDuration(seconds: number | undefined): string {
  if (seconds == null || seconds < 0) return '–';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const outcomeColors: Record<string, string> = {
  answered:  'bg-green-500/15 text-green-700 dark:text-green-400',
  voicemail: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  no_answer: 'bg-muted text-muted-foreground',
  busy:      'bg-destructive/15 text-destructive',
  initiated: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
};

// ─── Per-agency call section (full view, rendered for each agency in "All" view) ───
function AgencyCallsSection({
  agency,
  onViewAgency,
  ownerIds,
  scopeKey,
}: {
  agency: { id: string; name: string };
  onViewAgency: () => void;
  ownerIds?: string[];
  scopeKey: string;
}) {
  const [detailCall, setDetailCall] = useState<ApiCall | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeRecordingCallId, setActiveRecordingCallId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agency-calls-full', agency.id, scopeKey],
    queryFn: () => fetchCalls({ agencyIds: [agency.id], scope: 'all', ownerIds, limit: 100 }),
    staleTime: 0,
  });

  const agencyCalls = data?.data ?? [];
  const answeredCount = agencyCalls.filter(c => c.outcome === 'answered').length;
  const withDur = agencyCalls.filter(c => c.duration != null && c.duration > 0);
  const avgDur = withDur.length > 0 ? Math.round(withDur.reduce((s, c) => s + (c.duration ?? 0), 0) / withDur.length) : 0;

  const {
    pageRows,
    startIndex,
    total,
    totalPages,
    page,
    setPage,
    pageSize,
    showPagination,
  } = useClientPagination(agencyCalls, [agency.id, scopeKey]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailCall(null);
    try {
      const c = await fetchCallById(id);
      setDetailCall(c ?? null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">{agency.name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {agencyCalls.length} calls · {answeredCount} answered · avg {formatDuration(avgDur)}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onViewAgency}>View Agency</Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden flex flex-col pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agencyCalls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        No calls yet
                      </TableCell>
                    </TableRow>
                  ) : pageRows.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell>{format(new Date(call.timestamp), 'MMM d, yyyy h:mm a')}</TableCell>
                      <TableCell className="font-medium">{call.clientName}</TableCell>
                      <TableCell className="text-muted-foreground">{call.ownerName}</TableCell>
                      <TableCell>
                        <Badge className={outcomeColors[call.outcome] ?? 'bg-muted'}>
                          {call.outcome.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDuration(call.duration)}</TableCell>
                      <TableCell className="max-w-xs truncate">{call.notes ?? '–'}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openDetail(call.id)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {showPagination && (
                <SectionPaginationBar
                  total={total}
                  startIndex={startIndex}
                  pageLen={pageRows.length}
                  totalPages={totalPages}
                  page={page}
                  onPageChange={setPage}
                  pageSize={pageSize}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!detailCall || detailLoading}
        onOpenChange={(open) => { if (!open) { setDetailCall(null); setActiveRecordingCallId(null); } }}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Call details</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : detailCall ? (
            <div className="space-y-6 pt-4">
              <div>
                <p className="text-sm text-muted-foreground">Client</p>
                <p className="font-medium">{detailCall.clientName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Outcome</p>
                  <Badge className={outcomeColors[detailCall.outcome] ?? 'bg-muted'}>
                    {detailCall.outcome.replace('_', ' ')}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{formatDuration(detailCall.duration)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date & time</p>
                  <p className="font-medium">{format(new Date(detailCall.timestamp), 'MMM d, yyyy h:mm a')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Owner</p>
                  <p className="font-medium">{detailCall.ownerName}</p>
                </div>
              </div>
              {detailCall.notes && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <FileText className="h-4 w-4" /> Notes
                  </p>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{detailCall.notes}</p>
                </div>
              )}
              {detailCall.recordingUrl && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Headphones className="h-4 w-4" /> Recording
                  </p>
                  <CallRecordingPlayer
                    callId={detailCall.id}
                    fallbackDuration={detailCall.duration ?? undefined}
                    isActive={activeRecordingCallId === detailCall.id}
                    onPlay={setActiveRecordingCallId}
                  />
                </div>
              )}
              {detailCall.transcription && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <FileText className="h-4 w-4" /> Transcription
                  </p>
                  <div className="mt-2 p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {detailCall.transcription}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Per-team-member call section card (rendered for each user in "All Team" view) ──
function UserCallsSection({
  user,
  colorIndex,
  onViewCalls,
}: {
  user: ApiUser;
  colorIndex: number;
  onViewCalls: () => void;
}) {
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ['user-calls-section', user.id],
    queryFn: () => fetchCalls({ ownerIds: [user.id], scope: 'all', limit: 100 }),
    staleTime: 0,
    retry: false,
  });

  const userCalls = useMemo(
    () => (data?.data ?? []).filter(c => c.ownerId === user.id),
    [data, user.id]
  );

  const answeredCount  = userCalls.filter(c => c.outcome === 'answered').length;
  const voicemailCount = userCalls.filter(c => c.outcome === 'voicemail').length;
  const withDur = userCalls.filter(c => c.duration != null && c.duration > 0);
  const avgDur  = withDur.length > 0 ? Math.round(withDur.reduce((s, c) => s + (c.duration ?? 0), 0) / withDur.length) : 0;

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          subtitle={`${userCalls.length} call${userCalls.length !== 1 ? 's' : ''}`}
          accentClassName={color.accent}
        />
        <div className="hidden sm:flex items-center gap-1.5 text-xs">
          <span className={cn('px-2 py-1 rounded-full font-medium border', color.bg, color.text, color.border)}>{answeredCount} answered</span>
          {voicemailCount > 0 && <span className="px-2 py-1 rounded-full font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20">{voicemailCount} voicemail</span>}
          <span className="px-2 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">avg {formatDuration(avgDur)}</span>
        </div>
      </div>

      <CardContent className="pt-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading calls...</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Total',     count: userCalls.length,   cls: `${color.bg} ${color.text} ${color.border}` },
                { label: 'Answered',  count: answeredCount,       cls: 'bg-green-500/10 text-green-600 border-green-500/20' },
                { label: 'Voicemail', count: voicemailCount,      cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
                { label: 'No Answer', count: userCalls.filter(c => c.outcome === 'no_answer').length, cls: 'bg-muted text-muted-foreground border-border' },
                { label: 'Avg Duration', count: formatDuration(avgDur), cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
              ].map(s => (
                <div key={s.label} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-2 min-w-[80px] border', s.cls)}>
                  <div>
                    <p className="text-xs font-bold leading-tight">{s.count}</p>
                    <p className="text-[10px] leading-tight">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={onViewCalls}>
              View Calls
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Combined All-Team calls view (manager "All Team" view) ─────────────────
function TeamCallsSection({ teamUsers }: { teamUsers: ApiUser[] }) {
  const PAGE_SIZE = 10;
  const [detailCall, setDetailCall] = useState<ApiCall | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeRecordingCallId, setActiveRecordingCallId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const ownerIds = useMemo(() => teamUsers.map(u => u.id), [teamUsers]);
  const ownerKey = ownerIds.join(',');

  const { data, isLoading } = useQuery({
    queryKey: ['team-calls-full', ownerKey],
    queryFn: () => fetchCalls({ ownerIds, scope: 'all', limit: 200 }),
    staleTime: 0,
    enabled: ownerIds.length > 0,
  });

  const teamCalls = data?.data ?? [];
  const answeredCount = teamCalls.filter(c => c.outcome === 'answered').length;
  const withDur = teamCalls.filter(c => c.duration != null && c.duration > 0);
  const avgDur = withDur.length > 0 ? Math.round(withDur.reduce((s, c) => s + (c.duration ?? 0), 0) / withDur.length) : 0;

  useEffect(() => {
    setPage(1);
  }, [ownerKey]);

  const totalPages = Math.max(1, Math.ceil(teamCalls.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = teamCalls.slice(startIndex, startIndex + PAGE_SIZE);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailCall(null);
    try {
      const c = await fetchCallById(id);
      setDetailCall(c ?? null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <CardHeader className="pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Calls</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {teamCalls.length} calls · {answeredCount} answered · avg {formatDuration(avgDur)}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden flex flex-col pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamCalls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No calls yet</TableCell>
                    </TableRow>
                  ) : pageRows.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell>{format(new Date(call.timestamp), 'MMM d, yyyy h:mm a')}</TableCell>
                      <TableCell className="font-medium">{call.clientName}</TableCell>
                      <TableCell className="text-muted-foreground">{call.ownerName}</TableCell>
                      <TableCell>
                        <Badge className={outcomeColors[call.outcome] ?? 'bg-muted'}>
                          {call.outcome.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDuration(call.duration)}</TableCell>
                      <TableCell className="max-w-xs truncate">{call.notes ?? '–'}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openDetail(call.id)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {teamCalls.length > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-3 mt-2 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, teamCalls.length)} of {teamCalls.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                    >
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {(() => {
                        const maxButtons = 7;
                        const start =
                          totalPages <= maxButtons
                            ? 1
                            : Math.min(Math.max(1, safePage - 3), totalPages - maxButtons + 1);
                        const end = Math.min(start + maxButtons - 1, totalPages);
                        return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                          <Button
                            key={p}
                            variant={safePage === p ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setPage(p)}
                            className="min-w-[36px]"
                          >
                            {p}
                          </Button>
                        ));
                      })()}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!detailCall || detailLoading}
        onOpenChange={(open) => { if (!open) { setDetailCall(null); setActiveRecordingCallId(null); } }}
      >
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Call details</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : detailCall ? (
            <div className="space-y-6 pt-4">
              <div>
                <p className="text-sm text-muted-foreground">Client</p>
                <p className="font-medium">{detailCall.clientName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Outcome</p>
                  <Badge className={outcomeColors[detailCall.outcome] ?? 'bg-muted'}>{detailCall.outcome.replace('_', ' ')}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{formatDuration(detailCall.duration)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date & time</p>
                  <p className="font-medium">{format(new Date(detailCall.timestamp), 'MMM d, yyyy h:mm a')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Owner</p>
                  <p className="font-medium">{detailCall.ownerName}</p>
                </div>
              </div>
              {detailCall.notes && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><FileText className="h-4 w-4" /> Notes</p>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{detailCall.notes}</p>
                </div>
              )}
              {detailCall.recordingUrl && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><Headphones className="h-4 w-4" /> Recording</p>
                  <CallRecordingPlayer
                    callId={detailCall.id}
                    fallbackDuration={detailCall.duration ?? undefined}
                    isActive={activeRecordingCallId === detailCall.id}
                    onPlay={setActiveRecordingCallId}
                  />
                </div>
              )}
              {detailCall.transcription && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><FileText className="h-4 w-4" /> Transcription</p>
                  <div className="mt-2 p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {detailCall.transcription}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function Calls() {
  const { currentSubCompany } = useStore();
  const authUser = useAuthStore((s) => s.user);
  const [calls, setCalls] = useState<ApiCall[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [loading, setLoading] = useState(true);
  const [detailCall, setDetailCall] = useState<ApiCall | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [activeRecordingCallId, setActiveRecordingCallId] = useState<string | null>(null);
  const [callsTab, setCallsTab] = useState<'outbound' | 'inbound'>('outbound');

  const { effectiveAgencyIds } = useAgencyFilter();
  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isPureManager,
    agencies,
    agenciesLoading,
    selectedAgencyId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedManagerId,
    setSelectedUserId,
    onlyMe,
    agencyUsers,
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    scopeKey,
  } = scopeFilter;

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);
  const [callsSearchParams] = useSearchParams();
  const linkedUserIdParam = callsSearchParams.get('linkedUserId') ?? '';

  const loadCounterRef = useRef(0);

  const loadCalls = useCallback(async () => {
    if (callsTab !== 'outbound' || !currentSubCompany?.id) return;
    if (showAgencySections || showAllTeamView) {
      setLoading(false);
      return;
    }
    const counter = ++loadCounterRef.current;
    setLoading(true);
    setListError(null);
    try {
      const agencyIds = isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
        ? [selectedAgencyId]
        : scope === 'mine' ? undefined : effectiveAgencyIds;
      const ownerIds = elevatedOwnerIds;
      const res = await fetchCalls({ page: 1, limit: 100, scope: isElevated || isPureManager ? 'all' : scope, ownerIds, agencyIds });
      if (counter !== loadCounterRef.current) return;
      setCalls(res.data);
      setPagination(res.pagination);
    } catch (e) {
      if (counter !== loadCounterRef.current) return;
      setCalls([]);
      setPagination({ page: 1, limit: 50, total: 0, totalPages: 0 });
      setListError(e instanceof Error ? e.message : 'Failed to load calls');
    } finally {
      if (counter === loadCounterRef.current) setLoading(false);
    }
  }, [callsTab, currentSubCompany?.id, scope, isElevated, isPureManager, showAllTeamView, selectedAgencyId, effectiveAgencyIds, elevatedOwnerIds, linkedUserIdParam]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);




  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailCall(null);
    try {
      const c = await fetchCallById(id);
      setDetailCall(c ?? null);
    } finally {
      setDetailLoading(false);
    }
  };

  const total = pagination.total;
  const answered = calls.filter((c) => c.outcome === 'answered').length;
  const voicemails = calls.filter((c) => c.outcome === 'voicemail').length;
  const withDuration = calls.filter((c) => c.duration != null && c.duration > 0);
  const avgDurationSec =
    withDuration.length > 0
      ? Math.round(withDuration.reduce((s, c) => s + (c.duration ?? 0), 0) / withDuration.length)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 pt-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-foreground">Calls</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-muted-foreground">
              {callsTab === 'inbound'
                ? 'Answered inbound calls and voicemails'
                : loading
                  ? 'Loading…'
                  : `${total} total call${total !== 1 ? 's' : ''}`}
            </p>
            {/* Signed-in user's own PBX extension only — not the staff list */}
            <MyCallExtensionBadge />
          </div>
        </div>
      </div>

      <Tabs value={callsTab} onValueChange={(v) => setCallsTab(v as 'outbound' | 'inbound')}>
        <StickyHeader zIndex={40}>
          <div className="space-y-2">
            <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
            <TabsList>
              <TabsTrigger value="outbound" className="gap-1.5">
                <Phone className="h-4 w-4" />
                Outbound
              </TabsTrigger>
              <TabsTrigger value="inbound" className="gap-1.5">
                <PhoneIncoming className="h-4 w-4" />
                Inbound
              </TabsTrigger>
            </TabsList>
          </div>
        </StickyHeader>

        <TabsContent value="inbound" className="mt-4">
          <InboundCallsTab
            currentUserId={authUser?.id ?? ''}
            subCompanyId={currentSubCompany?.id ?? authUser?.subCompanyId ?? ''}
            canViewAllInbox={isElevated || isPureManager}
            agencyIds={
              isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
                ? [selectedAgencyId]
                : isElevated && effectiveAgencyIds?.length
                  ? effectiveAgencyIds
                  : currentSubCompany?.id
                    ? [currentSubCompany.id]
                    : authUser?.subCompanyId
                      ? [authUser.subCompanyId]
                      : undefined
            }
            ownerIds={elevatedOwnerIds}
          />
        </TabsContent>

        <TabsContent value="outbound" className="mt-4 space-y-6">

      {/* Call Conversion Rate (month-to-date)
          — Elevated (super_admin/director/ops_mgr), All Agencies: mode=team (org-wide performance)
          — Elevated, specific agency, specific user: mode=user
          — Elevated, specific agency, All Users:     mode=team (agency-scoped)
          — Pure manager, specific user:              mode=user
          — Pure manager, All Team:                   mode=team (auto-scoped to direct reports)    */}
      {(() => {
        // Toggle deselected → only-me, show personal conversion rate
        if (showHierarchyFilters && onlyMe) {
          return <MyConversionRateCard activity="calls" mode="self" />;
        }
        if (showAgencySections) {
          return <MyConversionRateCard activity="calls" mode="team" label="All Agencies Call Conversion Rate" />;
        }
        if (isElevated && showAllTeamView) {
          return null;
        }
        if (isElevated && selectedUserId !== 'all' && selectedUserId !== 'me') {
          const u = agencyUsers.find((x) => x.id === selectedUserId);
          return (
            <MyConversionRateCard
              activity="calls"
              mode="user"
              userId={selectedUserId}
              userName={u ? `${u.firstName} ${u.lastName}` : undefined}
            />
          );
        }
        if (isElevated && selectedAgencyId !== 'all') {
          const agencyName = agencies.find(a => a.id === selectedAgencyId)?.name;
          return <MyConversionRateCard activity="calls" mode="team" agencyId={selectedAgencyId} label={agencyName ? `${agencyName} — Call Conversion Rate` : undefined} />;
        }
        if (isPureManager && selectedUserId !== 'all') {
          const u = managerTeamUsers.find((x) => x.id === selectedUserId);
          return (
            <MyConversionRateCard
              activity="calls"
              mode="user"
              userId={selectedUserId}
              userName={u ? `${u.firstName} ${u.lastName}` : undefined}
            />
          );
        }
        if (isPureManager) {
          return <MyConversionRateCard activity="calls" mode="team" />;
        }
        return <MyConversionRateCard activity="calls" mode="self" />;
      })()}

      {/* All Agencies sections — one card per agency */}
      {showAgencySections && (
        agencies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">No agencies in scope</p>
        ) : (
          <div className="space-y-3">
            {agencies.map((agency) => (
              <AgencyCallsSection
                key={agency.id}
                agency={agency}
                onViewAgency={() => setSelectedAgencyId(agency.id)}
                ownerIds={elevatedOwnerIds}
                scopeKey={`${scopeKey}|${elevatedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* Manager / Team — one section per user */}
      {showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-6">
            {managerTeamUsers.map((user) => (
              <div key={user.id}>
                <PersonSectionHeader
                  user={user}
                  roleTitle={getUserRoleTitle(user)}
                  onView={() =>
                    showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                  }
                />
                <TeamCallsSection teamUsers={[user]} />
              </div>
            ))}
          </div>
        )
      )}

      {!showAgencySections && !showAllTeamView && <>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? '–' : total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Answered</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {loading ? '–' : answered}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Voicemails</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {loading ? '–' : voicemails}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? '–' : formatDuration(avgDurationSec)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Call history</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Client</TableHead>
                  {(scope === 'all' || isElevated || isPureManager) && <TableHead>Owner</TableHead>}
                  <TableHead>Outcome</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell>
                      {format(new Date(call.timestamp), 'MMM d, yyyy h:mm a')}
                    </TableCell>
                    <TableCell className="font-medium">{call.clientName}</TableCell>
                    {(scope === 'all' || isElevated || isPureManager) && (
                      <TableCell className="text-muted-foreground">{call.ownerName}</TableCell>
                    )}
                    <TableCell>
                      <Badge className={outcomeColors[call.outcome] ?? 'bg-muted'}>
                        {call.outcome.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDuration(call.duration)}</TableCell>
                    <TableCell className="max-w-xs truncate">{call.notes ?? '–'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openDetail(call.id)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && listError && (
            <div className="text-center py-12 text-destructive">
              {listError}
            </div>
          )}
          {!loading && !listError && calls.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No calls yet. Place calls from the Clients page (phone icon) or pipeline.
            </div>
          )}
        </CardContent>
      </Card>

      </>}

      <Sheet open={!!detailCall || detailLoading} onOpenChange={(open) => { if (!open) { setDetailCall(null); setActiveRecordingCallId(null); } }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Call details</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : detailCall ? (
            <div className="space-y-6 pt-4">
              <div>
                <p className="text-sm text-muted-foreground">Client</p>
                <p className="font-medium">{detailCall.clientName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Outcome</p>
                  <Badge className={outcomeColors[detailCall.outcome] ?? 'bg-muted'}>
                    {detailCall.outcome.replace('_', ' ')}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Duration</p>
                  <p className="font-medium">{formatDuration(detailCall.duration)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date & time</p>
                  <p className="font-medium">
                    {format(new Date(detailCall.timestamp), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                {(scope === 'all' || isElevated || isPureManager) && (
                  <div>
                    <p className="text-sm text-muted-foreground">Owner</p>
                    <p className="font-medium">{detailCall.ownerName}</p>
                  </div>
                )}
              </div>
              {detailCall.notes && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <FileText className="h-4 w-4" /> Notes
                  </p>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{detailCall.notes}</p>
                </div>
              )}
              {detailCall.recordingUrl && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Headphones className="h-4 w-4" /> Recording
                  </p>
                  <CallRecordingPlayer
                    callId={detailCall.id}
                    fallbackDuration={detailCall.duration ?? undefined}
                    isActive={activeRecordingCallId === detailCall.id}
                    onPlay={setActiveRecordingCallId}
                  />
                </div>
              )}
              {detailCall.transcription && (
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <FileText className="h-4 w-4" /> Transcription
                  </p>
                  <div className="mt-2 p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {detailCall.transcription}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
        </TabsContent>
      </Tabs>
    </div>
  );
}
