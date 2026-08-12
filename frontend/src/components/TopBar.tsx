import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListChecks, Bell, Search, Pause, Play, Clock, GraduationCap, Users2, LogOut, CheckCheck, Loader2, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';
import { useCanViewPipeline } from '@/lib/access';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  fetchNotifications,
  fetchNotificationUnreadCount,
  fetchDailyActivityTodayCount,
  getNotificationStreamUrl,
  logBreak,
  markNotificationRead,
  markAllNotificationsRead,
  type ApiNotification,
} from '@/lib/api';
import { format } from 'date-fns';
import { BugReportDialog } from '@/components/BugReportDialog';
import { DailyActivityModal } from '@/components/DailyActivityModal';
import { getSocket } from '@/lib/socket';
import { captureScreenWithFallback } from '@/lib/captureScreen';
import { toast } from 'sonner';
import { agencyRecordName, companyBrandingName, showCompanyLogoInAppChrome } from '@/lib/branding';
import { useCanSubmitBugReports, useCanViewGlobalScope } from '@/lib/access';
import { getUserRoleTitle } from '@/lib/roleLabels';

const breakTypes = [
  { id: 'coaching', label: 'Coaching/Training', icon: GraduationCap, color: 'text-blue-500' },
  { id: 'meeting', label: 'Meeting', icon: Users2, color: 'text-green-500' },
];
/** Types with dedicated real-time handlers — skip generic TopBar toasts to avoid duplicates. */
const SKIP_REALTIME_TOAST_TYPES = new Set(['task_assigned']);
/** Fixed indigo color for the logged-in user's own notifications. */
const SELF_COLOR = '#4F46E5';
const BREAK_STORAGE_KEY = 'activeBreak';
const DAILY_AGENDA_AUTO_OPEN_PREFIX = 'daily-agenda-auto-opened';

function dailyAgendaAutoOpenKey(userId: string): string {
  return `${DAILY_AGENDA_AUTO_OPEN_PREFIX}:${userId}`;
}

function hasAutoOpenedDailyAgenda(userId: string): boolean {
  try {
    return sessionStorage.getItem(dailyAgendaAutoOpenKey(userId)) === '1';
  } catch {
    return false;
  }
}

function markDailyAgendaAutoOpened(userId: string): void {
  try {
    sessionStorage.setItem(dailyAgendaAutoOpenKey(userId), '1');
  } catch {
    // Session storage can be unavailable in private browsing; ref fallback still works.
  }
}

