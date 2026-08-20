import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAgencyIndependentRole } from '@/lib/agencyIndependentRoles';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { fetchSubCompanies, fetchUnreadMessagesCount, fetchNotificationUnreadCount } from '@/lib/api';
import { onMessageNew, onConversationRead, onTaskAssigned, onTaskRefresh, onProposalRefresh, onCallRefresh, onMeetingRefresh, onFollowUpRefresh, onLeadRefresh } from '@/lib/socket';
import { showTaskAssignedToast } from '@/lib/taskToast';
import { TOKEN_KEY, SELECTED_AGENCY_KEY } from '@/lib/sessionKeys';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Hydrates auth from localStorage, tries to load /auth/me and sync currentUser + current agency (sub-company).
 * Loads sub-companies list so the header agency switcher and settings have real data.
 * Redirects to /login if unauthenticated, or to / if on /login and authenticated.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  const { hydrate, loadSession, hydrated } = useAuthStore();
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const setCurrentSubCompany = useStore((s) => s.setCurrentSubCompany);
  const setSubCompanies = useStore((s) => s.setSubCompanies);
  const setUnreadMessagesCount = useStore((s) => s.setUnreadMessagesCount);
  const setUnreadEmailsCount = useStore((s) => s.setUnreadEmailsCount);
  const setUnreadNotificationsCount = useStore((s) => s.setUnreadNotificationsCount);
  const triggerTasksRefresh = useStore((s) => s.triggerTasksRefresh);
  const triggerProposalsRefresh = useStore((s) => s.triggerProposalsRefresh);
  const triggerReportsRefresh = useStore((s) => s.triggerReportsRefresh);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Run session load only once after hydrate — not on every route change (was causing many duplicate /auth/me + /users/sub-companies requests).
  useEffect(() => {
    if (!hydrated) return;

    const run = async () => {
      const isPublicAuthPage =
        location.pathname === '/login' ||
        location.pathname === '/forgot-password' ||
        location.pathname === '/reset-password';
      if (isPublicAuthPage) {
        setChecking(false);
        return;
      }
      const hasToken = !!localStorage.getItem(TOKEN_KEY);
      if (!hasToken) {
        setChecking(false);
        return;
      }
      const ok = await loadSession(
        (user) => setCurrentUser(user),
        (sub) => setCurrentSubCompany(sub)
      );
      if (ok) {
        try {
          const list = await fetchSubCompanies();
          const subs = list.map((s) => ({
            id: s.id,
            name: s.name,
            mainOrgId: s.mainOrgId,
            appProjectName: s.appProjectName ?? null,
            logoUrl: s.logoUrl ?? null,
            agencyLogoUrl: s.agencyLogoUrl ?? null,
            agencyEmail: s.agencyEmail ?? null,
            agencyPhone: s.agencyPhone ?? null,
            emailFooterText: s.emailFooterText ?? null,
            emailTagline: s.emailTagline ?? null,
            emailSendAsDomain: s.emailSendAsDomain ?? null,
          }));
          setSubCompanies(subs);
          const authUser = useAuthStore.getState().user;
          const isOrgWideRole = isAgencyIndependentRole(authUser?.role);
          if (isOrgWideRole) {
            localStorage.removeItem(SELECTED_AGENCY_KEY);
          } else {
            const current = useStore.getState().currentSubCompany;
            const storedId = typeof localStorage !== 'undefined' ? localStorage.getItem(SELECTED_AGENCY_KEY) : null;
            const match = storedId ? subs.find((s) => s.id === storedId) : null;
            if (match) {
              setCurrentSubCompany(match);
            } else if (!current?.id || !subs.some((s) => s.id === current.id)) {
              if (subs.length > 0) setCurrentSubCompany(subs[0]);
            }
          }
          const [unread, notifCount] = await Promise.all([
            fetchUnreadMessagesCount(),
            fetchNotificationUnreadCount(),
          ]);
          setUnreadMessagesCount(unread);
          setUnreadNotificationsCount(notifCount);
        } catch {
          // keep existing subCompanies if fetch fails
        }
      }
      setChecking(false);
    };

    run();
    // Intentionally omit location.pathname — session/sub-companies load once; redirect logic below uses current location.
  }, [hydrated, loadSession, setCurrentUser, setCurrentSubCompany, setSubCompanies, setUnreadMessagesCount, setUnreadEmailsCount, setUnreadNotificationsCount]);

  // Real-time: refresh messages unread count when a new message or read receipt is received (so sidebar bubble updates on any page)
  useEffect(() => {
    const unsubMessage = onMessageNew(() => {
      fetchUnreadMessagesCount().then(setUnreadMessagesCount).catch(() => {});
    });
    const unsubRead = onConversationRead(() => {
      fetchUnreadMessagesCount().then(setUnreadMessagesCount).catch(() => {});
    });
    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [setUnreadMessagesCount]);

  // Real-time: show persistent priority-coloured toast + trigger task list refresh when a task is assigned
  useEffect(() => {
    const unsubAssigned = onTaskAssigned((payload) => {
      showTaskAssignedToast(payload);
      triggerTasksRefresh();
      triggerReportsRefresh();
    });
    const unsubRefresh = onTaskRefresh(() => {
      triggerTasksRefresh();
      triggerReportsRefresh();
    });
    return () => {
      unsubAssigned();
      unsubRefresh();
    };
  }, [triggerTasksRefresh, triggerReportsRefresh]);

  // Real-time: trigger proposals list refresh when a proposal is submitted/approved/rejected
  useEffect(() => {
    const unsubProposalRefresh = onProposalRefresh(() => {
      triggerProposalsRefresh();
    });
    return () => {
      unsubProposalRefresh();
    };
  }, [triggerProposalsRefresh]);

  // Real-time: trigger reports refresh when calls, meetings, follow-ups, or leads change
  useEffect(() => {
    const unsubCall = onCallRefresh(() => triggerReportsRefresh());
    const unsubMeeting = onMeetingRefresh(() => triggerReportsRefresh());
    const unsubFollowUp = onFollowUpRefresh(() => triggerReportsRefresh());
    const unsubLead = onLeadRefresh(() => triggerReportsRefresh());
    return () => {
      unsubCall();
      unsubMeeting();
      unsubFollowUp();
      unsubLead();
    };
  }, [triggerReportsRefresh]);

  if (!hydrated || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isPublicAuthPage =
    location.pathname === '/login' ||
    location.pathname === '/forgot-password' ||
    location.pathname === '/reset-password';
  const hasToken = !!localStorage.getItem(TOKEN_KEY);

  if (isPublicAuthPage && hasToken && location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }
  if (!isPublicAuthPage && !hasToken) {
    return <Navigate to={{ pathname: '/login', search: location.search }} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
