/**
 * Dynamic access helpers — permissions and data scope from auth (RBAC), not hardcoded role names.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from './authStore';
import { isAgencyIndependentRole } from './agencyIndependentRoles';
import { getWorkflowMetadata } from './approvalMetadataStore';
import { fetchDatabaseManagerImportConfig, type ApprovalWorkflowType } from './api';

export type DataScopeLevel = 'own' | 'team' | 'agency' | 'global';

export function getDataScopeLevel(): DataScopeLevel {
  return useAuthStore.getState().dataScopeLevel ?? 'own';
}

export function getPermissions(): string[] {
  return useAuthStore.getState().permissions;
}

export function hasPermission(permission: string): boolean {
  const role = useAuthStore.getState().user?.role;
  if (role === 'super_admin') return true;
  return getPermissions().includes(permission);
}

export function isOwnScope(): boolean {
  return getDataScopeLevel() === 'own';
}

export function canViewTeamScope(): boolean {
  const level = getDataScopeLevel();
  return level === 'team' || level === 'agency' || level === 'global';
}

export function canViewAgencyScope(): boolean {
  const level = getDataScopeLevel();
  return level === 'agency' || level === 'global';
}

export function canViewGlobalScope(): boolean {
  return getDataScopeLevel() === 'global';
}

/** Cross-agency picker / org-wide filters (requires cross-org or global permission). */
export function canAccessMultipleAgencies(): boolean {
  return (
    hasPermission('agencies:cross_org') ||
    hasPermission('agencies:global')
  );
}

export function canActOnLeads(): boolean {
  return hasPermission('leads:write') || hasPermission('leads:assign');
}

/** Settings → Users admin page (/users). */
export function canAccessUsersDirectory(): boolean {
  return hasPermission('users:directory');
}

/** View user list / hierarchy on the Users page (users:read). */
export function canViewUsersList(): boolean {
  return hasPermission('users:read');
}

export function canWriteUsers(): boolean {
  return hasPermission('users:write');
}

/** Deactivate/reactivate users (users:delete, or legacy users:write). */
export function canDeleteUsers(): boolean {
  return hasPermission('users:delete') || hasPermission('users:write');
}

/** Pipeline kanban page — requires pipeline:read (not implied by leads:read or agency scope). */
export function canViewPipeline(): boolean {
  return hasPermission('pipeline:read');
}

/** Move leads on the pipeline board (pipeline:write or legacy leads:write). */
export function canMovePipelineLeads(): boolean {
  return hasPermission('pipeline:write') || hasPermission('leads:write');
}

/** Settings → Pipeline tab: stage configuration (pipeline:configure). */
export function canConfigurePipeline(): boolean {
  return hasPermission('pipeline:configure');
}

export function useCanConfigurePipeline(): boolean {
  return useAuthStore((s) => s.permissions.includes('pipeline:configure'));
}

export function useDataScopeLevel(): DataScopeLevel {
  return useAuthStore((s) => s.dataScopeLevel ?? 'own');
}

export function usePermissions(): string[] {
  return useAuthStore((s) => s.permissions);
}

export function useHasPermission(permission: string): boolean {
  return useAuthStore((s) => {
    if (s.user?.role === 'super_admin') return true;
    return s.permissions.includes(permission);
  });
}

export function useCanMovePipelineLeads(): boolean {
  const permissions = usePermissions();
  return permissions.includes('pipeline:write') || permissions.includes('leads:write');
}

export function useCanViewPipeline(): boolean {
  return useHasPermission('pipeline:read');
}

export function useCanWriteProposals(): boolean {
  return useHasPermission('proposals:write');
}

export function useCanAccessUsersDirectory(): boolean {
  return useHasPermission('users:directory');
}

export function useCanViewUsersList(): boolean {
  return useHasPermission('users:read');
}

export function useCanWriteUsers(): boolean {
  return useHasPermission('users:write');
}

export function useCanDeleteUsers(): boolean {
  const permissions = usePermissions();
  return permissions.includes('users:delete') || permissions.includes('users:write');
}

