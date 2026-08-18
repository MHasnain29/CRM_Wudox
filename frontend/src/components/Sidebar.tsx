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
  FolderKanban,
  CalendarOff,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { useAuthStore } from '@/lib/authStore';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { WorkspaceSwitcher, useActiveSide, groupNavItemsBySide } from '@/workspaces';
import { apiFetch, fetchProposals, fetchTasks, fetchFollowUps, fetchLeadRequests, getPendingLeadReassignmentRequests, mapApiTaskToTask, mapApiFollowUpToFollowUp } from '@/lib/api';
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

const SOFTWARE_HOUSE_ROLES = new Set([
  'cto', 'project_manager', 'team_lead',
  'developer', 'qa_engineer', 'ui_ux_designer',
  'business_analyst', 'devops_engineer',
  'hr', 'finance',
]);

/** Nav items: hidden entirely when user lacks required permission(s). */
const navItems: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  managerLabel?: string;
  permissions?: string[];
  showCount?: boolean;
  excludeRoles?: Set<string>;
  section?: string;
  color: string;
}[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', permissions: [...DASHBOARD_PERMISSIONS], color: '#6366f1' },

  // ── Software Team ──
  { to: '/projects',   icon: FolderKanban, label: 'Projects',    permissions: ['projects:read'], section: 'Software Team', color: '#7c3aed' },
  { to: '/tasks',      icon: CheckSquare,  label: 'My Tasks', managerLabel: 'Tasks', permissions: ['tasks:read'], showCount: true, color: '#f59e0b' },
  { to: '/leave',      icon: CalendarOff,  label: 'My Leave',    permissions: ['leave:read'], excludeRoles: new Set(['super_admin', 'director', 'company_director']), color: '#0d9488' },
  { to: '/leave/admin',icon: CalendarOff,  label: 'Leave Admin', permissions: ['leave:approve'], showCount: true, color: '#0d9488' },
  { to: '/attendance', icon: Clock,        label: 'Attendance',  permissions: ['calls:read'], color: '#6366f1' },

  // ── Sales & Marketing ──
  { to: '/clients',    icon: Building2,    label: 'Clients',     permissions: ['clients:read'],  section: 'Sales & Marketing', color: '#2563eb' },
  { to: '/leads',      icon: UserCircle,   label: 'My Leads', managerLabel: 'Leads', permissions: ['leads:read'], showCount: true, color: '#16a34a' },
  { to: '/proposals',  icon: FileCheck,    label: 'Proposals',   permissions: ['proposals:read', 'proposals:write', 'proposals:review'], showCount: true, color: '#ea580c' },
  { to: '/pipeline',   icon: GitBranch,    label: 'Pipeline',    permissions: ['pipeline:read'], color: '#9333ea' },
  { to: '/follow-ups', icon: CalendarClock,label: 'My Follow-Ups', managerLabel: 'Follow Ups', permissions: ['tasks:read'], showCount: true, excludeRoles: SOFTWARE_HOUSE_ROLES, color: '#db2777' },

  // ── Recruitment ──
  { to: '/active-clients',      icon: Building2,  label: 'Active Clients', permissions: ['jobs:read'],       section: 'Recruitment', color: '#2563eb' },
  { to: '/jobs',                icon: Briefcase,  label: 'Jobs',           permissions: ['jobs:read'],        color: '#0891b2' },
  { to: '/employees',           icon: UserCircle2,label: 'Employees',      permissions: ['employees:read'],   color: '#7c3aed' },
  { to: '/employee-job-matches',icon: Link2,      label: 'Job Matches',    permissions: ['employees:read'],   color: '#0d9488' },

  // ── Communication ──
  { to: '/messages',    icon: MessageSquare, label: 'Messages',    permissions: ['users:read'],  showCount: true, section: 'Communication', color: '#0284c7' },
  { to: '/emails',      icon: Mail,          label: 'Emails',      permissions: ['calls:read'],  showCount: true, color: '#2563eb' },
  { to: '/bulk-emails', icon: Mail,          label: 'Bulk Emails', permissions: ['calls:read'], excludeRoles: SOFTWARE_HOUSE_ROLES, color: '#2563eb' },
  { to: '/lists',       icon: List,          label: 'Lists',       excludeRoles: SOFTWARE_HOUSE_ROLES, color: '#64748b' },
  { to: '/calls',       icon: Phone,         label: 'Calls',       permissions: ['calls:read'],  excludeRoles: SOFTWARE_HOUSE_ROLES, color: '#16a34a' },
  { to: '/meetings',    icon: Calendar,      label: 'Meetings',    permissions: ['meetings:read'], color: '#9333ea' },
  { to: '/documents',   icon: FileText,      label: 'Documents',   permissions: ['proposals:read', 'proposals:write', 'proposals:review'], color: '#64748b' },

  // ── Admin ──
  { to: '/users',       icon: Users,     label: 'Users',       permissions: ['users:directory'],                       section: 'Settings', color: '#6366f1' },
  { to: '/super-users', icon: Shield,    label: 'Super Users', permissions: ['agencies:global', 'agencies:cross_org'], color: '#dc2626' },
  { to: '/calculators', icon: Calculator,label: 'Calculators', permissions: ['leads:read'],                            color: '#f59e0b' },
  { to: '/bug-reports', icon: Bug,       label: 'Bug Reports', permissions: ['bug_reports:read'],                      color: '#dc2626' },
  { to: '/reports',     icon: BarChart3, label: 'Reports',     permissions: ['analytics:read'],                        color: '#0d9488' },
  { to: '/settings',    icon: Settings,  label: 'Settings',    permissions: ['settings:read'],                         color: '#64748b' },
];

