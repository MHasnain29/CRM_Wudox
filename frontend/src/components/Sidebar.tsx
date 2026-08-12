import { NavLink } from 'react-router-dom';
import { SwitchAgencyDropdown } from './SwitchAgencyDropdown';
import { AgentAvailabilityControl } from './phone-system/AgentAvailabilityControl';
import { useCallback, useEffect, useState } from 'react';
import { useCanReviewProposals, useCanViewTeamScope } from '@/lib/access';
import {
  LayoutDashboard,
  Building2,
  UserCircle,
  Phone,
  CalendarClock,
  Calendar,
  CheckSquare,
  MessageSquare,
  BarChart3,
  Settings,
  Mail,
  GitBranch,
  List,
  Users,
  UserCircle2,
  FileCheck,
  Calculator,
  FileText,
  Briefcase,
  Shield,
  Bug,
  Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { WorkspaceSwitcher, useActiveSide, groupNavItemsBySide } from '@/workspaces';
import { fetchProposals, fetchTasks, fetchFollowUps, fetchLeadRequests, getPendingLeadReassignmentRequests, mapApiTaskToTask, mapApiFollowUpToFollowUp } from '@/lib/api';
import { getSocket, onProposalRefresh, onTaskRefresh, onFollowUpRefresh, onLeadRefresh, onReassignmentRefresh } from '@/lib/socket';
import {
  agencyRecordName,
  companyBrandingName,
  showCompanyLogoInAppChrome,
  resolveAgencyLogoSrc,
} from '@/lib/branding';

/** Shown when user has at least one workspace module (not only org/admin keys). */
const DASHBOARD_PERMISSIONS = [
  'clients:read', 'analytics:read', 'leads:read', 'pipeline:read', 'tasks:read', 'calls:read',
  'meetings:read', 'jobs:read', 'employees:read', 'users:directory', 'settings:read',
  'proposals:read', 'proposals:write', 'proposals:review',
] as const;

/** Nav items: hidden entirely when user lacks required permission(s). */
const navItems: { to: string; icon: typeof LayoutDashboard; label: string; managerLabel?: string; permissions?: string[]; showCount?: boolean }[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', permissions: [...DASHBOARD_PERMISSIONS] },
  { to: '/clients', icon: Building2, label: 'Clients', permissions: ['clients:read'] },
  { to: '/leads', icon: UserCircle, label: 'My Leads', managerLabel: 'Leads', permissions: ['leads:read'], showCount: true },
  { to: '/proposals', icon: FileCheck, label: 'Proposals', permissions: ['proposals:read', 'proposals:write', 'proposals:review'], showCount: true },
  { to: '/pipeline', icon: GitBranch, label: 'Pipeline', permissions: ['pipeline:read'] },
  { to: '/lists', icon: List, label: 'Lists', permissions: ['leads:read'] },
  { to: '/tasks', icon: CheckSquare, label: 'My Tasks', managerLabel: 'Tasks', permissions: ['tasks:read'], showCount: true },
  { to: '/follow-ups', icon: CalendarClock, label: 'My Follow-Ups', managerLabel: 'Follow Ups', permissions: ['tasks:read'], showCount: true },
  { to: '/messages', icon: MessageSquare, label: 'Messages', permissions: ['users:read'], showCount: true },
  { to: '/emails', icon: Mail, label: 'Emails', permissions: ['calls:read'], showCount: true },
  { to: '/bulk-emails', icon: Mail, label: 'Bulk Emails', permissions: ['calls:read'] },
  { to: '/calls', icon: Phone, label: 'Calls', permissions: ['calls:read'] },
  { to: '/meetings', icon: Calendar, label: 'Meetings', permissions: ['meetings:read'] },
  { to: '/documents', icon: FileText, label: 'Documents', permissions: ['proposals:read', 'proposals:write', 'proposals:review'] },
  { to: '/active-clients', icon: Building2, label: 'Active Clients', permissions: ['jobs:read'] },
  { to: '/jobs', icon: Briefcase, label: 'Jobs', permissions: ['jobs:read'] },
  { to: '/employees', icon: UserCircle2, label: 'Employees', permissions: ['employees:read'] },
  { to: '/employee-job-matches', icon: Link2, label: 'Job Matches', permissions: ['employees:read'] },
  { to: '/calculators', icon: Calculator, label: 'Calculators', permissions: ['leads:read'] },
  { to: '/users', icon: Users, label: 'Users', permissions: ['users:directory'] },
  { to: '/super-users', icon: Shield, label: 'Super Users', permissions: ['agencies:global', 'agencies:cross_org'] },
  { to: '/bug-reports', icon: Bug, label: 'Bug Reports', permissions: ['bug_reports:read'] },
  { to: '/reports', icon: BarChart3, label: 'Reports', permissions: ['analytics:read'] },
  { to: '/settings', icon: Settings, label: 'Settings', permissions: ['settings:read'] },
];

export function Sidebar() {
  const { currentUser, currentSubCompany, tasks, setTasks, followUps, setFollowUps, unreadMessagesCount, unreadEmailsCount, pendingProposalsCount, setPendingProposalsCount, cwpProposalsCount, setCwpProposalsCount, pendingReassignmentsCount, setPendingReassignmentsCount } = useStore();
  const permissions = useAuthStore((s) => s.permissions);
  const [pendingLeadRequestsCount, setPendingLeadRequestsCount] = useState(0);

  const isManager = useCanViewTeamScope();
  const canReviewProposals = useCanReviewProposals();
  const agencyId = currentSubCompany?.id ?? currentUser?.subCompanyId;

  const hasAny = (perms: string[] | undefined) =>
    !perms || perms.length === 0 || perms.some((p) => permissions.includes(p));
  const myTasksCount = tasks.filter(t => t.ownerId === currentUser.id && t.status !== 'done').length;
  const myFollowUpsCount = followUps.filter(f => f.ownerId === currentUser.id && !f.completed).length;

  // Fetch tasks and follow-ups on mount so sidebar counts are populated before visiting those pages
  useEffect(() => {
    if (!agencyId) return;
    fetchTasks({ subCompanyId: agencyId, limit: 500 })
      .then(({ data }) => setTasks(data.map(mapApiTaskToTask)))
      .catch(() => {/* silently ignore */});
    fetchFollowUps({ subCompanyId: agencyId, limit: 500 })
      .then(({ data }) => setFollowUps(data.map(mapApiFollowUpToFollowUp)))
      .catch(() => {/* silently ignore */});
  }, [agencyId, setTasks, setFollowUps]);

  // Auto-update counts via socket when tasks or follow-ups change
  useEffect(() => {
    if (!agencyId) return;
    const unsubTask = onTaskRefresh(() => {
      fetchTasks({ subCompanyId: agencyId, limit: 500 })
        .then(({ data }) => setTasks(data.map(mapApiTaskToTask)))
        .catch(() => {/* silently ignore */});
    });
    const unsubFollowUp = onFollowUpRefresh(() => {
      fetchFollowUps({ subCompanyId: agencyId, limit: 500 })
        .then(({ data }) => setFollowUps(data.map(mapApiFollowUpToFollowUp)))
        .catch(() => {/* silently ignore */});
    });
    return () => { unsubTask(); unsubFollowUp(); };
  }, [agencyId, setTasks, setFollowUps]);

  // Fetch pending lead requests count for current user
  const fetchPendingLeadRequests = useCallback(() => {
    if (!agencyId || !currentUser?.id) return;
    fetchLeadRequests({ status: 'pending', subCompanyId: agencyId })
      .then((requests) => setPendingLeadRequestsCount(requests.filter(r => r.requestedBy === currentUser.id).length))
      .catch(() => {/* silently ignore */});
  }, [agencyId, currentUser?.id]);

  useEffect(() => { fetchPendingLeadRequests(); }, [fetchPendingLeadRequests]);

  useEffect(() => {
    const unsub = onLeadRefresh(() => fetchPendingLeadRequests());
    return () => { unsub(); };
  }, [fetchPendingLeadRequests]);

  // Fetch pending lead reassignment approvals — permission-gated, not role-gated.
  const canApproveReassignments = permissions.includes('leads:reassign_approve');
  useEffect(() => {
    if (!canApproveReassignments) return;
    getPendingLeadReassignmentRequests()
      .then((list) => setPendingReassignmentsCount(list.length))
      .catch(() => {/* silently ignore */});
  }, [canApproveReassignments, setPendingReassignmentsCount]);

  useEffect(() => {
    if (!canApproveReassignments) return;
    const unsub = onReassignmentRefresh(() => {
      getPendingLeadReassignmentRequests()
        .then((list) => setPendingReassignmentsCount(list.length))
        .catch(() => {/* silently ignore */});
    });
    return () => { unsub(); };
  }, [canApproveReassignments, setPendingReassignmentsCount]);

  // Fetch pending proposals count for reviewers
  useEffect(() => {
    if (!canReviewProposals) return;
    fetchProposals({ status: 'pending', limit: 1 })
      .then((res) => setPendingProposalsCount(res.total))
      .catch(() => {/* silently ignore */});
  }, [canReviewProposals, setPendingProposalsCount]);

  // Update count via socket when a proposal is submitted, approved, or rejected
  useEffect(() => {
    if (!canReviewProposals) return;
    const unsub = onProposalRefresh(() => {
      fetchProposals({ status: 'pending', limit: 1 })
        .then((res) => setPendingProposalsCount(res.total))
        .catch(() => {/* silently ignore */});
    });
    return () => { unsub(); };
  }, [canReviewProposals, setPendingProposalsCount]);

  // Fetch closed-won-pending (activation pending) proposals count (proposal module access)
  const canAccessProposalsNav = permissions.some((p) =>
    p === 'proposals:read' || p === 'proposals:write' || p === 'proposals:review',
  );
  useEffect(() => {
    if (!canAccessProposalsNav) return;
    fetchProposals({ pendingActivation: true, limit: 1 })
      .then((res) => setCwpProposalsCount(res.total))
      .catch(() => {/* silently ignore */});
  }, [canAccessProposalsNav, setCwpProposalsCount]);

  // Update CWP count via socket
  useEffect(() => {
    if (!canAccessProposalsNav) return;
    const unsub = onProposalRefresh(() => {
      fetchProposals({ pendingActivation: true, limit: 1 })
        .then((res) => setCwpProposalsCount(res.total))
        .catch(() => {/* silently ignore */});
    });
    return () => { unsub(); };
  }, [setCwpProposalsCount]);

  const { side: activeSide, canSwitch: canSwitchSides } = useActiveSide();
  const visibleNavItems = navItems.filter((item) => hasAny(item.permissions));
  const navSections = groupNavItemsBySide(visibleNavItems, activeSide, canSwitchSides);
  
  const companyChrome = showCompanyLogoInAppChrome();
  const brandTitle = companyChrome
    ? companyBrandingName(currentSubCompany)
    : agencyRecordName(currentSubCompany);
  const agencyImg = resolveAgencyLogoSrc(currentSubCompany?.agencyLogoUrl, currentSubCompany?.id ?? '');
  const showAgencyLogo = !companyChrome && Boolean(agencyImg);
  const showCompanyLogo = companyChrome && Boolean(currentSubCompany?.logoUrl?.trim());
  const showBrandBlock = showAgencyLogo || showCompanyLogo || Boolean(brandTitle);

  const renderNavItem = (item: (typeof navItems)[number]) => {
    let badgeCount = 0;

    if (item.showCount) {
      if (item.to === '/leads') badgeCount = pendingLeadRequestsCount + (canApproveReassignments ? pendingReassignmentsCount : 0);
      if (item.to === '/tasks') badgeCount = myTasksCount;
      if (item.to === '/follow-ups') badgeCount = myFollowUpsCount;
      if (item.to === '/messages') badgeCount = unreadMessagesCount;
      if (item.to === '/emails') badgeCount = unreadEmailsCount;
      if (item.to === '/proposals') badgeCount = (isManager ? pendingProposalsCount : 0) + cwpProposalsCount;
    }

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
          )
        }
      >
        <item.icon className="h-5 w-5" />
        <span className="flex-1">{(isManager && item.managerLabel) ? item.managerLabel : item.label}</span>
        {item.showCount && badgeCount > 0 && (
          <Badge variant="destructive" className="h-5 px-1.5 text-xs">
            {badgeCount}
          </Badge>
        )}
      </NavLink>
    );
  };

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <div className={cn('flex items-center gap-2', !showBrandBlock && 'min-h-[2.5rem]')}>
          {showAgencyLogo && agencyImg ? (
            <img
              src={agencyImg}
              alt=""
              className="h-9 w-auto max-w-[120px] object-contain shrink-0"
            />
          ) : null}
          {showCompanyLogo && currentSubCompany?.logoUrl ? (
            <img
              src={currentSubCompany.logoUrl}
              alt=""
              className="h-9 w-auto max-w-[120px] object-contain shrink-0"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            {brandTitle ? (
              <h1 className="text-sm font-bold text-sidebar-foreground leading-tight tracking-tight break-words uppercase">
                {brandTitle}
              </h1>
            ) : null}
          </div>
        </div>
      </div>
      
      <nav className="px-3 py-4 flex-1 overflow-y-auto">
        <WorkspaceSwitcher />
        <div className="space-y-3">
          {navSections.map((section) =>
            section.secondary ? (
              <Collapsible key={section.key}>
                <CollapsibleTrigger className="flex w-full items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 hover:text-sidebar-foreground/70 [&[data-state=open]>svg]:rotate-180">
                  {section.label}
                  <ChevronDown className="h-3 w-3 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1">
                  {section.items.map(renderNavItem)}
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div key={section.key} className="space-y-1">
                {section.label && (
                  <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                    {section.label}
                  </p>
                )}
                {section.items.map(renderNavItem)}
              </div>
            ),
          )}
        </div>
      </nav>

      <div className="px-3 pb-2 border-t border-sidebar-border pt-2">
        <SwitchAgencyDropdown />
      </div>

      <div className="px-3 py-2.5 border-t border-sidebar-border flex items-center gap-2">
        <AgentAvailabilityControl compact />
        <p className="text-[10px] text-sidebar-foreground/30 shrink-0 tabular-nums">v{__APP_VERSION__}</p>
      </div>
    </aside>
  );
}