export function useCanAccessMultipleAgencies(): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return (
    permissions.includes('agencies:cross_org') ||
    permissions.includes('agencies:global')
  );
}

export function useCanViewTeamScope(): boolean {
  const scope = useDataScopeLevel();
  return scope === 'team' || scope === 'agency' || scope === 'global';
}

export function useCanViewAgencyScope(): boolean {
  const scope = useDataScopeLevel();
  return scope === 'agency' || scope === 'global';
}

export function useCanViewGlobalScope(): boolean {
  return useDataScopeLevel() === 'global';
}

export function useIsOwnScope(): boolean {
  return useDataScopeLevel() === 'own';
}

export function useCanActOnLeads(): boolean {
  const permissions = usePermissions();
  return permissions.includes('leads:write') || permissions.includes('leads:assign');
}

/**
 * Elevated + agency-scoped: director, operations_manager, custom director-like roles.
 * Excludes super_admin (global scope) so the agency picker makes sense for them.
 */
export function useIsAgencyScopedElevated(): boolean {
  const elevated = useCanAccessMultipleAgencies();
  const isGlobal = useCanViewGlobalScope();
  return elevated && !isGlobal;
}

/** Single-agency lead (e.g. company_director) — full agency filters without cross-org picker. */
export function useIsSingleAgencyLead(): boolean {
  const scope = useDataScopeLevel();
  const elevated = useCanAccessMultipleAgencies();
  const role = useAuthStore((s) => s.user?.role);
  if (isAgencyIndependentRole(role)) return false;
  return (scope === 'agency' || scope === 'global') && !elevated;
}

/** Show agency → leader → manager → user filter rows. */
export function useShowHierarchyFilters(): boolean {
  const multiAgency = useCanAccessMultipleAgencies();
  const singleAgencyLead = useIsSingleAgencyLead();
  return multiAgency || singleAgencyLead;
}

/** Team scope without cross-agency picker (sales/recruitment managers only). */
export function useIsTeamManagerOnly(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const multiAgency = useCanAccessMultipleAgencies();
  const scope = useDataScopeLevel();
  const teamScope = useCanViewTeamScope();
  if (isAgencyIndependentRole(role)) return false;
  if (multiAgency) return false;
  if (scope === 'agency' || scope === 'global') return false;
  return teamScope;
}

export function useCanManageCallScripts(): boolean {
  const permissions = usePermissions();
  const team = useCanViewTeamScope();
  return permissions.includes('settings:write') || (permissions.includes('settings:read') && team);
}

export function useCanManageAgencies(): boolean {
  return useHasPermission('agencies:global');
}

export function useCanApproveClients(): boolean {
  return useHasPermission('clients:approve');
}

/**
 * Team-scope managers (e.g. sales_manager) recommend only — not final approvers in UI.
 * Custom agency/global roles with clients:approve are not team-manager-only.
 */
export function isTeamManagerOnlyScope(): boolean {
  const scope = getDataScopeLevel();
  if (scope === 'agency' || scope === 'global') return false;
  return canViewTeamScope() && !canAccessMultipleAgencies();
}

/** Final approve pending add/edit (permission + scope; works for custom director/global roles). */
export function canFinalApprovePendingClients(): boolean {
  return hasPermission('clients:approve') && !isTeamManagerOnlyScope();
}

/** Org-wide global database queue — only roles on the Settings → Global Database route. */
const GLOBAL_DATABASE_APPROVER_ROLE_KEYS = new Set(['super_admin', 'director', 'operations_manager']);

export function canApproveGlobalDatabasePending(): boolean {
  const role = useAuthStore.getState().user?.role;
  if (!role || !GLOBAL_DATABASE_APPROVER_ROLE_KEYS.has(role)) return false;
  if (role === 'operations_manager') {
    return hasPermission('clients:manager_recommend');
  }
  return canFinalApprovePendingClients();
}

/** Manager pre-approve step — any role with clients:manager_recommend (system or custom). */
export function canManagerRecommendPendingClients(): boolean {
  return hasPermission('clients:manager_recommend');
}

/** Pending queue tab/API visibility. */
export function canViewPendingClientQueue(): boolean {
  return hasPermission('clients:approve') || hasPermission('clients:manager_recommend');
}