export function Sidebar() {
  const { currentUser, currentSubCompany, tasks, setTasks, followUps, setFollowUps, unreadMessagesCount, unreadEmailsCount, pendingProposalsCount, setPendingProposalsCount, cwpProposalsCount, setCwpProposalsCount, pendingReassignmentsCount, setPendingReassignmentsCount } = useStore();
  const permissions = useAuthStore((s) => s.permissions);
  const userRole = useAuthStore((s) => s.user?.role ?? '');
  const [pendingLeadRequestsCount, setPendingLeadRequestsCount] = useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);

  const isManager = useCanViewTeamScope();
  const canReviewProposals = useCanReviewProposals();
  const agencyId = currentSubCompany?.id ?? currentUser?.subCompanyId;

  const hasAny = (perms: string[] | undefined) =>
    !perms || perms.length === 0 || perms.some((p) => permissions.includes(p));
  const myTasksCount = tasks.filter(t => t.ownerId === currentUser.id && t.status !== 'done').length;
  const myFollowUpsCount = followUps.filter(f => f.ownerId === currentUser.id && !f.completed).length;

  const hasLeadsRead = permissions.includes('leads:read');

  // Fetch tasks and follow-ups on mount so sidebar counts are populated before visiting those pages
  useEffect(() => {
    if (!agencyId) return;
    fetchTasks({ subCompanyId: agencyId, limit: 500 })
      .then(({ data }) => setTasks(data.map(mapApiTaskToTask)))
      .catch(() => {/* silently ignore */});
    if (hasLeadsRead) {
      fetchFollowUps({ subCompanyId: agencyId, limit: 500 })
        .then(({ data }) => setFollowUps(data.map(mapApiFollowUpToFollowUp)))
        .catch(() => {/* silently ignore */});
    }
  }, [agencyId, hasLeadsRead, setTasks, setFollowUps]);

  // Auto-update counts via socket when tasks or follow-ups change
  useEffect(() => {
    if (!agencyId) return;
    const unsubTask = onTaskRefresh(() => {
      fetchTasks({ subCompanyId: agencyId, limit: 500 })
        .then(({ data }) => setTasks(data.map(mapApiTaskToTask)))
        .catch(() => {/* silently ignore */});
    });
    const unsubFollowUp = hasLeadsRead ? onFollowUpRefresh(() => {
      fetchFollowUps({ subCompanyId: agencyId, limit: 500 })
        .then(({ data }) => setFollowUps(data.map(mapApiFollowUpToFollowUp)))
        .catch(() => {/* silently ignore */});
    }) : () => {};
    return () => { unsubTask(); unsubFollowUp(); };
  }, [agencyId, hasLeadsRead, setTasks, setFollowUps]);

  // Fetch pending lead requests count for current user
  const fetchPendingLeadRequests = useCallback(() => {
    if (!agencyId || !currentUser?.id || !hasLeadsRead) return;
    fetchLeadRequests({ status: 'pending', subCompanyId: agencyId })
      .then((requests) => setPendingLeadRequestsCount(requests.filter(r => r.requestedBy === currentUser.id).length))
      .catch(() => {/* silently ignore */});
  }, [agencyId, currentUser?.id, hasLeadsRead]);

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

  // Fetch pending leave requests count for approvers
  const canApproveLeave = permissions.includes('leave:approve');
  useEffect(() => {
    if (!canApproveLeave) return;
    apiFetch<{ data: { id: string }[] }>('/leave/requests?status=pending')
      .then((res) => {
        const list = (res.data as any).data ?? res.data ?? [];
        setPendingLeaveCount(Array.isArray(list) ? list.length : 0);
      })
      .catch(() => {/* silently ignore */});
  }, [canApproveLeave]);

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
  const visibleNavItems = navItems.filter(
    (item) => hasAny(item.permissions) && !item.excludeRoles?.has(userRole)
  );
  const navSections = groupNavItemsBySide(visibleNavItems, activeSide, canSwitchSides);
  
  const companyChrome = showCompanyLogoInAppChrome();
  const brandTitle = companyChrome
    ? companyBrandingName(currentSubCompany)
    : agencyRecordName(currentSubCompany);
  const agencyImg = resolveAgencyLogoSrc(currentSubCompany?.agencyLogoUrl, currentSubCompany?.id ?? '');
  const showAgencyLogo = !companyChrome && Boolean(agencyImg);
  const showCompanyLogo = companyChrome && Boolean(currentSubCompany?.logoUrl?.trim());
  const showBrandBlock = showAgencyLogo || showCompanyLogo || Boolean(brandTitle);

  const renderNavGroup = (items: (typeof navItems)[number][]) => {
    const groups: { label?: string; items: (typeof navItems)[number][] }[] = [];
    let currentLabel: string | undefined;
    let currentGroup: (typeof navItems)[number][] = [];

    for (const item of items) {
      if (item.section !== undefined && item.section !== currentLabel) {
        if (currentGroup.length > 0) groups.push({ label: currentLabel, items: currentGroup });
        currentLabel = item.section;
        currentGroup = [item];
      } else {
        currentGroup.push(item);
      }
    }
    if (currentGroup.length > 0) groups.push({ label: currentLabel, items: currentGroup });

    return groups.map((group, i) => (
      <div key={group.label ?? `s${i}`} className={cn('space-y-0.5', i > 0 && 'mt-3')}>
        {group.items.map(renderNavItem)}
      </div>
    ));
  };

  const renderNavItem = (item: (typeof navItems)[number]) => {
    let badgeCount = 0;

    if (item.showCount) {
      if (item.to === '/leads') badgeCount = pendingLeadRequestsCount + (canApproveReassignments ? pendingReassignmentsCount : 0);
      if (item.to === '/tasks') badgeCount = myTasksCount;
      if (item.to === '/follow-ups') badgeCount = myFollowUpsCount;
      if (item.to === '/messages') badgeCount = unreadMessagesCount;
      if (item.to === '/emails') badgeCount = unreadEmailsCount;
      if (item.to === '/proposals') badgeCount = (isManager ? pendingProposalsCount : 0) + cwpProposalsCount;
      if (item.to === '/leave/admin') badgeCount = pendingLeaveCount;
    }

    const label = (isManager && item.managerLabel) ? item.managerLabel : item.label;

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/' || item.to === '/leave'}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-[13px] leading-none transition-all duration-150 select-none',
            isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm'
              : 'font-medium text-sidebar-foreground/55 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
          )
        }
      >
        {({ isActive }) => (
          <>
            <span
              className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
              style={{ backgroundColor: isActive ? `${item.color}28` : `${item.color}14` }}
            >
              <item.icon
                className="h-[14px] w-[14px] transition-opacity"
                style={{ color: item.color, opacity: isActive ? 1 : 0.65 }}
              />
            </span>
            <span className="flex-1 truncate">{label}</span>
            {item.showCount && badgeCount > 0 && (
              <Badge variant="destructive" className="h-[18px] min-w-[18px] px-1 text-[10px] font-bold rounded-full">
                {badgeCount}
              </Badge>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <aside className="w-64 bg-sidebar flex flex-col border-r border-sidebar-border/60 shadow-[2px_0_12px_-4px_rgba(0,0,0,0.08)]">
      {/* Brand header */}
      <div className="px-5 py-4 border-b border-sidebar-border/60 bg-gradient-to-b from-sidebar-accent/10 to-transparent">
        <div className={cn('flex items-center gap-2.5', !showBrandBlock && 'min-h-[2.25rem]')}>
          {showAgencyLogo && agencyImg ? (
            <img
              src={agencyImg}
              alt=""
              className="h-8 w-auto max-w-[110px] object-contain shrink-0 drop-shadow-sm"
            />
          ) : null}
          {showCompanyLogo && currentSubCompany?.logoUrl ? (
            <img
              src={currentSubCompany.logoUrl}
              alt=""
              className="h-8 w-auto max-w-[110px] object-contain shrink-0 drop-shadow-sm"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            {brandTitle ? (
              <h1 className="text-[11px] font-bold text-sidebar-foreground leading-tight tracking-[0.08em] break-words uppercase">
                {brandTitle}
              </h1>
            ) : null}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-2 py-3 flex-1 overflow-y-auto">
        <WorkspaceSwitcher />
        <div className="space-y-0.5">
          {navSections.map((section) => {
            // Collapsed group for the non-active workspace (non-switchable users)
            if (section.secondary) {
              return (
                <Collapsible key={section.key} className="mt-2">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-medium text-sidebar-foreground/35 hover:text-sidebar-foreground/60 hover:bg-sidebar-accent/30 transition-all duration-150 [&[data-state=open]>svg]:rotate-180 select-none">
                    <span className="flex-1 truncate text-left">{section.label}</span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 shrink-0" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-0.5 pt-1">
                    {renderNavGroup(section.items)}
                  </CollapsibleContent>
                </Collapsible>
              );
            }

            const isWorkspace = section.key === 'marketing' || section.key === 'recruitment';
            const isShared = section.key === 'shared';

            // Workspace section → always flat list, no labels regardless of tab visibility
            if (isWorkspace) {
              return (
                <div key={section.key} className="space-y-0.5">
                  {section.items.map(renderNavItem)}
                </div>
              );
            }

            // Shared section → spacing only
            if (isShared) {
              return (
                <div key={section.key} className="mt-3">
                  {renderNavGroup(section.items)}
                </div>
              );
            }

            // Default (single-workspace, no tabs) → flat list with dividers between sub-groups
            return (
              <div key={section.key}>
                {renderNavGroup(section.items)}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-2 pt-2 pb-1 border-t border-sidebar-border/60">
        <SwitchAgencyDropdown />
      </div>

      <div className="px-3 py-2 border-t border-sidebar-border/60 flex items-center gap-2">
        <AgentAvailabilityControl compact />
        <p className="text-[9.5px] text-sidebar-foreground/30 shrink-0 tabular-nums ml-auto">v{__APP_VERSION__}</p>
      </div>
    </aside>
  );
}
