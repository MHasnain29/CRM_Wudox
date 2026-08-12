import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Video, MapPin, CalendarDays, List, Loader2, X,
  Clock, Building2, User, Calendar as CalendarIcon, TrendingUp,
} from 'lucide-react';
import { format, isToday, isFuture, isPast } from 'date-fns';
import { MeetingsCalendar } from '@/components/MeetingsCalendar';
import { ScheduleMeetingModal } from '@/components/ScheduleMeetingModal';
import { MeetingDetailPanel } from '@/components/MeetingDetailPanel';
import {
  ApiMeeting,
  ApiBookedMeeting,
  fetchMeetings,
  fetchBookedMeetings,
  cancelBookedMeeting,
  fetchUsers,
  type ApiUser,
} from '@/lib/api';
import { TabChipText, TabChipUser } from '@/components/TabChip';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { useHasPermission } from '@/lib/access';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { useSearchParams } from 'react-router-dom';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { useClientPagination, SectionPaginationBar } from '@/components/SectionPagination';
import { PersonSectionHeader, PersonCardIdentity } from '@/components/PersonSectionHeader';

const AGENCY_PALETTE = [
  { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-700 dark:text-violet-300', accent: 'bg-violet-500' },
  { bg: 'bg-sky-500/10',    border: 'border-sky-500/30',    text: 'text-sky-700 dark:text-sky-300',       accent: 'bg-sky-500' },
  { bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',text: 'text-emerald-700 dark:text-emerald-300',accent: 'bg-emerald-500' },
  { bg: 'bg-rose-500/10',   border: 'border-rose-500/30',   text: 'text-rose-700 dark:text-rose-300',     accent: 'bg-rose-500' },
  { bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-700 dark:text-amber-300',   accent: 'bg-amber-500' },
  { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-700 dark:text-indigo-300', accent: 'bg-indigo-500' },
];

// ─── Per-agency meeting section (full view) ────────────────────────────────────
function AgencyMeetingsSection({
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
  const [selectedMeeting, setSelectedMeeting] = useState<{ id: string; type: 'meeting' | 'booked' } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agency-meetings-full', agency.id, scopeKey],
    queryFn: () => fetchMeetings({ agencyIds: [agency.id], scope: 'all', ownerIds, limit: 200 }),
    staleTime: 0,
  });

  const agencyMeetings = data?.data ?? [];
  const todayItems     = agencyMeetings.filter(m => isToday(new Date(m.startTime)));
  const upcomingItems  = agencyMeetings.filter(m => isFuture(new Date(m.startTime)) && !isToday(new Date(m.startTime)));
  const completedItems = agencyMeetings.filter(m => m.status === 'completed');
  const allUpcoming    = agencyMeetings.filter(m => isFuture(new Date(m.startTime)));

  const todayPagination = useClientPagination(todayItems, [agency.id]);
  const upcomingPagination = useClientPagination(upcomingItems, [agency.id]);
  const completedPagination = useClientPagination(completedItems, [agency.id]);

  const renderMeetingCard = (meeting: ApiMeeting) => {
    const meetingPast = isPast(new Date(meeting.endTime));
    const isNow = isToday(new Date(meeting.startTime));
    return (
      <div
        key={meeting.id}
        className="group p-4 rounded-xl border border-border bg-card hover:shadow-md hover:border-primary/20 transition-all cursor-pointer"
        onClick={() => setSelectedMeeting({ id: meeting.id, type: 'meeting' })}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base truncate group-hover:text-primary transition-colors">{meeting.title}</div>
            {meeting.forwardedFromName && <ForwardedChip name={meeting.forwardedFromName} className="mt-1" />}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{meeting.clientName || 'Unknown Client'}</span>
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-2">
            {meeting.status === 'completed' && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">Completed</Badge>}
            {isNow && meeting.status !== 'completed' && <Badge className="bg-primary/10 text-primary border-primary/20">Today</Badge>}
            {meetingPast && meeting.status !== 'completed' && <Badge variant="secondary">Past</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            <span>{format(new Date(meeting.startTime), 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{format(new Date(meeting.startTime), 'h:mm a')} - {format(new Date(meeting.endTime), 'h:mm a')}</span>
          </div>
          {meeting.meetingLink && (
            <div className="flex items-center gap-1.5 text-primary">
              <Video className="h-3.5 w-3.5" /><span>Virtual</span>
            </div>
          )}
          {meeting.location && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              <span className="truncate max-w-[150px]">{meeting.location}</span>
            </div>
          )}
          {meeting.ownerName && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /><span>{meeting.ownerName}</span>
            </div>
          )}
        </div>
        {meeting.meetingLink && !meetingPast && (
          <div className="mt-3 pt-3 border-t">
            <Button size="sm" className="w-full" asChild onClick={(e) => e.stopPropagation()}>
              <a href={meeting.meetingLink} target="_blank" rel="noopener noreferrer">
                <Video className="h-4 w-4 mr-1.5" />Join Meeting
              </a>
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Card>
        <div className="flex items-center justify-between px-6 py-4 shrink-0 border-b">
          <div>
            <h3 className="font-semibold text-base">{agency.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {allUpcoming.length} upcoming · {todayItems.length} today · {completedItems.length} completed
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onViewAgency}>View Agency</Button>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs defaultValue="calendar">
              <div className="px-4 pt-3 shrink-0">
                <TabsList>
                  <TabsTrigger value="calendar" className="gap-2">
                    <CalendarDays className="h-4 w-4" />Calendar
                  </TabsTrigger>
                  <TabsTrigger value="list" className="gap-2">
                    <List className="h-4 w-4" />List View
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="calendar" className="m-0 px-4 pb-4 mt-3">
                <MeetingsCalendar
                  onMeetingClick={(id, type) => setSelectedMeeting({ id, type })}
                  refreshTrigger={0}
                  agencyIds={[agency.id]}
                />
              </TabsContent>

              <TabsContent value="list" className="m-0 px-4 pb-4 mt-3 space-y-6">
                {todayItems.length > 0 && (
                  <div>
                    <h4 className="text-base font-semibold mb-3">Today's Meetings</h4>
                    <div className="grid gap-3">{todayPagination.pageRows.map(renderMeetingCard)}</div>
                    {todayPagination.showPagination && (
                      <SectionPaginationBar
                        total={todayPagination.total}
                        startIndex={todayPagination.startIndex}
                        pageLen={todayPagination.pageRows.length}
                        totalPages={todayPagination.totalPages}
                        page={todayPagination.page}
                        onPageChange={todayPagination.setPage}
                        pageSize={todayPagination.pageSize}
                      />
                    )}
                  </div>
                )}
                <div>
                  <h4 className="text-base font-semibold mb-3">Upcoming</h4>
                  {upcomingItems.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <CalendarDays className="h-10 w-10 mb-3 opacity-40" />
                        <p>No upcoming meetings</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      <div className="grid gap-3">{upcomingPagination.pageRows.map(renderMeetingCard)}</div>
                      {upcomingPagination.showPagination && (
                        <SectionPaginationBar
                          total={upcomingPagination.total}
                          startIndex={upcomingPagination.startIndex}
                          pageLen={upcomingPagination.pageRows.length}
                          totalPages={upcomingPagination.totalPages}
                          page={upcomingPagination.page}
                          onPageChange={upcomingPagination.setPage}
                          pageSize={upcomingPagination.pageSize}
                        />
                      )}
                    </>
                  )}
                </div>
                {completedItems.length > 0 && (
                  <div>
                    <h4 className="text-base font-semibold mb-3">Completed</h4>
                    <div className="grid gap-3">{completedPagination.pageRows.map(renderMeetingCard)}</div>
                    {completedPagination.showPagination && (
                      <SectionPaginationBar
                        total={completedPagination.total}
                        startIndex={completedPagination.startIndex}
                        pageLen={completedPagination.pageRows.length}
                        totalPages={completedPagination.totalPages}
                        page={completedPagination.page}
                        onPageChange={completedPagination.setPage}
                        pageSize={completedPagination.pageSize}
                      />
                    )}
                  </div>
                )}
                {agencyMeetings.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground">No meetings</div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
      {selectedMeeting && (
        <MeetingDetailPanel
          meetingId={selectedMeeting.id}
          meetingType={selectedMeeting.type}
          onClose={() => setSelectedMeeting(null)}
          onUpdated={() => { refetch(); setSelectedMeeting(null); }}
        />
      )}
    </>
  );
}

// ─── Per-team-member meeting section card ──────────────────────────────────────
function UserMeetingsSection({
  user,
  colorIndex,
  onViewMeetings,
}: {
  user: ApiUser;
  colorIndex: number;
  onViewMeetings: () => void;
}) {
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ['user-meetings-section', user.id],
    queryFn: () => fetchMeetings({ ownerIds: [user.id], scope: 'all', limit: 200 }),
    staleTime: 0,
    retry: false,
  });

  const userMeetings = useMemo(
    () => (data?.data ?? []).filter(m => m.ownerId === user.id),
    [data, user.id]
  );

  const todayCount     = userMeetings.filter(m => isToday(new Date(m.startTime))).length;
  const upcomingCount  = userMeetings.filter(m => isFuture(new Date(m.startTime))).length;
  const completedCount = userMeetings.filter(m => m.status === 'completed').length;

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          subtitle={`${userMeetings.length} meeting${userMeetings.length !== 1 ? 's' : ''}`}
          accentClassName={color.accent}
        />
        <div className="hidden sm:flex items-center gap-1.5 text-xs">
          <span className={cn('px-2 py-1 rounded-full font-medium border', color.bg, color.text, color.border)}>{upcomingCount} upcoming</span>
          {todayCount > 0 && <span className="px-2 py-1 rounded-full font-medium bg-primary/10 text-primary border border-primary/20">{todayCount} today</span>}
          <span className="px-2 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">{completedCount} completed</span>
        </div>
      </div>

      <CardContent className="pt-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading meetings...</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Total',     count: userMeetings.length, cls: `${color.bg} ${color.text} ${color.border}` },
                { label: 'Today',     count: todayCount,          cls: 'bg-primary/10 text-primary border-primary/20' },
                { label: 'Upcoming',  count: upcomingCount,       cls: 'bg-sky-500/10 text-sky-600 border-sky-500/20' },
                { label: 'Completed', count: completedCount,      cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
              ].map(s => (
                <div key={s.label} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-2 min-w-[80px] border', s.cls)}>
                  <div>
                    <p className="text-xs font-bold leading-tight">{s.count}</p>
                    <p className="text-[10px] leading-tight">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={onViewMeetings}>
              View Meetings
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Combined All-Team meetings view (manager "All Team" view) ───────────────
function TeamMeetingsSection({ teamUsers }: { teamUsers: { id: string }[] }) {
  const PAGE_SIZE = 10;
  const [selectedMeeting, setSelectedMeeting] = useState<{ id: string; type: 'meeting' | 'booked' } | null>(null);
  const [todayPage, setTodayPage] = useState(1);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);

  const ownerIds = useMemo(() => teamUsers.map(u => u.id), [teamUsers]);
  const ownerKey = ownerIds.join(',');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['team-meetings-full', ownerKey],
    queryFn: () => fetchMeetings({
      ownerIds: ownerIds.length > 0 ? ownerIds : undefined,
      scope: ownerIds.length > 0 ? 'all' : 'team',
      limit: 200,
    }),
    staleTime: 0,
  });

  const teamMeetings  = data?.data ?? [];
  const todayItems    = teamMeetings.filter(m => isToday(new Date(m.startTime)));
  const upcomingItems = teamMeetings.filter(m => isFuture(new Date(m.startTime)) && !isToday(new Date(m.startTime)));
  const completedItems = teamMeetings.filter(m => m.status === 'completed');
  const allUpcoming   = teamMeetings.filter(m => isFuture(new Date(m.startTime)));

  useEffect(() => {
    setTodayPage(1);
    setUpcomingPage(1);
    setCompletedPage(1);
  }, [ownerKey]);

  const paginate = <T,>(rows: T[], page: number) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(startIndex, startIndex + PAGE_SIZE);
    return { totalPages, safePage, startIndex, pageRows, total: rows.length };
  };

  const renderPagination = (
    total: number,
    startIndex: number,
    pageLen: number,
    totalPages: number,
    safePage: number,
    setPage: (updater: number | ((p: number) => number)) => void,
  ) => {
    if (total <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between pt-3 mt-2 border-t">
        <div className="text-sm text-muted-foreground">
          Showing {startIndex + 1} to {Math.min(startIndex + pageLen, total)} of {total}
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
    );
  };

  const todayPageData = paginate(todayItems, todayPage);
  const upcomingPageData = paginate(upcomingItems, upcomingPage);
  const completedPageData = paginate(completedItems, completedPage);

  const renderMeetingCard = (meeting: ApiMeeting) => {
    const meetingPast = isPast(new Date(meeting.endTime));
    const isNow = isToday(new Date(meeting.startTime));
    return (
      <div
        key={meeting.id}
        className="group p-4 rounded-xl border border-border bg-card hover:shadow-md hover:border-primary/20 transition-all cursor-pointer"
        onClick={() => setSelectedMeeting({ id: meeting.id, type: 'meeting' })}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base truncate group-hover:text-primary transition-colors">{meeting.title}</div>
            {meeting.forwardedFromName && <ForwardedChip name={meeting.forwardedFromName} className="mt-1" />}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{meeting.clientName || 'Unknown Client'}</span>
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-2">
            {meeting.status === 'completed' && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">Completed</Badge>}
            {isNow && meeting.status !== 'completed' && <Badge className="bg-primary/10 text-primary border-primary/20">Today</Badge>}
            {meetingPast && meeting.status !== 'completed' && <Badge variant="secondary">Past</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5"><CalendarIcon className="h-3.5 w-3.5" /><span>{format(new Date(meeting.startTime), 'MMM d, yyyy')}</span></div>
          <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /><span>{format(new Date(meeting.startTime), 'h:mm a')} - {format(new Date(meeting.endTime), 'h:mm a')}</span></div>
          {meeting.meetingLink && <div className="flex items-center gap-1.5 text-primary"><Video className="h-3.5 w-3.5" /><span>Virtual</span></div>}
          {meeting.location && <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /><span className="truncate max-w-[150px]">{meeting.location}</span></div>}
          {meeting.ownerName && <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /><span>{meeting.ownerName}</span></div>}
        </div>
        {meeting.meetingLink && !meetingPast && (
          <div className="mt-3 pt-3 border-t">
            <Button size="sm" className="w-full" asChild onClick={(e) => e.stopPropagation()}>
              <a href={meeting.meetingLink} target="_blank" rel="noopener noreferrer">
                <Video className="h-4 w-4 mr-1.5" />Join Meeting
              </a>
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Card>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="font-semibold text-base">Meetings</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {allUpcoming.length} upcoming · {todayItems.length} today · {completedItems.length} completed
            </p>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs defaultValue="calendar">
              <div className="px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="calendar" className="gap-2"><CalendarDays className="h-4 w-4" />Calendar</TabsTrigger>
                  <TabsTrigger value="list" className="gap-2"><List className="h-4 w-4" />List View</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="calendar" className="m-0 px-4 pb-4 mt-3">
                <MeetingsCalendar
                  onMeetingClick={(id, type) => setSelectedMeeting({ id, type })}
                  refreshTrigger={0}
                  ownerIds={ownerIds}
                />
              </TabsContent>
              <TabsContent value="list" className="m-0 px-4 pb-4 mt-3 space-y-6">
                {todayItems.length > 0 && (
                  <div>
                    <h4 className="text-base font-semibold mb-3">Today's Meetings</h4>
                    <div className="grid gap-3">{todayPageData.pageRows.map(renderMeetingCard)}</div>
                    {renderPagination(
                      todayPageData.total,
                      todayPageData.startIndex,
                      todayPageData.pageRows.length,
                      todayPageData.totalPages,
                      todayPageData.safePage,
                      setTodayPage,
                    )}
                  </div>
                )}
                <div>
                  <h4 className="text-base font-semibold mb-3">Upcoming</h4>
                  {upcomingItems.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <CalendarDays className="h-10 w-10 mb-3 opacity-40" />
                        <p>No upcoming meetings</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <>
                      <div className="grid gap-3">{upcomingPageData.pageRows.map(renderMeetingCard)}</div>
                      {renderPagination(
                        upcomingPageData.total,
                        upcomingPageData.startIndex,
                        upcomingPageData.pageRows.length,
                        upcomingPageData.totalPages,
                        upcomingPageData.safePage,
                        setUpcomingPage,
                      )}
                    </>
                  )}
                </div>
                {completedItems.length > 0 && (
                  <div>
                    <h4 className="text-base font-semibold mb-3">Completed</h4>
                    <div className="grid gap-3">{completedPageData.pageRows.map(renderMeetingCard)}</div>
                    {renderPagination(
                      completedPageData.total,
                      completedPageData.startIndex,
                      completedPageData.pageRows.length,
                      completedPageData.totalPages,
                      completedPageData.safePage,
                      setCompletedPage,
                    )}
                  </div>
                )}
                {teamMeetings.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground">No meetings</div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
      {selectedMeeting && (
        <MeetingDetailPanel
          meetingId={selectedMeeting.id}
          meetingType={selectedMeeting.type}
          onClose={() => setSelectedMeeting(null)}
          onUpdated={() => { refetch(); setSelectedMeeting(null); }}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────────

export default function Meetings() {
  const [meetings, setMeetings] = useState<ApiMeeting[]>([]);
  const [bookedMeetings, setBookedMeetings] = useState<ApiBookedMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<{ id: string; type: 'meeting' | 'booked' } | null>(null);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const hasLoaded = useRef(false);

  const currentUser = useAuthStore((s) => s.user);
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const currentUserId = currentUser?.id;
  const canScheduleMeetings = useHasPermission('meetings:write');

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
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    scopeKey,
  } = scopeFilter;

  const writeAgencyId = useWriteAgencyId(
    isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
      ? selectedAgencyId
      : currentUser?.subCompanyId,
  );

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);
  const [meetingsSearchParams] = useSearchParams();
  const linkedUserIdParam = meetingsSearchParams.get('linkedUserId') ?? '';

  const loadCounterRef = useRef(0);

  // ── Load meetings ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);

    if (showAgencySections || showAllTeamView) {
      setLoading(false);
      hasLoaded.current = true;
      return;
    }

    const counter = ++loadCounterRef.current;
    try {
      const agencyIds = isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? [selectedAgencyId] : undefined;
      const ownerIds = elevatedOwnerIds;

      const [mRes, bRes] = await Promise.all([
        fetchMeetings({ limit: 200, scope: isElevated || isPureManager ? 'all' : undefined, agencyIds, ownerIds }),
        fetchBookedMeetings({ limit: 200 }),
      ]);
      if (counter !== loadCounterRef.current) return;
      setMeetings(mRes.data);
      setBookedMeetings(bRes.data);
    } catch {
      // ignore
    } finally {
      if (counter === loadCounterRef.current) {
        setLoading(false);
        hasLoaded.current = true;
        setCalendarRefresh(prev => prev + 1);
      }
    }
  }, [isElevated, isPureManager, showAllTeamView, selectedAgencyId, elevatedOwnerIds, linkedUserIdParam]);

  useEffect(() => { loadData(); }, [loadData]);

  // Counts (for non-all view)
  const scheduledBooked  = bookedMeetings.filter(m => m.status === 'scheduled');
  const todayMeetings    = meetings.filter(m => isToday(new Date(m.startTime)));
  const todayBooked      = scheduledBooked.filter(m => isToday(new Date(m.startTime)));
  const allToday         = todayMeetings.length + todayBooked.length;
  const upcomingMeetings = meetings.filter(m => isFuture(new Date(m.startTime)));
  const upcomingBooked   = scheduledBooked.filter(m => isFuture(new Date(m.startTime)));
  const allUpcoming      = upcomingMeetings.length + upcomingBooked.length;
  const completedMeetings = meetings.filter(m => m.status === 'completed');
  const completedBooked   = bookedMeetings.filter(m => m.status === 'completed');
  const allCompleted      = completedMeetings.length + completedBooked.length;

  const handleCancelBooked = async (id: string) => {
    const ok = await cancelBookedMeeting(id);
    if (ok) { toast.success('Meeting cancelled'); loadData(); }
    else toast.error('Failed to cancel meeting');
  };

  const handleMeetingClick = (id: string, type: 'meeting' | 'booked') => {
    setSelectedMeeting({ id, type });
  };

  // ── Meeting Card ─────────────────────────────────────────────────────────────
  const MeetingCard = ({ meeting }: { meeting: ApiMeeting }) => {
    const meetingPast = isPast(new Date(meeting.endTime));
    const isNow = isToday(new Date(meeting.startTime));

    return (
      <div
        className="group p-4 rounded-xl border border-border bg-card hover:shadow-md hover:border-primary/20 transition-all cursor-pointer"
        onClick={() => handleMeetingClick(meeting.id, 'meeting')}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base truncate group-hover:text-primary transition-colors">{meeting.title}</div>
            {meeting.forwardedFromName && <ForwardedChip name={meeting.forwardedFromName} className="mt-1" />}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{meeting.clientName || 'Unknown Client'}</span>
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-2">
            {meeting.status === 'completed' && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">Completed</Badge>}
            {isNow && meeting.status !== 'completed' && <Badge className="bg-primary/10 text-primary border-primary/20">Today</Badge>}
            {meetingPast && meeting.status !== 'completed' && <Badge variant="secondary">Past</Badge>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            <span>{format(new Date(meeting.startTime), 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{format(new Date(meeting.startTime), 'h:mm a')} - {format(new Date(meeting.endTime), 'h:mm a')}</span>
          </div>
          {meeting.meetingLink && (
            <div className="flex items-center gap-1.5 text-primary">
              <Video className="h-3.5 w-3.5" />
              <span>Virtual</span>
            </div>
          )}
          {meeting.location && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              <span className="truncate max-w-[150px]">{meeting.location}</span>
            </div>
          )}
          {(isElevated || isPureManager) && meeting.ownerName && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              <span>{meeting.ownerName}</span>
            </div>
          )}
        </div>

        {meeting.meetingLink && !meetingPast && (
          <div className="mt-3 pt-3 border-t">
            <Button
              size="sm"
              className="w-full"
              asChild
              onClick={(e) => e.stopPropagation()}
            >
              <a href={meeting.meetingLink} target="_blank" rel="noopener noreferrer">
                <Video className="h-4 w-4 mr-1.5" />
                Join Meeting
              </a>
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ── Booked Meeting Card ───────────────────────────────────────────────────────
  const BookedMeetingCard = ({ booking }: { booking: ApiBookedMeeting }) => {
    const bookingPast = isPast(new Date(booking.endTime));
    const isNow = isToday(new Date(booking.startTime));

    return (
      <div
        className="group p-4 rounded-xl border border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20 hover:shadow-md hover:border-green-400/40 transition-all cursor-pointer"
        onClick={() => handleMeetingClick(booking.id, 'booked')}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base truncate group-hover:text-green-700 dark:group-hover:text-green-400 transition-colors">
              Meeting with {booking.guestName}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{booking.guestEmail}{booking.guestCompany && ` · ${booking.guestCompany}`}</span>
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-2">
            {isNow && <Badge className="bg-primary/10 text-primary border-primary/20">Today</Badge>}
            <Badge variant="outline" className="bg-green-100/80 text-green-700 dark:bg-green-900/50 dark:text-green-300 border-green-200 dark:border-green-800">
              Booked
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            <span>{format(new Date(booking.startTime), 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{format(new Date(booking.startTime), 'h:mm a')} - {format(new Date(booking.endTime), 'h:mm a')}</span>
          </div>
        </div>

        {booking.status === 'scheduled' && !bookingPast && (
          <div className="mt-3 pt-3 border-t border-green-200/50 dark:border-green-900/50 flex gap-2">
            {booking.meetingLink && (
              <Button size="sm" className="flex-1" asChild onClick={(e) => e.stopPropagation()}>
                <a href={booking.meetingLink} target="_blank" rel="noopener noreferrer">
                  <Video className="h-4 w-4 mr-1.5" />
                  Join Meeting
                </a>
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => { e.stopPropagation(); handleCancelBooked(booking.id); }}
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>
        )}
      </div>
    );
  };

  if (loading && !hasLoaded.current) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showAllAgencies = showAgencySections;
  const showAllTeam = showAllTeamView;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Meetings</h1>
          <p className="text-muted-foreground mt-1">
            {showAllTeam
              ? `${managerTeamUsers.length} ${showManagerSections ? 'managers' : 'team members'}`
              : showAllAgencies
                ? `${agencies.length} agencies`
                : `${allUpcoming} upcoming meetings`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canScheduleMeetings && (
            <Button className="gap-2" onClick={() => setShowScheduleModal(true)}>
              <Plus className="h-4 w-4" />
              Schedule Meeting
            </Button>
          )}
        </div>
      </div>

      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {/* ── Per-user / All Agencies view ─────────────────────────────────────── */}
      {showAllTeam ? (
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
                <TeamMeetingsSection teamUsers={[user]} />
              </div>
            ))}
          </div>
        )
      ) : showAllAgencies ? (
        agencies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">No agencies in scope</p>
        ) : (
          <div className="space-y-4">
            {agencies.map((agency) => (
              <AgencyMeetingsSection
                key={agency.id}
                agency={agency}
                onViewAgency={() => setSelectedAgencyId(agency.id)}
                ownerIds={elevatedOwnerIds}
                scopeKey={`${scopeKey}|${elevatedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-none shadow-sm">
              <CardContent className="pt-5 pb-4">
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-3xl font-bold text-primary mt-1">{allToday}</p>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="pt-5 pb-4">
                <p className="text-sm text-muted-foreground">Upcoming</p>
                <p className="text-3xl font-bold mt-1">{allUpcoming}</p>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="pt-5 pb-4">
                <p className="text-sm text-muted-foreground">Booked via Link</p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">{scheduledBooked.length}</p>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="pt-5 pb-4">
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{allCompleted}</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="calendar" className="space-y-4">
            <StickyHeader>
              <TabsList>
                <TabsTrigger value="calendar" className="gap-2">
                  <CalendarDays className="h-4 w-4" />
                  Calendar
                </TabsTrigger>
                <TabsTrigger value="list" className="gap-2">
                  <List className="h-4 w-4" />
                  List View
                </TabsTrigger>
              </TabsList>
            </StickyHeader>

            <TabsContent value="calendar">
              <MeetingsCalendar
                onMeetingClick={handleMeetingClick}
                refreshTrigger={calendarRefresh}
                agencyIds={isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? [selectedAgencyId] : undefined}
                ownerIds={elevatedOwnerIds}
              />
            </TabsContent>

            <TabsContent value="list" className="space-y-6">
              {/* Today */}
              {(todayMeetings.length > 0 || todayBooked.length > 0) && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Today's Meetings</h3>
                  <div className="grid gap-3">
                    {todayMeetings.map(m => <MeetingCard key={m.id} meeting={m} />)}
                    {todayBooked.map(b => <BookedMeetingCard key={b.id} booking={b} />)}
                  </div>
                </div>
              )}

              {/* Upcoming */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Upcoming</h3>
                {upcomingMeetings.filter(m => !isToday(new Date(m.startTime))).length === 0 &&
                 upcomingBooked.filter(m => !isToday(new Date(m.startTime))).length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <CalendarDays className="h-10 w-10 mb-3 opacity-40" />
                      <p>No upcoming meetings scheduled</p>
                      {canScheduleMeetings && (
                        <Button variant="link" className="mt-2" onClick={() => setShowScheduleModal(true)}>
                          Schedule one now
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3">
                    {upcomingMeetings
                      .filter(m => !isToday(new Date(m.startTime)))
                      .map(m => <MeetingCard key={m.id} meeting={m} />)}
                    {upcomingBooked
                      .filter(m => !isToday(new Date(m.startTime)))
                      .map(b => <BookedMeetingCard key={b.id} booking={b} />)}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Schedule Meeting Modal */}
      <ScheduleMeetingModal
        open={showScheduleModal}
        onOpenChange={setShowScheduleModal}
        subCompanyId={writeAgencyId}
        onCreated={loadData}
      />

      {/* Meeting Detail Panel */}
      {selectedMeeting && (
        <MeetingDetailPanel
          meetingId={selectedMeeting.id}
          meetingType={selectedMeeting.type}
          onClose={() => setSelectedMeeting(null)}
          onUpdated={loadData}
        />
      )}
    </div>
  );
}