export function useCanFinalApprovePendingClients(): boolean {
  const canApprove = useHasPermission('clients:approve');
  const teamManagerOnly = useIsTeamManagerOnly();
  return canApprove && !teamManagerOnly;
}

export function useCanApproveGlobalDatabasePending(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const canFinal = useCanFinalApprovePendingClients();
  const canRecommend = useHasPermission('clients:manager_recommend');
  if (!role || !GLOBAL_DATABASE_APPROVER_ROLE_KEYS.has(role)) return false;
  if (role === 'operations_manager') return canRecommend;
  return canFinal;
}

export function useCanManagerRecommendPendingClients(): boolean {
  return useHasPermission('clients:manager_recommend');
}

export function useCanViewPendingClientQueue(): boolean {
  const permissions = usePermissions();
  return permissions.includes('clients:approve') || permissions.includes('clients:manager_recommend');
}

export function useCanReviewProposals(): boolean {
  return useHasPermission('proposals:review');
}

export type ApprovalWorkflowKey = ApprovalWorkflowType;

function finalPermissionsForWorkflow(workflow: ApprovalWorkflowKey): string[] {
  const meta = getWorkflowMetadata(workflow);
  if (!meta) return [];
  const perms = [meta.finalPermission];
  if (meta.finalPermissionFallback) perms.push(meta.finalPermissionFallback);
  return perms;
}

export function canForwardApproval(workflow: ApprovalWorkflowKey): boolean {
  const meta = getWorkflowMetadata(workflow);
  if (!meta) return false;
  return hasPermission(meta.forwardPermission);
}

export function canFinalApprove(workflow: ApprovalWorkflowKey): boolean {
  if (workflow.startsWith('client_') && isTeamManagerOnlyScope()) return false;
  const perms = finalPermissionsForWorkflow(workflow);
  return perms.some((p) => hasPermission(p));
}

export function canViewApprovalQueue(workflow: ApprovalWorkflowKey): boolean {
  return canForwardApproval(workflow) || canFinalApprove(workflow);
}

/** Any proposal module access (view, submit, or review). */
export function canAccessProposals(): boolean {
  return (
    hasPermission('proposals:read') ||
    hasPermission('proposals:write') ||
    hasPermission('proposals:review')
  );
}

export function canWriteClients(): boolean {
  return hasPermission('clients:write');
}

export function canDeleteClients(): boolean {
  return hasPermission('clients:delete') || hasPermission('clients:write');
}

export function canManagerRecommendClients(): boolean {
  return hasPermission('clients:manager_recommend');
}

export function canWriteTasks(): boolean {
  return hasPermission('tasks:write');
}

export function canWriteMeetings(): boolean {
  return hasPermission('meetings:write');
}

export function canAddMeetingParticipants(): boolean {
  return hasPermission('meetings:add_participants');
}

export function canViewCalls(): boolean {
  return hasPermission('calls:read');
}

export function canWriteCalls(): boolean {
  return hasPermission('calls:write');
}

export function canUseVoice(): boolean {
  return hasPermission('voice:use');
}

export function useCanAccessProposals(): boolean {
  const permissions = usePermissions();
  return (
    permissions.includes('proposals:read') ||
    permissions.includes('proposals:write') ||
    permissions.includes('proposals:review')
  );
}

export function useCanWriteClients(): boolean {
  return useHasPermission('clients:write');
}

export function useCanDeleteClients(): boolean {
  const permissions = usePermissions();
  return permissions.includes('clients:delete') || permissions.includes('clients:write');
}

export function useCanWriteTasks(): boolean {
  return useHasPermission('tasks:write');
}

export function useCanWriteMeetings(): boolean {
  return useHasPermission('meetings:write');
}

export function useCanAddMeetingParticipants(): boolean {
  return useHasPermission('meetings:add_participants');
}

export function useCanViewCalls(): boolean {
  return useHasPermission('calls:read');
}

export function useCanWriteCalls(): boolean {
  return useHasPermission('calls:write');
}

export function useCanUseVoice(): boolean {
  return useHasPermission('voice:use');
}