export function TopBar() {
  const navigate = useNavigate();
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const subCompanies = useStore((s) => s.subCompanies);
  const setCurrentSubCompany = useStore((s) => s.setCurrentSubCompany);
  const unreadNotificationsCount = useStore((s) => s.unreadNotificationsCount);
  const setUnreadNotificationsCount = useStore((s) => s.setUnreadNotificationsCount);
  const isOnBreak = useStore((s) => s.isOnBreak);
  const setIsOnBreak = useStore((s) => s.setIsOnBreak);

  const setViewedSubCompanyId = useStore((s) => s.setViewedSubCompanyId);
  const setLeads = useStore((s) => s.setLeads);
  const setTasks = useStore((s) => s.setTasks);
  const setFollowUps = useStore((s) => s.setFollowUps);
  const setMeetings = useStore((s) => s.setMeetings);
  const queryClient = useQueryClient();

  const authUser = useAuthStore((s) => s.user);
  const roleLabel = useAuthStore((s) => s.roleLabel);
  const logout = useAuthStore((s) => s.logout);
  const displayUser = authUser;
  const displayRoleTitle = displayUser
    ? (roleLabel?.trim() || getUserRoleTitle({ userType: displayUser.userType, role: displayUser.role }))
    : '—';
  const canViewPipeline = useCanViewPipeline();

  const [currentBreakType, setCurrentBreakType] = useState<string | null>(null);
  const [breakStartTime, setBreakStartTime] = useState<Date | null>(null);
  const [breakDuration, setBreakDuration] = useState(0);

  const [dailyActivityOpen, setDailyActivityOpen] = useState(false);
  const [todayActivityCount, setTodayActivityCount] = useState(0);
  const dailyActivityRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Auto-open Daily Agenda once per login when today count > 0 */
  const autoOpenedAgendaForUserRef = useRef<string | null>(null);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsOpenRef = useRef(notificationsOpen);
  notificationsOpenRef.current = notificationsOpen;
  const lastShownNotificationIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Notification queue: holds pending toasts waiting to be shown (5 max on screen at a time)
  const notifQueueRef = useRef<ApiNotification[]>([]);
  const activeToastCountRef = useRef(0);
  // In-memory session dedup: prevents SSE from re-toasting what login-init already queued
  const sessionShownIdsRef = useRef(new Set<string>());
  // Stable ref to flushNotifQueue to avoid stale closures inside onDismiss callbacks
  const flushNotifQueueRef = useRef<() => void>(() => {});

  // Unlock AudioContext on first user interaction (browser requirement)
  useEffect(() => {
    const unlock = () => {
      if (audioCtxRef.current) return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('click', unlock);
    return () => document.removeEventListener('click', unlock);
  }, []);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [activeNotifTab, setActiveNotifTab] = useState<string>('all');

  // Derive unique linked users from notification data (no extra API call)
  const linkedUsersInNotifs = useMemo(() => {
    const seen = new Map<string, { userId: string; firstName: string; lastName: string; color: string }>();
    notifications.forEach((n) => {
      if (!n.isOwn && n.sourceUserId && !seen.has(n.sourceUserId)) {
        seen.set(n.sourceUserId, {
          userId: n.sourceUserId,
          firstName: n.sourceFirstName ?? '',
          lastName: n.sourceLastName ?? '',
          color: n.sourceUserColor ?? '#EA580C',
        });
      }
    });
    return Array.from(seen.values());
  }, [notifications]);

  // Single source of truth for linked user colors — cards + tabs both read from here
  const colorByUserId = useMemo(() => {
    const map = new Map<string, string>();
    linkedUsersInNotifs.forEach((u) => map.set(u.userId, u.color));
    return map;
  }, [linkedUsersInNotifs]);

  const filteredNotifications = useMemo(() => {
    if (activeNotifTab === 'all') return notifications;
    return notifications.filter((n) => n.sourceUserId === activeNotifTab);
  }, [notifications, activeNotifTab]);

  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugScreenshot, setBugScreenshot] = useState<string | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);

  const loadNotificationCount = useCallback(async () => {
    try {
      const count = await fetchNotificationUnreadCount();
      setUnreadNotificationsCount(count);
    } catch {
      // ignore
    }
  }, [setUnreadNotificationsCount]);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const list = await fetchNotifications(30);
      setNotifications(list);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  /** Returns the deep-link URL for a notification. */
  const notifLink = (n: Pick<ApiNotification, 'type' | 'relatedId' | 'link'>) => {
    if (n.type === 'lead_assigned') return canViewPipeline ? '/pipeline' : '/leads';
    if (n.type === 'lead_requested') return `/leads?review=${n.relatedId}`;
    if (n.type === 'lead_request_approved' || n.type === 'lead_request_rejected') return '/leads';
    if (n.type === 'lead_reassignment_requested' || n.type === 'lead_reassignment_approved' || n.type === 'lead_reassignment_rejected') return '/leads';
    if (n.type === 'client_pending_submission' || n.type === 'client_pending_edit') return '/clients?tab=pending';
    if (n.type === 'proposal_submitted') return `/proposals?open=${n.relatedId}`;
    if (n.type === 'proposal_approved' || n.type === 'proposal_rejected') return '/proposals';
    if (n.type.startsWith('follow_up_') && n.relatedId) return `/follow-ups?open=${n.relatedId}`;
    return n.link;
  };

  /**
   * Drain the notifQueue, showing up to 5 toasts at a time.
   * Each dismissed toast calls this again to pull the next one from the queue.
   */
  const flushNotifQueue = useCallback(() => {
    const MAX_VISIBLE = 5;
    while (activeToastCountRef.current < MAX_VISIBLE && notifQueueRef.current.length > 0) {
      const n = notifQueueRef.current.shift()!;
      if (SKIP_REALTIME_TOAST_TYPES.has(n.type)) continue;
      activeToastCountRef.current++;
      const link = notifLink(n);
      toast(n.title, {
        id: n.id,
        description: n.body || undefined,
        duration: Infinity,
        onDismiss: () => {
          activeToastCountRef.current = Math.max(0, activeToastCountRef.current - 1);
          flushNotifQueueRef.current();
        },
        action: link
          ? { label: 'View', onClick: () => navigate(link) }
          : undefined,
      });
    }
  }, [navigate, canViewPipeline]);
  flushNotifQueueRef.current = flushNotifQueue;

  const showToastForLatestNotification = useCallback(async () => {
    const userId = authUser?.id;
    if (!userId) return;
    try {
      const list = await fetchNotifications(20);
      const realNotifs = list.filter((n) => !n.isReminder && !n.readAt);
      if (!realNotifs.length) return;

      // Find notifications we haven't toasted yet this session (max 5 at a time to avoid spam)
      const newNotifs = realNotifs
        .filter((n) => !sessionShownIdsRef.current.has(n.id))
        .slice(0, 5);
      if (!newNotifs.length) return;

      // Mark in session Set BEFORE showing — prevents a concurrent SSE call from duplicating the same toasts.
      for (const n of newNotifs) sessionShownIdsRef.current.add(n.id);

      // Play notification sound once for the batch
      try {
        const ctx = audioCtxRef.current;
        if (ctx) {
          if (ctx.state === 'suspended') await ctx.resume();
          [523, 784].forEach((freq, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.18);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
            o.start(ctx.currentTime + i * 0.18);
            o.stop(ctx.currentTime + i * 0.18 + 0.35);
          });
        }
      } catch {
        // ignore — audio not supported or blocked by browser
      }

      // Show individual toast for each new notification
      for (const n of newNotifs) {
        if (SKIP_REALTIME_TOAST_TYPES.has(n.type)) continue;
        toast(n.title, {
          id: n.id,
          description: n.body || undefined,
          duration: Infinity,
          action: n.link
            ? {
                label: 'View',
                onClick: async () => {
                  navigate(notifLink(n) ?? n.link!);
                  try {
                    await markNotificationRead(n.id);
                    loadNotificationCount();
                  } catch {
                    // ignore — navigation already happened
                  }
                },
              }
            : undefined,
        });
      }

      // Notifications intentionally NOT marked as read here — readAt is set only
      // when the user explicitly clicks/reads them.
      lastShownNotificationIdRef.current = realNotifs[0].id;
    } catch {
      // Silently ignore — toast is a nice-to-have, not critical
    }
  }, [navigate, loadNotificationCount, authUser]);

  // On page load / login: fetch ALL unread notifications and queue them as individual persistent toasts.
  // Shows 5 at a time — each dismissed toast pulls the next from the queue.
  // Uses only in-memory session tracking (sessionShownIdsRef) so notifications re-appear
  // on every page refresh until the user marks them read via the bell icon.
  useEffect(() => {
    const userId = authUser?.id;
    if (!userId) return;

    // Reset queue state on fresh load / user change
    notifQueueRef.current = [];
    activeToastCountRef.current = 0;
    sessionShownIdsRef.current = new Set();

    const loadAndQueueUnread = async () => {
      try {
        const list = await fetchNotifications(500);
        const unreadNotifs = list.filter(
          (n) => !n.isReminder && !n.readAt && !sessionShownIdsRef.current.has(n.id)
        );

        if (!unreadNotifs.length) return;

        // Register all IDs in session tracker so SSE won't duplicate them
        for (const n of unreadNotifs) sessionShownIdsRef.current.add(n.id);

        notifQueueRef.current = unreadNotifs;
        flushNotifQueue();
      } catch {
        // ignore
      }
    };

    loadAndQueueUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  // Load fresh unread count on mount — covers notifications that arrived while logged out
  useEffect(() => {
    loadNotificationCount();
  }, [loadNotificationCount]);

  const loadTodayActivityCount = useCallback(async (autoOpenOnLogin = false) => {
    if (!authUser?.id) return;
    try {
      const { count } = await fetchDailyActivityTodayCount();
      setTodayActivityCount(count);
      if (
        autoOpenOnLogin &&
        count > 0 &&
        autoOpenedAgendaForUserRef.current !== authUser.id &&
        !hasAutoOpenedDailyAgenda(authUser.id)
      ) {
        autoOpenedAgendaForUserRef.current = authUser.id;
        markDailyAgendaAutoOpened(authUser.id);
        setDailyActivityOpen(true);
      }
    } catch {
      /* ignore — badge optional */
    }
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) {
      autoOpenedAgendaForUserRef.current = null;
      return;
    }
    void loadTodayActivityCount(true);
  }, [authUser?.id, loadTodayActivityCount]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const schedule = () => {
      if (dailyActivityRefreshTimer.current) clearTimeout(dailyActivityRefreshTimer.current);
      dailyActivityRefreshTimer.current = setTimeout(() => {
        void loadTodayActivityCount();
      }, 600);
    };
    const events = [
      'task:refresh',
      'followup:refresh',
      'lead:refresh',
      'proposal:refresh',
      'meeting:refresh',
      'call:refresh',
      'email:refresh',
      'notification:new',
      'client:refresh',
    ];
    for (const ev of events) socket.on(ev, schedule);
    return () => {
      if (dailyActivityRefreshTimer.current) clearTimeout(dailyActivityRefreshTimer.current);
      for (const ev of events) socket.off(ev, schedule);
    };
  }, [loadTodayActivityCount]);

  const handleNotificationsOpenChange = (open: boolean) => {
    setNotificationsOpen(open);
    if (open) {
      loadNotifications();
      loadNotificationCount();
    }
  };

  // Real-time notifications via Server-Sent Events (auto-reconnect on error)
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      // Get fresh token on every connect attempt so expired tokens are not reused
      const url = getNotificationStreamUrl();
      if (!url) return;
      es = new EventSource(url);
      es.onmessage = (event) => {
        if (event.data === 'refresh') {
          loadNotificationCount();
          if (notificationsOpenRef.current) loadNotifications();
          showToastForLatestNotification();
          // Proven realtime channel — let pages refresh derived data (e.g. Lists assignment overlay)
          // even when Socket.io is degraded/offline.
          window.dispatchEvent(new Event('notifications:refresh'));
        }
      };
      es.onerror = () => {
        es?.close();
        // Reconnect after 3 seconds with a fresh token
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [loadNotificationCount, loadNotifications, showToastForLatestNotification]);

  // When tab becomes visible, refresh count (e.g. if SSE disconnected after token expiry)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadNotificationCount();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [loadNotificationCount]);

  const handleNotificationClick = async (n: ApiNotification) => {
    // Optimistic update: mark as read in UI immediately
    const wasUnread = !n.readAt;
    if (wasUnread) {
      const readAt = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt } : x))
      );
      // Optimistically decrement badge count using store's current value
      const current = useStore.getState().unreadNotificationsCount;
      setUnreadNotificationsCount(Math.max(0, current - 1));
    }
    if (n.link) {
      let target = notifLink(n) ?? n.link;
      // If this notification belongs to a linked user, carry their userId into the
      // navigation so the destination page activates the correct user filter context.
      if (n.isOwn === false && n.sourceUserId && target) {
        const [path, qs] = target.split('?');
        const params = new URLSearchParams(qs ?? '');
        params.set('linkedUserId', n.sourceUserId);
        target = `${path}?${params.toString()}`;
      }
      navigate(target);
      setNotificationsOpen(false);
    }
    // Mark read on server, then sync the real count
    if (!n.isReminder && n.id && wasUnread) {
      try {
        await markNotificationRead(n.id);
        await loadNotificationCount();
      } catch {
        // ignore
      }
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    const now = new Date().toISOString();
    try {
      if (activeNotifTab === 'all') {
        await markAllNotificationsRead();
        setNotifications((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? now })));
      } else {
        const unread = notifications.filter((n) => n.sourceUserId === activeNotifTab && !n.readAt && !n.isReminder);
        await Promise.all(unread.map((n) => markNotificationRead(n.id).catch(() => {})));
        setNotifications((prev) =>
          prev.map((x) => (x.sourceUserId === activeNotifTab ? { ...x, readAt: x.readAt ?? now } : x))
        );
      }
      await loadNotificationCount();
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleBugReportClick = useCallback(async () => {
    setCapturingScreenshot(true);
    try {
      const { dataUrl } = await captureScreenWithFallback();
      setBugScreenshot(dataUrl);
      setBugReportOpen(true);
    } catch {
      setBugScreenshot(null);
      setBugReportOpen(true);
    } finally {
      setCapturingScreenshot(false);
    }
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(BREAK_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { breakType?: string; startTime?: string };
      if (!parsed.breakType || !parsed.startTime) return;
      const start = new Date(parsed.startTime);
      if (Number.isNaN(start.getTime())) {
        sessionStorage.removeItem(BREAK_STORAGE_KEY);
        return;
      }
      setIsOnBreak(true);
      setCurrentBreakType(parsed.breakType);
      setBreakStartTime(start);
      setBreakDuration(Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000)));
    } catch {
      sessionStorage.removeItem(BREAK_STORAGE_KEY);
    }
  }, [setIsOnBreak]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isOnBreak && breakStartTime) {
      interval = setInterval(() => {
        setBreakDuration((d) => Math.floor((Date.now() - breakStartTime.getTime()) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isOnBreak, breakStartTime]);

  const startBreak = (breakType: string) => {
    const now = new Date();
    setIsOnBreak(true);
    setCurrentBreakType(breakType);
    setBreakStartTime(now);
    setBreakDuration(0);
    sessionStorage.setItem(
      BREAK_STORAGE_KEY,
      JSON.stringify({
        breakType,
        startTime: now.toISOString(),
      })
    );
  };

  const endBreak = async () => {
    if (breakStartTime && currentBreakType) {
      const durationSeconds = Math.max(0, Math.floor((Date.now() - breakStartTime.getTime()) / 1000));
      if (durationSeconds > 0 && (currentBreakType === 'coaching' || currentBreakType === 'meeting')) {
        try {
          await logBreak(currentBreakType, durationSeconds, breakStartTime.toISOString());
        } catch (err) {
          console.error('Failed to log break:', err);
        }
      }
    }
    setIsOnBreak(false);
    setCurrentBreakType(null);
    setBreakStartTime(null);
    setBreakDuration(0);
    sessionStorage.removeItem(BREAK_STORAGE_KEY);
  };

  const formatBreakTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentBreakInfo = breakTypes.find((b) => b.id === currentBreakType);


  const initials = displayUser ? displayUser.name.split(' ').map((n) => n[0]).join('').toUpperCase() || '?' : '…';
  const canSwitchCompany = useCanViewGlobalScope();
  const canSubmitBugReport = useCanSubmitBugReports();
  const accountAgency =
    displayUser?.subCompanyId != null ? subCompanies.find((sc) => sc.id === displayUser.subCompanyId) : undefined;
  const accountAgencyLabel =
    accountAgency && displayUser
      ? showCompanyLogoInAppChrome()
        ? companyBrandingName(accountAgency)
        : agencyRecordName(accountAgency)
      : '';

  return (
    <header className="h-16 border-b border-border bg-card px-6 flex items-center justify-between">
      <div className="flex items-center gap-4 flex-1 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clients, leads..."
            className="pl-9 bg-background"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {isOnBreak ? (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            {currentBreakInfo && (
              <>
                <currentBreakInfo.icon className={cn('h-4 w-4', currentBreakInfo.color)} />
                <span className="text-sm font-medium text-amber-800">{currentBreakInfo.label}</span>
              </>
            )}
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber-100 rounded">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-sm font-mono font-bold text-amber-700">{formatBreakTime(breakDuration)}</span>
            </div>
            <Button size="sm" variant="destructive" onClick={endBreak} className="gap-1.5 h-7 text-xs">
              <Play className="h-3.5 w-3.5" />
              End
            </Button>
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Pause className="h-4 w-4" />
                Start Break
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {breakTypes.map((breakType) => (
                <DropdownMenuItem
                  key={breakType.id}
                  onClick={() => startBreak(breakType.id)}
                  className="gap-3 cursor-pointer"
                >
                  <breakType.icon className={cn('h-4 w-4', breakType.color)} />
                  <span>{breakType.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}


        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setDailyActivityOpen(true)}
          title={`Daily Agenda — ${todayActivityCount > 0 ? `${todayActivityCount} to do today` : 'nothing due today'}`}
          aria-label={`Daily Agenda${todayActivityCount > 0 ? `, ${todayActivityCount} to do today` : ''}`}
        >
          <ListChecks className="h-5 w-5" />
          {todayActivityCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center px-1 text-xs"
            >
              {todayActivityCount > 99 ? '99+' : todayActivityCount}
            </Badge>
          )}
        </Button>

        {canSubmitBugReport && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBugReportClick}
            disabled={capturingScreenshot}
            title="Report a bug"
          >
            {capturingScreenshot ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Bug className="h-5 w-5" />
            )}
          </Button>
        )}
        <DropdownMenu open={notificationsOpen} onOpenChange={handleNotificationsOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadNotificationsCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96 bg-popover max-h-[85vh] flex flex-col p-0 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="font-semibold text-sm">Notifications</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs shrink-0 text-primary hover:text-primary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleMarkAllRead();
                }}
                disabled={markingAllRead || !filteredNotifications.some((n) => !n.readAt && !n.isReminder)}
              >
                {markingAllRead ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCheck className="h-3.5 w-3.5 mr-1" />}
                Mark all as read
              </Button>
            </div>

            {/* Tabs — scrollable, no wrap */}
            {linkedUsersInNotifs.length > 0 && (
              <div className="flex border-b border-border shrink-0 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
                {/* All tab */}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveNotifTab('all'); }}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0',
                    activeNotifTab === 'all'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  All
                  {notifications.filter((n) => !n.readAt && !n.isReminder).length > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: '#6366F1' }}>
                      {notifications.filter((n) => !n.readAt && !n.isReminder).length}
                    </span>
                  )}
                </button>

                {/* Own tab */}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveNotifTab(displayUser?.id ?? 'self'); }}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0',
                    activeNotifTab === (displayUser?.id ?? 'self')
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ background: SELF_COLOR }}>
                    {displayUser ? displayUser.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() : 'Me'}
                  </span>
                  {displayUser?.name.split(' ')[0] ?? 'Me'}
                  {notifications.filter((n) => n.isOwn && !n.readAt && !n.isReminder).length > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: SELF_COLOR }}>
                      {notifications.filter((n) => n.isOwn && !n.readAt && !n.isReminder).length}
                    </span>
                  )}
                </button>

                {/* Linked user tabs */}
                {linkedUsersInNotifs.map((u) => {
                  const unreadCount = notifications.filter((n) => n.sourceUserId === u.userId && !n.readAt && !n.isReminder).length;
                  const tabInitials = `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
                  return (
                    <button
                      key={u.userId}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveNotifTab(u.userId); }}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0',
                        activeNotifTab === u.userId
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ background: u.color }}>
                        {tabInitials}
                      </span>
                      {u.firstName}
                      {unreadCount > 0 && (
                        <span className="min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: u.color }}>
                          {unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Notification list */}
            <div className="overflow-y-auto" style={{ maxHeight: '55vh' }}>
              {notificationsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No notifications
                </div>
              ) : (
                <div className="py-1">
                  {filteredNotifications.map((n) => {
                    const color = n.isOwn ? SELF_COLOR : (colorByUserId.get(n.sourceUserId) ?? '#EA580C');
                    const initials2 = n.isOwn
                      ? (displayUser?.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() ?? 'Me')
                      : `${n.sourceFirstName?.[0] ?? ''}${n.sourceLastName?.[0] ?? ''}`.toUpperCase();
                    return (
                      <DropdownMenuItem
                        key={n.id}
                        className={cn(
                          'flex items-start gap-3 px-3 py-3 cursor-pointer rounded-none border-b border-border/50 last:border-0 [&[data-highlighted]_*]:!text-white',
                          !n.readAt && !n.isReminder && 'bg-primary/5'
                        )}
                        style={!n.readAt && !n.isReminder ? { borderLeft: `3px solid ${color}` } : { borderLeft: '3px solid transparent' }}
                        onClick={() => handleNotificationClick(n)}
                      >
                        {/* Colored avatar */}
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                          style={{ background: color, opacity: n.readAt ? 0.5 : 1 }}
                        >
                          {initials2}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Agency label — only in All tab for linked (non-own) notifications */}
                          {activeNotifTab === 'all' && !n.isOwn && (
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                              <span className="text-[10px] font-semibold" style={{ color }}>
                                {n.isOwn
                                  ? `${n.sourceFirstName} · ${n.sourceAgencyName}`
                                  : `${n.sourceFirstName} ${n.sourceLastName} · ${n.sourceAgencyName}`}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between gap-2 items-start">
                            <span className={cn('text-sm leading-snug', !n.readAt && !n.isReminder ? 'font-semibold' : 'font-medium text-muted-foreground')}>
                              {n.title}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                              {format(new Date(n.createdAt), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</span>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <DailyActivityModal
          open={dailyActivityOpen}
          onOpenChange={setDailyActivityOpen}
          onTodayCountChange={setTodayActivityCount}
        />

        <BugReportDialog
          open={bugReportOpen}
          onOpenChange={setBugReportOpen}
          screenshotDataUrl={bugScreenshot}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start text-left">
                <span className="text-sm font-medium">{displayUser ? displayUser.name : 'Loading…'}</span>
                <span className="text-xs text-muted-foreground">
                  {displayUser ? displayRoleTitle : '—'}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover">
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="opacity-100">
              <div className="flex flex-col">
                <span className="font-medium">{displayUser ? displayUser.name : 'Loading…'}</span>
                <span className="text-xs text-muted-foreground">
                  {displayUser ? displayRoleTitle : '—'}
                  {accountAgencyLabel ? <> · {accountAgencyLabel}</> : null}
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive cursor-pointer"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