/** Header "Report a bug" button and POST /bug-reports. */
export function canSubmitBugReports(): boolean {
  return hasPermission('bug_reports:submit');
}

/** Sidebar Bug Reports page and list/close API. */
export function canViewBugReports(): boolean {
  return hasPermission('bug_reports:read');
}

export function useCanSubmitBugReports(): boolean {
  return useHasPermission('bug_reports:submit');
}

export function useCanViewBugReports(): boolean {
  return useHasPermission('bug_reports:read');
}

export function useCanConfigureAgencySignature(): boolean {
  return useHasPermission('email:configure_signature');
}

export function useCanConfigurePersonalSignature(): boolean {
  return useHasPermission('email:personal_signature');
}

/** Unlocks agency sales / ops modules beyond global-database client work. */
export const AGENCY_WORKSPACE_PERMISSIONS = [
  'leads:read',
  'pipeline:read',
  'calls:read',
  'tasks:read',
  'meetings:read',
  'proposals:read',
  'employees:read',
  'jobs:read',
  'users:directory',
  'settings:read',
] as const;

export function useHasAgencyWorkspacePermissions(): boolean {
  const permissions = usePermissions();
  return AGENCY_WORKSPACE_PERMISSIONS.some((p) => permissions.includes(p));
}

export type DatabaseManagerDestinationMode = 'global' | 'agency' | 'both';

/** Org setting: Settings → Approvals → Global Database → Database Manager destination. */
export function useDatabaseManagerDestinationMode(): DatabaseManagerDestinationMode | null {
  const role = useAuthStore((s) => s.user?.role);
  const { data } = useQuery({
    queryKey: ['client-destination-config', role],
    queryFn: fetchDatabaseManagerImportConfig,
    enabled: role === 'database_manager',
    staleTime: 60 * 1000,
  });
  if (role !== 'database_manager') return null;
  return data?.destination ?? 'global';
}

/** True when org policy allows agency uploads/adds (agency-only or both). */
export function useDatabaseManagerAgencyPathEnabled(): boolean {
  const mode = useDatabaseManagerDestinationMode();
  return mode === 'agency' || mode === 'both';
}

/** True for the Database Manager system role (org-global client DB). */
export function useIsDatabaseManagerRole(): boolean {
  return useAuthStore((s) => s.user?.role) === 'database_manager';
}

/** True for Recruitment Manager (team-scope recruitment dashboard). */
export function useIsRecruitmentManagerRole(): boolean {
  return useAuthStore((s) => s.user?.role) === 'recruitment_manager';
}

/** True for Senior Recruiter (exact role). */
export function useIsSeniorRecruiterRole(): boolean {
  return useAuthStore((s) => s.user?.role) === 'sr_recruiter';
}

/** True for Recruiter (exact role; does not include sr_recruiter). */
export function useIsRecruiterRole(): boolean {
  return useAuthStore((s) => s.user?.role) === 'recruiter';
}

/**
 * Simplified Clients UX for Database Manager on default global-DB permissions only.
 * When extra module permissions are granted in Settings → Roles, or org policy enables agency path
 * (Settings → Approvals → Global Database), Clients uses the agency-aware UI instead.
 * Dashboard and Reports always use the Database Manager views via {@link useIsDatabaseManagerRole}.
 */
export function useIsGlobalDatabaseWorkspace(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const hasAgencyWorkspace = useHasAgencyWorkspacePermissions();
  const agencyPathEnabled = useDatabaseManagerAgencyPathEnabled();
  if (role !== 'database_manager') return false;
  if (hasAgencyWorkspace || agencyPathEnabled) return false;
  return true;
}

/** Productivity report for global database managers (oversight roles use elevated path). */
export function useCanViewDatabaseManagerReport(): boolean {
  const hasAnalytics = useHasPermission('analytics:read');
  const role = useAuthStore((s) => s.user?.role);
  const elevated = useCanAccessMultipleAgencies();
  if (role === 'database_manager') return true;
  if (!hasAnalytics) return false;
  if (elevated) return true;
  if (role === 'operations_manager') return true;
  return false;
}
