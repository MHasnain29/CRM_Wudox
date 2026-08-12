import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/lib/store';
import { User, Location } from '@/lib/types';
import { COUNTRY_LIST, type Country } from '@/lib/countries';
import type { ApiUser, SuperUserRow } from '@/lib/api';
import { fetchUsers, fetchUserHierarchy, fetchSubCompanies, fetchLocations, createUser, updateUser, adminSetUserPassword, adminSendUserResetEmail, fetchPerformanceTargets, syncDefaultTargets, fetchAllowedEmailDomains, fetchSuperUsers, fetchAccessibleAgencies, createLocation, updateLocation, deleteLocation, initiateOffboarding, cancelOffboarding, fetchInProgressUsers, fetchPastUsers, fetchOffboardingHistory } from '@/lib/api';
import type { InProgressUserItem, PastUserItem, OffboardingHistoryEntry } from '@/lib/api';
import { UserHierarchyTree, UserHierarchyAgencySections } from '@/components/UserHierarchyTree';
import { StickyHeader } from '@/components/StickyHeader';
import { onTargetsRefresh } from '@/lib/socket';
import { ROLE_OPTIONS, ALL_LOCATION_ACCESS_ROLES, ASSOCIATE_LEVEL_ROLES } from '@/lib/roleOptions';
import { formatUserAgencyLabel, isAgencyIndependentRole } from '@/lib/agencyIndependentRoles';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import {
  filterRolesForActor,
  getRoleLabel,
  isOwnScopeRoleKey,
  isTeamScopeRoleKey,
} from '@/lib/roleLabels';
import {
  useCanAccessMultipleAgencies,
  useCanDeleteUsers,
  useCanViewAgencyScope,
  useCanViewGlobalScope,
  useCanViewUsersList,
  useCanWriteUsers,
  useIsTeamManagerOnly,
  useHasPermission,
} from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Search, MoreHorizontal, Pencil, Trash2, UserCheck, Users as UsersIcon, Target, MapPin, Building2, RefreshCw, Copy, KeyRound, Mail, GitBranch, LogOut, PhoneIncoming } from 'lucide-react';
import { InboundCallsTab } from '@/components/phone-system/InboundCallsTab';
import { OffboardingWizard } from '@/components/offboarding/OffboardingWizard';
import { OffboardingHistorySheet } from '@/components/offboarding/OffboardingHistorySheet';
import { UserDetailSheet, type OffboardingUserDetail, type PastUserDetail } from '@/components/offboarding/UserDetailSheet';
import { toast } from 'sonner';
import { format } from 'date-fns';

const countries = COUNTRY_LIST;

function formatTenure(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (months < 1) return 'Less than 1 month';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (rem > 0) parts.push(`${rem} month${rem !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

function buildStepsFromLog(log: OffboardingHistoryEntry): import('@/components/offboarding/UserDetailSheet').OffboardingStep[] {
  const counts = log.totalCounts;
  const recipients = log.recipients ?? [];

  const recipientNames = (key: keyof typeof counts): { name: string; count: number }[] =>
    recipients
      .filter((r) => (r as Record<string, number>)[key] > 0)
      .map((r) => ({ name: `${r.firstName} ${r.lastName}`, count: (r as Record<string, number>)[key] }));

  return [
    { key: 'email',     label: 'Emails',      status: counts.emailCount     > 0 ? 'done' : 'skipped', assignees: recipientNames('emailCount') },
    { key: 'clients',   label: 'Won Clients', status: counts.clientCount    > 0 ? 'done' : 'skipped', assignees: recipientNames('clientCount') },
    { key: 'pipeline',  label: 'Pipeline',    status: counts.pipelineCount  > 0 ? 'done' : 'skipped', assignees: recipientNames('pipelineCount') },
    { key: 'leads',     label: 'Leads',       status: counts.leadCount      > 0 ? 'done' : 'skipped', assignees: recipientNames('leadCount') },
    { key: 'tasks',     label: 'Tasks',       status: counts.taskCount      > 0 ? 'done' : 'skipped', assignees: recipientNames('taskCount') },
    { key: 'meetings',  label: 'Meetings',    status: counts.meetingCount   > 0 ? 'done' : 'skipped', assignees: recipientNames('meetingCount') },
    { key: 'followups', label: 'Follow-Ups',  status: counts.followUpCount  > 0 ? 'done' : 'skipped', assignees: recipientNames('followUpCount') },
  ];
}

const DEFAULT_WORK_START = '09:00';
const DEFAULT_WORK_END = '17:00';

const PASSWORD_HINT = 'Min 8 characters, at least one uppercase, one lowercase, one number, and one special character (!@#$%^&*).';

/** Generate a random password meeting: 8+ chars, uppercase, lowercase, number, special. */
function generateSecurePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;
  const pick = (s: string, n: number) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  const base = pick(upper, 1) + pick(lower, 1) + pick(digits, 1) + pick(special, 1) + pick(all, 8);
  return base
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

function validatePassword(pwd: string): { ok: boolean; message: string } {
  if (!pwd || pwd.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  if (!/[A-Z]/.test(pwd)) return { ok: false, message: 'Password must contain at least one uppercase letter' };
  if (!/[a-z]/.test(pwd)) return { ok: false, message: 'Password must contain at least one lowercase letter' };
  if (!/\d/.test(pwd)) return { ok: false, message: 'Password must contain at least one number' };
  if (!/[!@#$%^&*]/.test(pwd)) return { ok: false, message: 'Password must contain at least one special character (!@#$%^&*)' };
  return { ok: true, message: '' };
}

/** Map ApiUser to User-like shape for table and forms */
function apiUserToUser(api: ApiUser): User & { dailyCallsTarget?: number; dailyEmailsTarget?: number } {
  return {
    id: api.id,
    email: api.email,
    firstName: api.firstName,
    lastName: api.lastName,
    name: `${api.firstName} ${api.lastName}`.trim(),
    phone: api.phone ?? '',
    country: api.country as Country,
    userType: api.userType as User['userType'],
    isActive: api.isActive,
    role: api.role as User['role'],
    subCompanyId: api.subCompanyId,
    locationId: api.locationId ?? '',
    reportingManagerIds: api.reportingManagerIds ?? [],
    sendAsEmail: (api as ApiUser & { sendAsEmail?: string | null }).sendAsEmail ?? null,
    sendAsDisabled: (api as ApiUser & { sendAsDisabled?: boolean }).sendAsDisabled ?? false,
    dailyTargets: api.dailyCallsTarget != null
      ? {
          dailyCalls: api.dailyCallsTarget ?? 0,
          dailyEmails: api.dailyEmailsTarget ?? 0,
          dailyMeetingSchedule: api.dailyMeetingScheduleTarget ?? 0,
        }
      : undefined,
  };
}

export default function Users() {
  const currentUser = useStore((s) => s.currentUser);
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const canViewUsersList = useCanViewUsersList();
  const canWriteUsers = useCanWriteUsers();
  const canDeleteUsers = useCanDeleteUsers();
  const canManageUserActions = canWriteUsers || canDeleteUsers;
  const canAccessMultipleAgencies = useCanAccessMultipleAgencies();
  const canViewAgencyScope = useCanViewAgencyScope();
  const canViewGlobalScope = useCanViewGlobalScope();
  const isTeamManagerOnly = useIsTeamManagerOnly();
  const canShowHierarchyToggle = canAccessMultipleAgencies || canViewAgencyScope || isTeamManagerOnly;
  const [showHierarchyView, setShowHierarchyView] = useState(false);
  const canAdminPassword = canWriteUsers && canViewAgencyScope;
  const canOffboard = useHasPermission('employees:offboard');
  const queryClient = useQueryClient();
  const offboardCommittedRef = useRef(false);
  const offboardSavedProgressRef = useRef(false);

  // ── Section tabs: active / offboarding / past ─────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const userTab = (searchParams.get('userTab') ?? 'active') as 'active' | 'offboarding' | 'past';

  // ── Offboarding tab queries ───────────────────────────────────────────────
  const { data: inProgressUsers = [] } = useQuery({
    queryKey: ['offboarding-in-progress'],
    queryFn: fetchInProgressUsers,
    enabled: canOffboard && userTab === 'offboarding',
    staleTime: 0,
  });

  const { data: pastUsers = [] } = useQuery({
    queryKey: ['offboarding-past'],
    queryFn: fetchPastUsers,
    enabled: canOffboard && userTab === 'past',
    staleTime: 0,
  });

  const setUserTab = useCallback((tab: 'active' | 'offboarding' | 'past') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'active') next.delete('userTab'); else next.set('userTab', tab);
      next.delete('agencyId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ── Layer 1 URL tab state ─────────────────────────────────────────────────
  const selectedAgencyId = searchParams.get('agencyId') ?? 'all';

  const setSelectedAgencyId = useCallback((id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === 'all') next.delete('agencyId'); else next.set('agencyId', id);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const { data: accessibleAgencies = [], isLoading: agenciesLoading } = useQuery({
    queryKey: ['accessible-agencies'],
    queryFn: fetchAccessibleAgencies,
    enabled: canAccessMultipleAgencies,
    staleTime: 5 * 60 * 1000,
  });

  const effectiveAgencyId = canAccessMultipleAgencies
    ? (accessibleAgencies.length > 1
        ? (selectedAgencyId !== 'all' ? selectedAgencyId : undefined)
        : (accessibleAgencies[0]?.id ?? currentUser?.subCompanyId))
    : undefined;
  const isAllAgenciesView = canAccessMultipleAgencies && accessibleAgencies.length > 1 && selectedAgencyId === 'all';
  const selectedAgencyName = accessibleAgencies.find(a => a.id === selectedAgencyId)?.name;

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [directors, setDirectors] = useState<SuperUserRow[]>([]);
  const [subCompanies, setSubCompanies] = useState<
    { id: string; name: string; mainOrgId: string; companyDirectorId?: string | null }[]
  >([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [globalAllowedDomains, setGlobalAllowedDomains] = useState<string[]>([]);
  const [defaultTargets, setDefaultTargets] = useState<Record<string, { calls: number; emails: number; meetingSchedule: number }>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isTargetsDialogOpen, setIsTargetsDialogOpen] = useState(false);
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [isSetPasswordDialogOpen, setIsSetPasswordDialogOpen] = useState(false);
  const [setPasswordTargetUser, setSetPasswordTargetUser] = useState<ApiUser | null>(null);
  const [setPasswordNewPassword, setSetPasswordNewPassword] = useState('');
  const [setPasswordConfirm, setSetPasswordConfirm] = useState('');
  const [setPasswordSubmitting, setSetPasswordSubmitting] = useState(false);
  const [selectedUser, setSelectedUser] = useState<(User & { dailyCallsTarget?: number; dailyEmailsTarget?: number }) | null>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [newLocationCountry, setNewLocationCountry] = useState<Country>('Canada');
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [isOffboardingOpen, setIsOffboardingOpen] = useState(false);
  const [offboardingTarget, setOffboardingTarget] = useState<{ id: string; name: string; subCompanyId: string } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; name: string } | null>(null);
  const [incomingCallsUser, setIncomingCallsUser] = useState<{ id: string; firstName: string; lastName: string } | null>(null);
  const [detailSheetUser, setDetailSheetUser] = useState<OffboardingUserDetail | PastUserDetail | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    country: 'Canada' as Country,
    role: 'sales_associate',
    userType: 'Sales Associate',
    isActive: true,
    dailyCalls: 100,
    dailyEmails: 100,
    dailyMeetingSchedule: 0,
    startDate: '',
    probationOverride: false,
    workStartTime: DEFAULT_WORK_START,
    workEndTime: DEFAULT_WORK_END,
    sendAsEmail: '',
    sendAsDisabled: false,
    subCompanyId: '',
    locationId: '',
    accessibleLocationIds: [] as string[],
    reportingManagerIds: [] as string[],
    canActAsAdmin: false,
  });

  const allowedEmailDomains = useMemo(() => {
    const selected = subCompanies.find((s) => s.id === formData.subCompanyId);
    if (selected?.emailSendAsDomain) return [selected.emailSendAsDomain];
    return globalAllowedDomains;
  }, [formData.subCompanyId, subCompanies, globalAllowedDomains]);

  const loadData = async () => {
    if (!canViewUsersList) {
      setUsers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // For elevated users, scope to selected agency (undefined = All Agencies).
      // For non-elevated users, undefined means "use JWT scope" (their home agency).
      const subCompanyId = canAccessMultipleAgencies ? effectiveAgencyId : undefined;
      const [usersList, subList, locList, targetsRes, domains, superUsersList] = await Promise.all([
        fetchUsers({ subCompanyId }),
        fetchSubCompanies(),
        fetchLocations(),
        fetchPerformanceTargets(subCompanyId ? { subCompanyId } : undefined).catch(() => null),
        fetchAllowedEmailDomains(),
        fetchSuperUsers().catch(() => [] as SuperUserRow[]),
      ]);
      setDirectors(superUsersList.filter((u) => u.role === 'director' || u.role === 'company_director'));
      setGlobalAllowedDomains(domains);
      setUsers(usersList);
      setSubCompanies(subList);
      setLocations(locList.map((l) => ({ ...l, isActive: l.isActive ?? true })));
      if (targetsRes) {
        const map: Record<string, { calls: number; emails: number; meetingSchedule: number }> = {};
        for (const row of targetsRes.roles) {
          if (row.target) map[row.role] = { calls: row.target.callsTarget, emails: row.target.emailsTarget, meetingSchedule: row.target.meetingScheduleCountTarget };
        }
        setDefaultTargets(map);

      }
      if (subList.length > 0 && !formData.subCompanyId) setFormData((f) => ({ ...f, subCompanyId: currentSubCompany?.id ?? subList[0].id }));
      if (locList.length > 0 && !formData.locationId) setFormData((f) => ({ ...f, locationId: locList[0].id }));
    } catch (e) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSubCompany?.id, effectiveAgencyId, canViewUsersList]);

  useEffect(() => {
    if (currentUser?.subCompanyId && subCompanies.length > 0 && !formData.subCompanyId) {
      setFormData((f) => ({ ...f, subCompanyId: currentUser.subCompanyId }));
    }
  }, [currentUser?.subCompanyId, subCompanies.length]);

  // Real-time: backend already updated all user records before emitting — just update local state + reload
  useEffect(() => {
    const unsub = onTargetsRefresh((payload) => {
      // For elevated users browsing All Agencies, accept any payload; otherwise must match scope.
      const activeScope = effectiveAgencyId ?? currentUser?.subCompanyId;
      if (!isAllAgenciesView && payload.subCompanyId !== activeScope) return;
      // Update defaults state immediately (affects form pre-fills)
      setDefaultTargets((prev) => ({
        ...prev,
        [payload.role]: {
          calls: payload.target.callsTarget,
          emails: payload.target.emailsTarget,
          meetingSchedule: payload.target.meetingScheduleCountTarget,
        },
      }));
      // Re-fetch users — DB values already updated by backend, table reflects new targets instantly
      const scopedSubCompanyId = canAccessMultipleAgencies ? effectiveAgencyId : currentUser?.subCompanyId;
      fetchUsers({ subCompanyId: scopedSubCompanyId })
        .then(setUsers)
        .catch(() => {});
    });
    return unsub;
  }, [effectiveAgencyId, isAllAgenciesView, currentUser?.subCompanyId, canAccessMultipleAgencies]);

  const usersById = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u]));
    for (const d of directors) {
      if (!map.has(d.id)) {
        map.set(d.id, {
          id: d.id,
          email: d.email,
          firstName: d.firstName,
          lastName: d.lastName,
          role: d.role,
          userType: d.userType,
          subCompanyId: d.subCompanyId,
          isActive: d.isActive,
        } as ApiUser);
      }
    }
    if (currentUser?.id && !map.has(currentUser.id)) {
      map.set(currentUser.id, {
        id: currentUser.id,
        email: currentUser.email,
        firstName: currentUser.firstName,
        lastName: currentUser.lastName,
        role: currentUser.role,
        userType: currentUser.userType ?? currentUser.role,
        subCompanyId: currentUser.subCompanyId,
        isActive: true,
      } as ApiUser);
    }
    return map;
  }, [users, directors, currentUser]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const { data: hierarchyData, isLoading: hierarchyLoading, isError: hierarchyError } = useQuery({
    queryKey: ['users-hierarchy', effectiveAgencyId ?? 'default'],
    queryFn: () =>
      fetchUserHierarchy(
        canAccessMultipleAgencies && effectiveAgencyId ? { subCompanyId: effectiveAgencyId } : undefined,
      ),
    enabled: showHierarchyView && canShowHierarchyToggle && canViewUsersList,
    staleTime: 2 * 60 * 1000,
  });

  const hierarchyAgencySections = useMemo(() => {
    if (!hierarchyData) return [];
    if (hierarchyData.agencies?.length) return hierarchyData.agencies;
    if (hierarchyData.tree?.length && hierarchyData.agency) {
      return [{ id: hierarchyData.agency.id, name: hierarchyData.agency.name, tree: hierarchyData.tree }];
    }
    return [];
  }, [hierarchyData]);

  const filteredUsers = users.filter(
    (user) =>
      !user.offboardingStartedAt &&
      (user.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.lastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.phone?.includes(searchQuery))
  );

  // Pagination (client-side; fetchUsers returns full list)
  const USERS_PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const startIndex = (currentPage - 1) * USERS_PAGE_SIZE;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + USERS_PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, selectedAgencyId]);
  useEffect(() => {
    if (!canShowHierarchyToggle) setShowHierarchyView(false);
  }, [canShowHierarchyToggle]);

  // Subcompany name lookup for the All-Agencies "Agency" column
  const subCompanyNameById = useMemo(
    () => new Map(subCompanies.map(s => [s.id, s.name])),
    [subCompanies],
  );

  const getDefaultsForRole = (role: string) => ({
    dailyCalls: defaultTargets[role]?.calls ?? 100,
    dailyEmails: defaultTargets[role]?.emails ?? 100,
    dailyMeetingSchedule: defaultTargets[role]?.meetingSchedule ?? 0,
  });

  const resetForm = () => {
    const defaults = getDefaultsForRole('sales_associate');
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      phone: '',
      country: 'Canada',
      role: 'sales_associate',
      userType: 'Sales Associate',
      isActive: true,
      dailyCalls: defaults.dailyCalls,
      dailyEmails: defaults.dailyEmails,
      dailyMeetingSchedule: defaults.dailyMeetingSchedule,
      startDate: '',
      probationOverride: false,
      workStartTime: '09:00',
      workEndTime: '17:00',
      sendAsEmail: '',
      sendAsDisabled: false,
      subCompanyId: currentSubCompany?.id ?? subCompanies[0]?.id ?? currentUser?.subCompanyId ?? '',
      locationId: locations[0]?.id || '',
      accessibleLocationIds: [],
      reportingManagerIds: [],
      canActAsAdmin: false,
    });
  };

  const handleAddUser = async () => {
    if (!canWriteUsers) return;
    if (!formData.firstName?.trim() || !formData.lastName?.trim() || !formData.email?.trim()) {
      toast.error('Please fill in first name, last name, and email');
      return;
    }
    const pwdCheck = validatePassword(formData.password);
    if (!pwdCheck.ok) {
      toast.error(pwdCheck.message);
      return;
    }
    if (!formData.phone?.trim()) {
      toast.error('Please enter a phone number');
      return;
    }
    if (!formData.userType?.trim()) {
      toast.error('Please enter a role title');
      return;
    }
    const needsManager = isOwnScopeRoleKey(formData.role, assignableRoles);
    const needsDirector = isTeamScopeRoleKey(formData.role, assignableRoles);
    if ((needsManager && !isTeamManagerOnly) || needsDirector) {
      if (formData.reportingManagerIds.length === 0) {
        toast.error(needsDirector ? 'Please assign a reporting director' : 'Please assign at least one reporting manager');
        return;
      }
    }
    if (!isAgencyIndependentRole(formData.role) && (!formData.subCompanyId || !formData.locationId)) {
      toast.error('Please select sub-company and location');
      return;
    }
    try {
      const managerIds = isTeamManagerOnly && currentUser?.id
        ? Array.from(new Set([...formData.reportingManagerIds, currentUser.id]))
        : formData.reportingManagerIds;
      await createUser({
        email: formData.email.trim(),
        password: formData.password,
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
        country: formData.country,
        role: formData.role,
        userType: formData.userType.trim(),
        subCompanyId: isAgencyIndependentRole(formData.role) ? undefined : formData.subCompanyId,
        locationId: isAgencyIndependentRole(formData.role) ? undefined : formData.locationId,
        reportingManagerIds: managerIds.length > 0 ? managerIds : undefined,
        dailyCallsTarget: isOwnScopeRoleKey(formData.role, assignableRoles) ? formData.dailyCalls : undefined,
        dailyEmailsTarget: isOwnScopeRoleKey(formData.role, assignableRoles) ? formData.dailyEmails : undefined,
        dailyMeetingScheduleTarget: isOwnScopeRoleKey(formData.role, assignableRoles) ? formData.dailyMeetingSchedule : undefined,
        isActive: formData.isActive,
        workStartTime: formData.workStartTime,
        workEndTime: formData.workEndTime,
      });
      toast.success('User created successfully');
      setIsAddDialogOpen(false);
      resetForm();
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create user');
    }
  };

  const handleEditUser = async () => {
    if (!canWriteUsers || !selectedUser) return;
    if (!formData.phone?.trim()) {
      toast.error('Please enter a phone number');
      return;
    }
    if (!formData.userType?.trim()) {
      toast.error('Please enter a role title');
      return;
    }
    if (formData.password) {
      const pwdCheck = validatePassword(formData.password);
      if (!pwdCheck.ok) {
        toast.error(pwdCheck.message);
        return;
      }
    }
    const needsManager = isOwnScopeRoleKey(formData.role, assignableRoles);
    if (needsManager && !isTeamManagerOnly && formData.reportingManagerIds.length === 0) {
      toast.error('Please assign at least one reporting manager');
      return;
    }
    try {
      await updateUser(selectedUser.id, {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        phone: formData.phone.trim(),
        country: formData.country,
        role: formData.role,
        userType: formData.userType.trim(),
        subCompanyId: isAgencyIndependentRole(formData.role) ? undefined : (formData.subCompanyId || undefined),
        locationId: isAgencyIndependentRole(formData.role) ? null : (formData.locationId || null),
        reportingManagerIds: formData.reportingManagerIds,
        dailyCallsTarget: isOwnScopeRoleKey(formData.role, assignableRoles) ? formData.dailyCalls : undefined,
        dailyEmailsTarget: isOwnScopeRoleKey(formData.role, assignableRoles) ? formData.dailyEmails : undefined,
        dailyMeetingScheduleTarget: isOwnScopeRoleKey(formData.role, assignableRoles) ? formData.dailyMeetingSchedule : undefined,
        isActive: formData.isActive,
        workStartTime: formData.workStartTime,
        workEndTime: formData.workEndTime,
        sendAsEmail: formData.sendAsEmail.trim() ? formData.sendAsEmail.trim() : null,
        sendAsDisabled: formData.sendAsDisabled,
        ...(formData.password ? { password: formData.password } : {}),
        ...(currentUser?.role === 'super_admin' ? { canActAsAdmin: formData.canActAsAdmin } : {}),
      });
      toast.success('User updated successfully');
      setIsEditDialogOpen(false);
      setSelectedUser(null);
      resetForm();
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update user');
    }
  };

  const handleConfirmToggleActive = async () => {
    if (!canDeleteUsers || !selectedUser) return;
    const currentlyActive = selectedUser.isActive !== false;
    const nextActive = !currentlyActive;
    try {
      await updateUser(selectedUser.id, { isActive: nextActive });
      toast.success(nextActive ? 'User activated' : 'User deactivated');
      setIsDeleteDialogOpen(false);
      setSelectedUser(null);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update user status');
    }
  };

  const handleUpdateTargets = async () => {
    if (!canWriteUsers || !selectedUser) return;
    try {
      await updateUser(selectedUser.id, {
        dailyCallsTarget: formData.dailyCalls,
        dailyEmailsTarget: formData.dailyEmails,
        dailyMeetingScheduleTarget: formData.dailyMeetingSchedule,
      });
      toast.success('Daily targets updated');
      setIsTargetsDialogOpen(false);
      setSelectedUser(null);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update targets');
    }
  };

  const openEditDialog = (user: ApiUser) => {
    if (!canWriteUsers) return;
    const u = apiUserToUser(user);
    setSelectedUser(u);
    setFormData({
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      email: u.email,
      password: '',
      phone: u.phone || '',
      country: (u.country as Country) || 'Canada',
      role: u.role,
      userType: u.userType,
      isActive: u.isActive ?? true,
      dailyCalls: u.dailyTargets?.dailyCalls ?? 100,
      dailyEmails: u.dailyTargets?.dailyEmails ?? 100,
      dailyMeetingSchedule: u.dailyTargets?.dailyMeetingSchedule ?? 0,
      startDate: u.startDate ? format(new Date(u.startDate), 'yyyy-MM-dd') : '',
      probationOverride: u.probationOverride ?? false,
      workStartTime: user.workStartTime ?? DEFAULT_WORK_START,
      workEndTime: user.workEndTime ?? DEFAULT_WORK_END,
      sendAsEmail: u.sendAsEmail ?? '',
      sendAsDisabled: u.sendAsDisabled ?? false,
      subCompanyId: u.subCompanyId || subCompanies[0]?.id || '',
      locationId: u.locationId || locations[0]?.id || '',
      accessibleLocationIds: u.accessibleLocationIds || [],
      reportingManagerIds: u.reportingManagerIds || [],
      canActAsAdmin: user.canActAsAdmin ?? false,
    });
    setIsEditDialogOpen(true);
  };

  const openToggleActiveDialog = (user: User) => {
    if (!canDeleteUsers) return;
    setSelectedUser(user);
    setIsDeleteDialogOpen(true);
  };

  const openTargetsDialog = (user: User) => {
    if (!canWriteUsers) return;
    setSelectedUser(user);
    const roleDefaults = defaultTargets[user.role];
    setFormData((f) => ({
      ...f,
      dailyCalls: user.dailyTargets?.dailyCalls || roleDefaults?.calls || 100,
      dailyEmails: user.dailyTargets?.dailyEmails || roleDefaults?.emails || 100,
      dailyMeetingSchedule: user.dailyTargets?.dailyMeetingSchedule || roleDefaults?.meetingSchedule || 0,
    }));
    setIsTargetsDialogOpen(true);
  };

  const openSetPasswordDialog = (user: ApiUser) => {
    setSetPasswordTargetUser(user);
    setSetPasswordNewPassword('');
    setSetPasswordConfirm('');
    setIsSetPasswordDialogOpen(true);
  };

  /** Opening a Dialog from a DropdownMenuItem in the same tick can leave clicks ignored (Radix focus/pointer cleanup). */
  const afterDropdownSelect = (fn: () => void) => {
    window.setTimeout(fn, 0);
  };

  const validateAdminPassword = (pwd: string): string | null => {
    if (!pwd || pwd.length < 8) return 'Password must be at least 8 characters';
    if (!/[a-zA-Z]/.test(pwd)) return 'Password must contain at least one letter';
    if (!/\d/.test(pwd)) return 'Password must contain at least one number';
    return null;
  };

  const handleSetPasswordSubmit = async () => {
    if (!setPasswordTargetUser) return;
    const err = validateAdminPassword(setPasswordNewPassword);
    if (err) {
      toast.error(err);
      return;
    }
    if (setPasswordNewPassword !== setPasswordConfirm) {
      toast.error('Passwords do not match');
      return;
    }
    setSetPasswordSubmitting(true);
    try {
      await adminSetUserPassword(setPasswordTargetUser.id, setPasswordNewPassword);
      toast.success('Password updated successfully');
      setIsSetPasswordDialogOpen(false);
      setSetPasswordTargetUser(null);
      setSetPasswordNewPassword('');
      setSetPasswordConfirm('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to set password');
    } finally {
      setSetPasswordSubmitting(false);
    }
  };

  const handleSendResetEmail = async (user: ApiUser) => {
    try {
      await adminSendUserResetEmail(user.id);
      toast.success(`Password reset email sent to ${user.email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send reset email');
    }
  };

  const handleToggleActive = async (user: ApiUser) => {
    if (!canDeleteUsers) return;
    try {
      await updateUser(user.id, { isActive: !user.isActive });
      toast.success(`User ${user.isActive ? 'deactivated' : 'activated'}`);
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const hasDailyTargets = (role: string) => isOwnScopeRoleKey(role, assignableRoles);

  const reloadLocations = async () => {
    const locList = await fetchLocations();
    setLocations(locList.map((l) => ({ ...l, isActive: l.isActive ?? true })));
  };

  const handleAddLocation = async () => {
    if (!newLocationName.trim()) {
      toast.error('Please enter a location name');
      return;
    }
    try {
      await createLocation({ name: newLocationName.trim(), address: newLocationAddress.trim() || undefined, country: newLocationCountry });
      await reloadLocations();
      setNewLocationName('');
      setNewLocationAddress('');
      setNewLocationCountry('Canada');
      toast.success('Location added');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to add location');
    }
  };

  const handleUpdateLocation = async () => {
    if (!editingLocation) return;
    try {
      await updateLocation(editingLocation.id, { name: editingLocation.name, address: editingLocation.address, country: editingLocation.country });
      await reloadLocations();
      setEditingLocation(null);
      toast.success('Location updated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to update location');
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    try {
      await deleteLocation(locationId);
      await reloadLocations();
      setUsers(users.map(u => u.locationId === locationId ? { ...u, locationId: null } : u));
      toast.success('Location deleted');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete location');
    }
  };

  const toggleAccessibleLocation = (locationId: string) => {
    const current = formData.accessibleLocationIds;
    if (current.includes(locationId)) {
      setFormData({
        ...formData,
        accessibleLocationIds: current.filter(id => id !== locationId),
      });
    } else {
      setFormData({
        ...formData,
        accessibleLocationIds: [...current, locationId],
      });
    }
  };

  const toggleReportingManager = (managerId: string) => {
    // Team-scoped actors must always remain in the reporting chain for created/edited users.
    // Backend will also force this, but we avoid UI flicker and accidental unselect.
    if (isTeamManagerOnly && currentUser?.id === managerId) return;
    const current = formData.reportingManagerIds;
    if (current.includes(managerId)) {
      setFormData({
        ...formData,
        reportingManagerIds: current.filter(id => id !== managerId),
      });
    } else {
      setFormData({
        ...formData,
        reportingManagerIds: [...current, managerId],
      });
    }
  };

  const {
    roleOptions: allRoleOptions,
    assignableRoles,
    refetch: refetchAssignableRoles,
  } = useAssignableRoles();
  const selectableRoleOptions = useMemo(
    () => filterRolesForActor(allRoleOptions, currentUser?.role, assignableRoles),
    [allRoleOptions, currentUser?.role, assignableRoles],
  );
  const labelForRole = useCallback(
    (roleKey: string) => getRoleLabel(roleKey, assignableRoles),
    [assignableRoles],
  );

  useEffect(() => {
    if (!isAddDialogOpen && !isEditDialogOpen) return;
    void refetchAssignableRoles();
  }, [isAddDialogOpen, isEditDialogOpen, refetchAssignableRoles]);

  const teamScopeRoleKeys = useMemo(
    () => new Set(assignableRoles.filter((r) => r.scopeLevel === 'team').map((r) => r.key)),
    [assignableRoles],
  );
  const roleScopeByKey = useMemo(
    () => new Map(assignableRoles.map((r) => [r.key, r.scopeLevel])),
    [assignableRoles],
  );
  const scopeRank = useMemo(
    () => ({ own: 0, team: 1, agency: 2, global: 3 } as const),
    [],
  );
  const selectedRoleScope = roleScopeByKey.get(formData.role);

  const getAgencyCompanyDirectorId = useCallback(
    (subCompanyId: string): string | null => {
      const fromSuperUsers =
        directors.find(
          (d) => d.role === 'company_director' && d.isActive && d.subCompanyId === subCompanyId,
        ) ??
        users.find(
          (u) => u.role === 'company_director' && u.isActive && u.subCompanyId === subCompanyId,
        );
      if (fromSuperUsers?.id) return fromSuperUsers.id;
      return subCompanies.find((s) => s.id === subCompanyId)?.companyDirectorId ?? null;
    },
    [directors, users, subCompanies],
  );

  const agencyHasCompanyDirector = useCallback(
    (subCompanyId: string) => Boolean(getAgencyCompanyDirectorId(subCompanyId)),
    [getAgencyCompanyDirectorId],
  );

  const salesManagerMissingCompanyDirector =
    formData.role === 'sales_manager' &&
    !getAgencyCompanyDirectorId(formData.subCompanyId || currentUser?.subCompanyId || '');

  const defaultReportingManagerIdsForRole = useCallback(
    (role: string, subCompanyId: string): string[] => {
      const scope = roleScopeByKey.get(role);
      const isManagerRole = scope === 'team' || isTeamScopeRoleKey(role, assignableRoles);
      if (role === 'sales_manager') {
        const cdId = getAgencyCompanyDirectorId(subCompanyId);
        if (cdId) return [cdId];
        const orgDirector = directors.find((d) => d.role === 'director' && d.isActive);
        if (orgDirector) return [orgDirector.id];
        if (currentUser?.role === 'company_director' && currentUser.subCompanyId === subCompanyId) {
          return [currentUser.id];
        }
        return [];
      }
      if (isManagerRole && currentUser?.role === 'director') {
        return [currentUser.id];
      }
      if (isManagerRole && currentUser?.role === 'company_director') {
        const orgDirector = directors.find((d) => d.role === 'director' && d.isActive);
        return orgDirector ? [orgDirector.id] : [];
      }
      return [];
    },
    [assignableRoles, roleScopeByKey, getAgencyCompanyDirectorId, currentUser, directors],
  );

  const getDefaultManagerForLocation = (locationId: string) => {
    const location = locationById.get(locationId);
    if (!location || !isOwnScopeRoleKey(formData.role, assignableRoles)) return null;
    if (isTeamManagerOnly && currentUser?.id) {
      const self = users.find((u) => u.id === currentUser.id && u.isActive);
      if (self) return self;
    }
    const u = users.find(
      (x) =>
        teamScopeRoleKeys.has(x.role) &&
        x.isActive &&
        x.country === location.country &&
        (x.locationId === locationId || x.accessibleLocationIds?.includes(locationId))
    );
    return u ?? null;
  };

  const showLocationAccess =
    selectedRoleScope === 'team'
    || ['sales_executive', 'operations_manager'].includes(formData.role);
  const isAgencyIndependentFormRole = isAgencyIndependentRole(formData.role);
  const hasAllAccess = ALL_LOCATION_ACCESS_ROLES.includes(formData.role) && !isAgencyIndependentFormRole;
  const requiresManager = selectedRoleScope === 'own' || isOwnScopeRoleKey(formData.role, assignableRoles);
  const requiresDirector = selectedRoleScope === 'team' || isTeamScopeRoleKey(formData.role, assignableRoles);
  const unknownCustomRole = !selectedRoleScope && !ROLE_OPTIONS.some((o) => o.role === formData.role);
  const needsManagerSelection = requiresManager || unknownCustomRole;
  // Fail-open for unknown custom role keys: keep reporting selector visible.
  const canHaveManager = needsManagerSelection || requiresDirector;
  const availableManagers = useMemo(() => {
    const selectedCountry = locationById.get(formData.locationId)?.country || formData.country;
    if (needsManagerSelection) {
      return users.filter(
        (u) => teamScopeRoleKeys.has(u.role) && u.isActive && u.country === selectedCountry,
      );
    }
    if (requiresDirector) {
      // Dynamic RBAC: any agency/global-scope role can act as parent of a team-scope role.
      const elevatedFromUsers = users.filter((u) => {
        const scope = roleScopeByKey.get(u.role);
        if (!scope) return false;
        return u.isActive && scopeRank[scope] >= scopeRank.agency;
      });
      const fromSuperUsers = directors.filter((d) => d.isActive);
      const byId = new Map<string, ApiUser>();
      for (const u of elevatedFromUsers) byId.set(u.id, u);
      for (const d of fromSuperUsers) {
        if (!byId.has(d.id)) byId.set(d.id, d as ApiUser);
      }
      if (currentUser?.id) {
        const ownScope = roleScopeByKey.get(currentUser.role);
        if (ownScope && scopeRank[ownScope] >= scopeRank.agency && !byId.has(currentUser.id)) {
          byId.set(currentUser.id, {
            id: currentUser.id,
            email: currentUser.email,
            firstName: currentUser.firstName,
            lastName: currentUser.lastName,
            role: currentUser.role,
            userType: currentUser.userType ?? currentUser.role,
            subCompanyId: currentUser.subCompanyId,
            isActive: true,
          } as ApiUser);
        }
      }
      let list = Array.from(byId.values());
      if (formData.role === 'sales_manager') {
        const agencyId = formData.subCompanyId || currentUser?.subCompanyId || '';
        if (getAgencyCompanyDirectorId(agencyId)) {
          list = list.filter((u) => u.role !== 'director');
        }
      }
      return list.sort((a, b) => {
        if (formData.role === 'sales_manager') {
          const agencyId = formData.subCompanyId || currentUser?.subCompanyId || '';
          const aIsAgencyCd = a.role === 'company_director' && a.subCompanyId === agencyId;
          const bIsAgencyCd = b.role === 'company_director' && b.subCompanyId === agencyId;
          if (aIsAgencyCd !== bIsAgencyCd) return aIsAgencyCd ? -1 : 1;
        }
        return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      });
    }
    return [];
  }, [
    needsManagerSelection,
    requiresDirector,
    formData.locationId,
    formData.country,
    users,
    directors,
    currentUser,
    locationById,
    formData.role,
    formData.subCompanyId,
    teamScopeRoleKeys,
    roleScopeByKey,
    scopeRank,
    getAgencyCompanyDirectorId,
  ]);
  const subCompanyPickerOptions = useMemo(() => {
    if (canAccessMultipleAgencies && accessibleAgencies.length > 0) {
      return accessibleAgencies.map((a) => ({ id: a.id, name: a.name }));
    }
    return subCompanies.map((sc) => ({ id: sc.id, name: sc.name }));
  }, [canAccessMultipleAgencies, accessibleAgencies, subCompanies]);

  const canPickAnySubCompany = canAccessMultipleAgencies && subCompanyPickerOptions.length > 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-muted-foreground">
            {canAccessMultipleAgencies
              ? isAllAgenciesView
                ? 'Manage user accounts — All Agencies'
                : `Manage user accounts — showing agency: ${selectedAgencyName ?? currentSubCompany?.name ?? ''}`
              : isTeamManagerOnly
              ? 'Manage your team members'
              : 'Manage user accounts and permissions'}
          </p>
        </div>
        <div className="flex gap-2">
          {canWriteUsers && canAccessMultipleAgencies && (
            <Button variant="outline" onClick={() => setIsLocationsDialogOpen(true)}>
              <MapPin className="h-4 w-4 mr-2" />
              Manage Locations
            </Button>
          )}
          {canWriteUsers && (
            <Button onClick={() => { resetForm(); setFormData((f) => ({ ...f, subCompanyId: effectiveAgencyId ?? currentSubCompany?.id ?? subCompanies[0]?.id ?? currentUser?.subCompanyId ?? '', locationId: locations[0]?.id ?? '' })); setIsAddDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          )}
        </div>
      </div>

      {/* ── Section Tab Bar ──────────────────────────────────────────────── */}
      {canOffboard && (
        <StickyHeader>
          <div className="flex items-center gap-1 pb-0">
            {(
              [
                { key: 'active',      label: 'Active Users' },
                { key: 'offboarding', label: 'In Offboarding' },
                { key: 'past',        label: 'Past Users' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setUserTab(key)}
                className={[
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  userTab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </StickyHeader>
      )}

      {userTab === 'offboarding' && (() => {
        const offboardingRows: OffboardingUserDetail[] = inProgressUsers.map((u: InProgressUserItem) => ({
          type: 'offboarding' as const,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          role: u.role,
          location: u.location ?? u.country,
          country: u.country,
          phone: u.phone ?? undefined,
          workHours: `${u.workStartTime} – ${u.workEndTime}`,
          status: 'In Progress',
          started: new Date(u.offboardingStartedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          manager: u.managerName ?? undefined,
        }));
        return (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role Title</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offboardingRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No users currently in offboarding</TableCell>
                  </TableRow>
                ) : inProgressUsers.map((src: InProgressUserItem, i: number) => (
                  <TableRow
                    key={src.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setDetailSheetUser(offboardingRows[i])}
                  >
                    <TableCell className="font-medium">{offboardingRows[i].name}</TableCell>
                    <TableCell>{offboardingRows[i].email}</TableCell>
                    <TableCell><Badge variant="secondary">{offboardingRows[i].role}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{offboardingRows[i].location}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                        {offboardingRows[i].status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{offboardingRows[i].started}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            offboardSavedProgressRef.current = false;
                            offboardCommittedRef.current = false;
                            setOffboardingTarget({ id: src.id, name: `${src.firstName} ${src.lastName}`, subCompanyId: src.subCompanyId });
                            setIsOffboardingOpen(true);
                          }}
                        >
                          Continue
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await cancelOffboarding(src.id);
                              localStorage.removeItem(`offboarding_draft_${src.id}`);
                              localStorage.removeItem(`offboarding_complete_${src.id}`);
                              queryClient.invalidateQueries({ queryKey: ['offboarding-in-progress'] });
                              queryClient.invalidateQueries({ queryKey: ['users'] });
                              toast.success(`${src.firstName} ${src.lastName} returned to active`);
                            } catch {
                              toast.error('Failed to cancel offboarding');
                            }
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })()}

      {userTab === 'past' && (() => {
        const pastRows: PastUserDetail[] = pastUsers.map((u: PastUserItem) => ({
          type: 'past' as const,
          name: `${u.firstName} ${u.lastName}`,
          email: u.email,
          role: u.role,
          location: u.location ?? u.country,
          country: u.country,
          phone: u.phone ?? undefined,
          workHours: `${u.workStartTime} – ${u.workEndTime}`,
          departed: new Date(u.departedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          by: u.adminName,
          tenure: u.startDate ? formatTenure(u.startDate, u.departedAt) : undefined,
        }));
        return (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role Title</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Departed</TableHead>
                  <TableHead>Offboarded By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No past offboarded users</TableCell>
                  </TableRow>
                ) : pastRows.map((u, idx) => (
                  <TableRow
                    key={u.email}
                    className="opacity-75 cursor-pointer hover:opacity-100 hover:bg-muted/50 transition-all"
                    onClick={async () => {
                      setDetailSheetUser(u);
                      const src = pastUsers[idx];
                      try {
                        const history = await fetchOffboardingHistory(src.userId);
                        const log = history.departed[0];
                        if (log) setDetailSheetUser({ ...u, steps: buildStepsFromLog(log) });
                      } catch { /* leave without steps */ }
                    }}
                  >
                    <TableCell className="font-medium text-muted-foreground">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell><Badge variant="secondary" className="opacity-70">{u.role}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{u.location}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.departed}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })()}

      {userTab === 'active' && <>

      {/* ── Agency Tab Bar (elevated roles only) ────────────────────────── */}
      {canAccessMultipleAgencies && (
        <StickyHeader>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <Button
              size="sm"
              variant={selectedAgencyId === 'all' ? 'default' : 'secondary'}
              className="whitespace-nowrap shrink-0"
              onClick={() => setSelectedAgencyId('all')}
            >
              All Agencies
            </Button>
            {agenciesLoading ? (
              <span className="inline-block h-4 w-4 ml-1 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            ) : (
              accessibleAgencies.map((agency) => (
                <Button
                  key={agency.id}
                  size="sm"
                  variant={selectedAgencyId === agency.id ? 'default' : 'secondary'}
                  className="whitespace-nowrap shrink-0"
                  onClick={() => setSelectedAgencyId(agency.id)}
                >
                  {agency.name}
                </Button>
              ))
            )}
          </div>
        </StickyHeader>
      )}

      {/* Search + hierarchy toggle */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={showHierarchyView ? 'Search hierarchy...' : 'Search users...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {canShowHierarchyToggle && canViewUsersList && (
          <div className="flex items-center gap-2 shrink-0">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="hierarchy-view-toggle" className="text-sm font-normal cursor-pointer">
              Hierarchy view
            </Label>
            <Switch
              id="hierarchy-view-toggle"
              checked={showHierarchyView}
              onCheckedChange={setShowHierarchyView}
            />
          </div>
        )}
      </div>

      {/* Users table or hierarchy tree */}
      <div className="border rounded-lg">
        {!canViewUsersList ? (
          <div className="p-12 text-center text-muted-foreground">
            <UsersIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p>You need <strong>View users</strong> (users:read) to see the user list on this page.</p>
          </div>
        ) : showHierarchyView && canShowHierarchyToggle ? (
          hierarchyLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading hierarchy...</div>
          ) : hierarchyError ? (
            <div className="p-8 text-center text-muted-foreground">Failed to load hierarchy</div>
          ) : hierarchyAgencySections.length > 0 ? (
            <UserHierarchyAgencySections
              agencies={hierarchyAgencySections}
              usersById={usersById}
              searchQuery={searchQuery}
            />
          ) : hierarchyData?.tree?.length ? (
            <UserHierarchyTree
              tree={hierarchyData.tree}
              usersById={usersById}
              searchQuery={searchQuery}
            />
          ) : (
            <div className="p-12 text-center text-muted-foreground">No hierarchy to display</div>
          )
        ) : loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading users...</div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              {isAllAgenciesView && <TableHead>Agency</TableHead>}
              <TableHead>Location</TableHead>
              <TableHead>Reporting Manager(s)</TableHead>
              <TableHead>Role Title</TableHead>
              <TableHead>Daily Targets</TableHead>
              <TableHead>Working Hours</TableHead>
              <TableHead>Active</TableHead>
              {canManageUserActions && <TableHead className="w-[50px]"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={(canManageUserActions ? 10 : 9) + (isAllAgenciesView ? 1 : 0)} className="text-center py-12">
                  <UsersIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">No users found</p>
                </TableCell>
              </TableRow>
            ) : (
              paginatedUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.firstName} {user.lastName}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  {isAllAgenciesView && (
                    <TableCell className="text-sm text-muted-foreground">
                      {formatUserAgencyLabel(
                        user.role,
                        user.subCompanyId ? subCompanyNameById.get(user.subCompanyId) : null,
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{locationById.get(user.locationId ?? '')?.name || '-'}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{user.country}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.reportingManagerIds?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {user.reportingManagerIds.map((managerId: string) => {
                          const manager = usersById.get(managerId);
                          return manager ? (
                            <Badge key={managerId} variant="outline" className="text-xs">
                              {manager.firstName} {manager.lastName}
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{user.userType || user.role || '-'}</Badge>
                  </TableCell>
                  <TableCell>
                    {hasDailyTargets(user.role) ? (
                      <div className="flex flex-col gap-0.5 text-xs">
                        {(defaultTargets[user.role]?.calls > 0 || user.dailyCallsTarget > 0) && (
                          <span className="text-muted-foreground">Calls: <span className="text-foreground font-medium">{user.dailyCallsTarget || defaultTargets[user.role]?.calls || 0}</span></span>
                        )}
                        {(defaultTargets[user.role]?.emails > 0 || user.dailyEmailsTarget > 0) && (
                          <span className="text-muted-foreground">Emails: <span className="text-foreground font-medium">{user.dailyEmailsTarget || defaultTargets[user.role]?.emails || 0}</span></span>
                        )}
                        {(defaultTargets[user.role]?.meetingSchedule > 0 || (user as ApiUser).dailyMeetingScheduleTarget > 0) && (
                          <span className="text-muted-foreground">Meeting schedule: <span className="text-foreground font-medium">{(user as ApiUser).dailyMeetingScheduleTarget || defaultTargets[user.role]?.meetingSchedule || 0}</span></span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">N/A</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {user.workStartTime && user.workEndTime
                      ? `${user.workStartTime} – ${user.workEndTime}`
                      : `${DEFAULT_WORK_START} – ${DEFAULT_WORK_END}`}
                  </TableCell>
                  <TableCell>
                    {canDeleteUsers ? (
                      <Switch
                        checked={user.isActive ?? true}
                        onCheckedChange={() => handleToggleActive(user)}
                      />
                    ) : (
                      <span className="text-sm">{user.isActive ? 'Yes' : 'No'}</span>
                    )}
                  </TableCell>
                  {canManageUserActions && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canWriteUsers && (
                            <DropdownMenuItem onSelect={() => afterDropdownSelect(() => openEditDialog(user))}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() =>
                              afterDropdownSelect(() =>
                                setIncomingCallsUser({
                                  id: user.id,
                                  firstName: user.firstName,
                                  lastName: user.lastName,
                                }),
                              )
                            }
                          >
                            <PhoneIncoming className="h-4 w-4 mr-2" />
                            Incoming Calls
                          </DropdownMenuItem>
                          {canWriteUsers && hasDailyTargets(user.role) && (
                            <DropdownMenuItem onSelect={() => afterDropdownSelect(() => openTargetsDialog(apiUserToUser(user)))}>
                              <Target className="h-4 w-4 mr-2" />
                              Set Daily Targets
                            </DropdownMenuItem>
                          )}
                          {canWriteUsers && canAdminPassword && (
                            <>
                              <DropdownMenuItem onSelect={() => afterDropdownSelect(() => openSetPasswordDialog(user))}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                Set password
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => afterDropdownSelect(() => void handleSendResetEmail(user))}>
                                <Mail className="h-4 w-4 mr-2" />
                                Send reset password email
                              </DropdownMenuItem>
                            </>
                          )}
                          {canOffboard && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => afterDropdownSelect(() => {
                                  setHistoryTarget({ id: user.id, name: `${user.firstName} ${user.lastName}` });
                                })}
                              >
                                <LogOut className="h-4 w-4 mr-2" />
                                Offboarding History
                              </DropdownMenuItem>
                              {user.id !== currentUser?.id && (
                                <DropdownMenuItem
                                  onSelect={() => afterDropdownSelect(async () => {
                                    try {
                                      await initiateOffboarding(user.id);
                                    } catch {
                                      toast.error('Could not initiate offboarding');
                                      return;
                                    }
                                    queryClient.invalidateQueries({ queryKey: ['users'] });
                                    queryClient.invalidateQueries({ queryKey: ['offboarding-in-progress'] });
                                    offboardCommittedRef.current = false;
                                    setOffboardingTarget({ id: user.id, name: `${user.firstName} ${user.lastName}`, subCompanyId: user.subCompanyId ?? '' });
                                    setIsOffboardingOpen(true);
                                  })}
                                  className="text-amber-600 focus:text-amber-600"
                                >
                                  <LogOut className="h-4 w-4 mr-2" />
                                  Offboard
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                          {canDeleteUsers && canWriteUsers && <DropdownMenuSeparator />}
                          {canDeleteUsers && (
                            <DropdownMenuItem
                              onSelect={() => afterDropdownSelect(() => openToggleActiveDialog(apiUserToUser(user)))}
                              className={user.isActive !== false ? 'text-destructive' : undefined}
                            >
                              {user.isActive !== false ? (
                                <>
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Deactivate
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-4 w-4 mr-2" />
                                  Activate
                                </>
                              )}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        )}

        {/* Pagination footer */}
        {!showHierarchyView && !loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-4 border-t">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {startIndex + paginatedUsers.length} of {filteredUsers.length} users
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
              <div className="flex items-center gap-1">
                {(() => {
                  const maxButtons = 7;
                  const start = totalPages <= maxButtons ? 1 : Math.min(Math.max(1, currentPage - 3), totalPages - maxButtons + 1);
                  const end = Math.min(start + maxButtons - 1, totalPages);
                  return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(page => (
                    <Button key={page} variant={currentPage === page ? 'default' : 'outline'} size="sm" onClick={() => setCurrentPage(page)} className="min-w-[36px]">
                      {page}
                    </Button>
                  ));
                })()}
              </div>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
            </div>
          </div>
        )}
      </div>

      </> /* end userTab === 'active' */}

      {/* Add User Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account. They will sign in with email and password.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {canPickAnySubCompany && !isAgencyIndependentFormRole && (
              <div className="space-y-2">
                <Label>Agency</Label>
                <Select
                  value={formData.subCompanyId}
                  onValueChange={(value) => {
                    const cdId =
                      formData.role === 'sales_manager' ? getAgencyCompanyDirectorId(value) : null;
                    setFormData({
                      ...formData,
                      subCompanyId: value,
                      reportingManagerIds: cdId ? [cdId] : formData.reportingManagerIds,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select agency" />
                  </SelectTrigger>
                  <SelectContent>
                    {subCompanyPickerOptions.map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
              {allowedEmailDomains.length > 0 && (
                <p className="text-xs text-red-500">
                  Only allowed: {allowedEmailDomains.map((d) => `@${d}`).join(', ')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="addPassword">Password *</Label>
              <div className="flex gap-2">
                <Input
                  id="addPassword"
                  type="text"
                  placeholder="Enter or generate a password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Generate password"
                  onClick={() => setFormData((f) => ({ ...f, password: generateSecurePassword() }))}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Copy password"
                  onClick={async () => {
                    if (!formData.password) {
                      toast.error('No password to copy');
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(formData.password);
                      toast.success('Password copied to clipboard');
                    } catch {
                      toast.error('Failed to copy');
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-phone">Phone *</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="e.g. +1-416-555-0100"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => {
                  const defaults = getDefaultsForRole(value);
                  const agencyId = formData.subCompanyId || currentUser?.subCompanyId || '';
                  const autoDirector = defaultReportingManagerIdsForRole(value, agencyId);
                  setFormData({
                    ...formData,
                    role: value,
                    userType: labelForRole(value),
                    dailyCalls: defaults.dailyCalls,
                    dailyEmails: defaults.dailyEmails,
                    dailyMeetingSchedule: defaults.dailyMeetingSchedule,
                    reportingManagerIds: autoDirector,
                    ...(isAgencyIndependentRole(value) ? { subCompanyId: '', locationId: '' } : {}),
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectableRoleOptions.map((opt) => (
                    <SelectItem key={opt.role} value={opt.role}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role-title">Role Title *</Label>
              <Input
                id="add-role-title"
                value={formData.userType}
                onChange={(e) => setFormData({ ...formData, userType: e.target.value })}
                placeholder="e.g. Sales Associate"
              />
            </div>
            {isAgencyIndependentFormRole ? (
              <p className="text-sm text-muted-foreground rounded-md border px-3 py-2">
                This role is org-wide and is not tied to any agency.
              </p>
            ) : (
            <div className="space-y-2">
              <Label>Primary Location *</Label>
              <Select
                value={formData.locationId}
                onValueChange={(value) => {
                  const selectedLocation = locationById.get(value);
                  const defaultManager = getDefaultManagerForLocation(value);
                  const newManagerIds = defaultManager && !formData.reportingManagerIds.includes(defaultManager.id)
                    ? [...formData.reportingManagerIds.filter(id => usersById.get(id)?.country === selectedLocation?.country), defaultManager.id]
                    : formData.reportingManagerIds.filter(id => usersById.get(id)?.country === selectedLocation?.country);
                  setFormData({
                    ...formData,
                    locationId: value,
                    country: (selectedLocation?.country as Country) || formData.country,
                    reportingManagerIds: newManagerIds,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((country) => (
                    <div key={country}>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                        {country}
                      </div>
                      {locations.filter(l => l.isActive && l.country === country).map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          <div className="flex flex-col">
                            <span>{location.name}</span>
                            {location.address && (
                              <span className="text-xs text-muted-foreground">{location.address}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
              {formData.locationId && (
                <p className="text-xs text-muted-foreground">
                  Country: <span className="font-medium">{locationById.get(formData.locationId)?.country}</span>
                </p>
              )}
            </div>
            )}
            {/* Reporting Managers */}
            {canHaveManager && (
              <div className="space-y-2">
                <Label>
                  {requiresDirector ? 'Reporting Parent *' : 'Reporting Manager(s) *'}
                </Label>
                {requiresDirector ? (
                  <>
                  <Select
                    value={formData.reportingManagerIds[0] ?? ''}
                    onValueChange={(value) => setFormData({ ...formData, reportingManagerIds: value ? [value] : [] })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an agency/global manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableManagers.map((manager) => (
                        <SelectItem key={manager.id} value={manager.id}>
                          {manager.firstName} {manager.lastName}
                          <span className="text-xs text-muted-foreground ml-1">({manager.userType})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formData.role === 'sales_manager' && !agencyHasCompanyDirector(formData.subCompanyId || currentUser?.subCompanyId || '') && (
                    <p className="text-xs text-muted-foreground">
                      No Company Director for this agency yet — reporting defaults to org Director. Add one in Super Users; existing Sales Managers will repoint automatically.
                    </p>
                  )}
                  </>
                ) : (
                  <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                    {availableManagers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No managers available for this country</p>
                    ) : (
                      availableManagers.map((manager) => {
                        const isDefault = getDefaultManagerForLocation(formData.locationId)?.id === manager.id;
                        const isSelfManager = isTeamManagerOnly && currentUser?.id === manager.id;
                        return (
                          <div key={manager.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`add-mgr-${manager.id}`}
                                checked={
                                  formData.reportingManagerIds.includes(manager.id) ||
                                  isSelfManager
                                }
                                disabled={isSelfManager}
                                onCheckedChange={() => toggleReportingManager(manager.id)}
                              />
                              <label htmlFor={`add-mgr-${manager.id}`} className="text-sm cursor-pointer">
                                {manager.firstName} {manager.lastName}
                                <span className="text-xs text-muted-foreground ml-1">({manager.userType})</span>
                              </label>
                            </div>
                            {isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
                {salesManagerMissingCompanyDirector && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No Company Director for this agency yet. Add one in Super Users first so Sales Managers report correctly.
                  </p>
                )}
                {!requiresDirector && (
                  <p className="text-xs text-muted-foreground">
                    {`Select managers from ${formData.country || 'the selected country'}. Default manager is auto-selected.`}
                  </p>
                )}
              </div>
            )}
            {hasAllAccess && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  <Building2 className="h-4 w-4 inline mr-1" />
                  {labelForRole(formData.role)} has access to all locations
                </p>
              </div>
            )}
            {showLocationAccess && (
              <div className="space-y-2">
                <Label>Accessible Locations</Label>
                <div className="border rounded-lg p-3 space-y-2 max-h-32 overflow-y-auto">
                  {locations.filter(l => l.isActive).map((location) => (
                    <div key={location.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`add-loc-${location.id}`}
                        checked={formData.accessibleLocationIds.includes(location.id)}
                        onCheckedChange={() => toggleAccessibleLocation(location.id)}
                      />
                      <label htmlFor={`add-loc-${location.id}`} className="text-sm cursor-pointer">
                        {location.name}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Select locations this user can access</p>
              </div>
            )}
            {isOwnScopeRoleKey(formData.role, assignableRoles) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Daily Targets</span>
                  {defaultTargets[formData.role] && (
                    <span className="text-xs text-muted-foreground">Default from settings</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 p-4 bg-muted/50 rounded-lg">
                  <div className="space-y-2">
                    <Label htmlFor="dailyCalls">Calls</Label>
                    <Input id="dailyCalls" type="number" min="0" value={formData.dailyCalls} onChange={(e) => setFormData({ ...formData, dailyCalls: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dailyEmails">Emails</Label>
                    <Input id="dailyEmails" type="number" min="0" value={formData.dailyEmails} onChange={(e) => setFormData({ ...formData, dailyEmails: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="dailyMeetingSchedule">Meeting Schedule Target</Label>
                    <Input id="dailyMeetingSchedule" type="number" min="0" value={formData.dailyMeetingSchedule} onChange={(e) => setFormData({ ...formData, dailyMeetingSchedule: parseInt(e.target.value) || 0 })} />
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Working Hours</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="addWorkStart" className="text-xs text-muted-foreground">Start Time</Label>
                  <Input
                    id="addWorkStart"
                    type="time"
                    value={formData.workStartTime}
                    onChange={(e) => setFormData({ ...formData, workStartTime: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="addWorkEnd" className="text-xs text-muted-foreground">End Time</Label>
                  <Input
                    id="addWorkEnd"
                    type="time"
                    value={formData.workEndTime}
                    onChange={(e) => setFormData({ ...formData, workEndTime: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddUser}>Add User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set password dialog (super_admin, director, operations_manager) */}
      <Dialog open={isSetPasswordDialogOpen} onOpenChange={(open) => { setIsSetPasswordDialogOpen(open); if (!open) { setSetPasswordTargetUser(null); setSetPasswordNewPassword(''); setSetPasswordConfirm(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set password</DialogTitle>
            <DialogDescription>
              {setPasswordTargetUser
                ? `Set a new password for ${setPasswordTargetUser.firstName} ${setPasswordTargetUser.lastName} (${setPasswordTargetUser.email}).`
                : 'Set a new password for this user.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="setPasswordNew">New password</Label>
              <Input
                id="setPasswordNew"
                type="password"
                placeholder="Min 8 characters, letter and number"
                value={setPasswordNewPassword}
                onChange={(e) => setSetPasswordNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setPasswordConfirm">Confirm password</Label>
              <Input
                id="setPasswordConfirm"
                type="password"
                placeholder="Confirm new password"
                value={setPasswordConfirm}
                onChange={(e) => setSetPasswordConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsSetPasswordDialogOpen(false); setSetPasswordTargetUser(null); setSetPasswordNewPassword(''); setSetPasswordConfirm(''); }}>
              Cancel
            </Button>
            <Button onClick={handleSetPasswordSubmit} disabled={setPasswordSubmitting}>
              {setPasswordSubmitting ? 'Updating…' : 'Set password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user information</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editFirstName">First Name *</Label>
                <Input
                  id="editFirstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editLastName">Last Name *</Label>
                <Input
                  id="editLastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editEmail">Email (read-only)</Label>
              <Input id="editEmail" type="email" value={formData.email} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editPassword">New password (leave blank to keep current)</Label>
              <div className="flex gap-2">
                <Input
                  id="editPassword"
                  type="text"
                  placeholder="Optional"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Copy password"
                  onClick={async () => {
                    if (!formData.password) {
                      toast.error('No password to copy');
                      return;
                    }
                    try {
                      await navigator.clipboard.writeText(formData.password);
                      toast.success('Password copied to clipboard');
                    } catch {
                      toast.error('Failed to copy');
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editPhone">Phone *</Label>
              <Input
                id="editPhone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="e.g. +1-416-555-0100"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => {
                  const defaults = getDefaultsForRole(value);
                  const agencyId = formData.subCompanyId || currentUser?.subCompanyId || '';
                  const autoDirector = defaultReportingManagerIdsForRole(value, agencyId);
                  setFormData({
                    ...formData,
                    role: value,
                    userType: labelForRole(value),
                    dailyCalls: defaults.dailyCalls,
                    dailyEmails: defaults.dailyEmails,
                    dailyMeetingSchedule: defaults.dailyMeetingSchedule,
                    reportingManagerIds: autoDirector.length > 0 ? autoDirector : formData.reportingManagerIds,
                    ...(isAgencyIndependentRole(value) ? { subCompanyId: '', locationId: '' } : {}),
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectableRoleOptions.map((opt) => (
                    <SelectItem key={opt.role} value={opt.role}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role-title">Role Title *</Label>
              <Input
                id="edit-role-title"
                value={formData.userType}
                onChange={(e) => setFormData({ ...formData, userType: e.target.value })}
                placeholder="e.g. Sales Associate"
              />
            </div>
            {canPickAnySubCompany && !isAgencyIndependentFormRole && (
              <div className="space-y-2">
                <Label>Agency</Label>
                <Select
                  value={formData.subCompanyId}
                  onValueChange={(value) => {
                    const cdId =
                      formData.role === 'sales_manager' ? getAgencyCompanyDirectorId(value) : null;
                    setFormData({
                      ...formData,
                      subCompanyId: value,
                      reportingManagerIds: cdId ? [cdId] : formData.reportingManagerIds,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select agency" />
                  </SelectTrigger>
                  <SelectContent>
                    {subCompanyPickerOptions.map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAgencyIndependentFormRole ? (
              <p className="text-sm text-muted-foreground rounded-md border px-3 py-2">
                This role is org-wide and is not tied to any agency.
              </p>
            ) : (
            <div className="space-y-2">
              <Label>Primary Location *</Label>
              <Select
                value={formData.locationId}
                onValueChange={(value) => {
                  const selectedLocation = locationById.get(value);
                  const defaultManager = getDefaultManagerForLocation(value);
                  const newManagerIds = defaultManager && !formData.reportingManagerIds.includes(defaultManager.id)
                    ? [...formData.reportingManagerIds.filter(id => usersById.get(id)?.country === selectedLocation?.country), defaultManager.id]
                    : formData.reportingManagerIds.filter(id => usersById.get(id)?.country === selectedLocation?.country);
                  setFormData({
                    ...formData,
                    locationId: value,
                    country: (selectedLocation?.country as Country) || formData.country,
                    reportingManagerIds: newManagerIds,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((country) => (
                    <div key={country}>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                        {country}
                      </div>
                      {locations.filter(l => l.isActive && l.country === country).map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          <div className="flex flex-col">
                            <span>{location.name}</span>
                            {location.address && (
                              <span className="text-xs text-muted-foreground">{location.address}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
              {formData.locationId && (
                <p className="text-xs text-muted-foreground">
                  Country: <span className="font-medium">{locationById.get(formData.locationId)?.country}</span>
                </p>
              )}
            </div>
            )}
            {/* Reporting Managers */}
            {canHaveManager && (
              <div className="space-y-2">
                <Label>
                  {requiresDirector ? 'Reporting Parent *' : 'Reporting Manager(s) *'}
                </Label>
                {requiresDirector ? (
                  <>
                  <Select
                    value={formData.reportingManagerIds[0] ?? ''}
                    onValueChange={(value) => setFormData({ ...formData, reportingManagerIds: value ? [value] : [] })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an agency/global manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableManagers.map((manager) => (
                        <SelectItem key={manager.id} value={manager.id}>
                          {manager.firstName} {manager.lastName}
                          <span className="text-xs text-muted-foreground ml-1">({manager.userType})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formData.role === 'sales_manager' && !agencyHasCompanyDirector(formData.subCompanyId || currentUser?.subCompanyId || '') && (
                    <p className="text-xs text-muted-foreground">
                      No Company Director for this agency yet — reporting defaults to org Director. Add one in Super Users; existing Sales Managers will repoint automatically.
                    </p>
                  )}
                  </>
                ) : (
                  <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                    {availableManagers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No managers available for this country</p>
                    ) : (
                      availableManagers.map((manager) => {
                        const isDefault = getDefaultManagerForLocation(formData.locationId)?.id === manager.id;
                        const isSelfManager = isTeamManagerOnly && currentUser?.id === manager.id;
                        return (
                          <div key={manager.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`edit-mgr-${manager.id}`}
                                checked={
                                  formData.reportingManagerIds.includes(manager.id) ||
                                  isSelfManager
                                }
                                disabled={isSelfManager}
                                onCheckedChange={() => toggleReportingManager(manager.id)}
                              />
                              <label htmlFor={`edit-mgr-${manager.id}`} className="text-sm cursor-pointer">
                                {manager.firstName} {manager.lastName}
                                <span className="text-xs text-muted-foreground ml-1">({manager.userType})</span>
                              </label>
                            </div>
                            {isDefault && <Badge variant="secondary" className="text-xs">Default</Badge>}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
                {salesManagerMissingCompanyDirector && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No Company Director for this agency yet. Add one in Super Users first so Sales Managers report correctly.
                  </p>
                )}
                {!requiresDirector && (
                  <p className="text-xs text-muted-foreground">
                    {`Select managers from ${formData.country || 'the selected country'}. Default manager is auto-selected.`}
                  </p>
                )}
              </div>
            )}
            {hasAllAccess && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  <Building2 className="h-4 w-4 inline mr-1" />
                  {labelForRole(formData.role)} has access to all locations
                </p>
              </div>
            )}
            {showLocationAccess && (
              <div className="space-y-2">
                <Label>Accessible Locations</Label>
                <div className="border rounded-lg p-3 space-y-2 max-h-32 overflow-y-auto">
                  {locations.filter(l => l.isActive).map((location) => (
                    <div key={location.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`edit-loc-${location.id}`}
                        checked={formData.accessibleLocationIds.includes(location.id)}
                        onCheckedChange={() => toggleAccessibleLocation(location.id)}
                      />
                      <label htmlFor={`edit-loc-${location.id}`} className="text-sm cursor-pointer">
                        {location.name}
                      </label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Select locations this user can access</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Working Hours</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="editWorkStart" className="text-xs text-muted-foreground">Start Time</Label>
                  <Input
                    id="editWorkStart"
                    type="time"
                    value={formData.workStartTime}
                    onChange={(e) => setFormData({ ...formData, workStartTime: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="editWorkEnd" className="text-xs text-muted-foreground">End Time</Label>
                  <Input
                    id="editWorkEnd"
                    type="time"
                    value={formData.workEndTime}
                    onChange={(e) => setFormData({ ...formData, workEndTime: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Switch
                checked={formData.probationOverride}
                onCheckedChange={(checked) => setFormData({ ...formData, probationOverride: checked })}
              />
              <div>
                <Label className="text-amber-600 dark:text-amber-400">Override Probation Restrictions</Label>
                <p className="text-xs text-muted-foreground">Allow full access during probation period</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditUser}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Daily Targets Dialog */}
      <Dialog open={isTargetsDialogOpen} onOpenChange={setIsTargetsDialogOpen}>
        <DialogContent className="sm:max-w-[400px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set Daily Targets</DialogTitle>
            <DialogDescription>
              Set daily call and email targets for {selectedUser?.firstName} {selectedUser?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="targetDailyCalls">Daily Calls Target</Label>
              <Input id="targetDailyCalls" type="number" min="0" value={formData.dailyCalls} onChange={(e) => setFormData({ ...formData, dailyCalls: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetDailyEmails">Daily Emails Target</Label>
              <Input id="targetDailyEmails" type="number" min="0" value={formData.dailyEmails} onChange={(e) => setFormData({ ...formData, dailyEmails: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetDailyMeetingSchedule">Meeting Schedule Target</Label>
              <Input id="targetDailyMeetingSchedule" type="number" min="0" value={formData.dailyMeetingSchedule} onChange={(e) => setFormData({ ...formData, dailyMeetingSchedule: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTargetsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateTargets}>Save Targets</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate / deactivate confirmation */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.isActive !== false ? 'Deactivate User' : 'Activate User'}
            </DialogTitle>
            <DialogDescription>
              {selectedUser?.isActive !== false ? (
                <>
                  Deactivate {selectedUser?.firstName} {selectedUser?.lastName}? They will no longer be able to sign
                  in. You can reactivate them later from this menu or by editing the user.
                </>
              ) : (
                <>
                  Activate {selectedUser?.firstName} {selectedUser?.lastName}? They will be able to sign in again.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            {selectedUser?.isActive !== false ? (
              <Button type="button" variant="destructive" onClick={handleConfirmToggleActive}>
                Deactivate
              </Button>
            ) : (
              <Button type="button" onClick={handleConfirmToggleActive}>
                Activate
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Locations Dialog */}
      <Dialog open={isLocationsDialogOpen} onOpenChange={setIsLocationsDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Locations</DialogTitle>
            <DialogDescription>Add, edit, or remove office locations</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Add new location */}
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="Location name"
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Address</Label>
                <Input
                  placeholder="Address (optional)"
                  value={newLocationAddress}
                  onChange={(e) => setNewLocationAddress(e.target.value)}
                />
              </div>
              <div className="w-32 space-y-2">
                <Label>Country</Label>
                <Select
                  value={newLocationCountry}
                  onValueChange={(value: Country) => setNewLocationCountry(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddLocation}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Locations list */}
            <div className="border rounded-lg divide-y">
              {locations.map((location) => (
                <div key={location.id} className="p-3 flex items-center justify-between">
                {editingLocation?.id === location.id ? (
                    <div className="flex-1 flex gap-2 items-center">
                      <Input
                        value={editingLocation.name}
                        onChange={(e) => setEditingLocation({ ...editingLocation, name: e.target.value })}
                        className="flex-1"
                      />
                      <Input
                        value={editingLocation.address || ''}
                        onChange={(e) => setEditingLocation({ ...editingLocation, address: e.target.value })}
                        placeholder="Address"
                        className="flex-1"
                      />
                      <Select
                        value={editingLocation.country}
                        onValueChange={(value: Country) => setEditingLocation({ ...editingLocation, country: value })}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {countries.map((country) => (
                            <SelectItem key={country} value={country}>
                              {country}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={handleUpdateLocation}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingLocation(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{location.name}</span>
                          <Badge variant="outline" className="text-xs">{location.country}</Badge>
                        </div>
                        {location.address && (
                          <p className="text-sm text-muted-foreground ml-6">{location.address}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingLocation(location)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleDeleteLocation(location.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsLocationsDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {offboardingTarget && (
        <OffboardingWizard
          open={isOffboardingOpen}
          onOpenChange={async (v) => {
            setIsOffboardingOpen(v);
            if (!v && offboardingTarget) {
              if (!offboardCommittedRef.current && !offboardSavedProgressRef.current) {
                // Wizard dismissed without saving or committing — cancel the DB flag and clear local draft
                localStorage.removeItem(`offboarding_draft_${offboardingTarget.id}`);
                localStorage.removeItem(`offboarding_complete_${offboardingTarget.id}`);
                cancelOffboarding(offboardingTarget.id).catch(() => {});
                queryClient.invalidateQueries({ queryKey: ['users'] });
                queryClient.invalidateQueries({ queryKey: ['offboarding-in-progress'] });
              }
              offboardCommittedRef.current = false;
              offboardSavedProgressRef.current = false;
              setOffboardingTarget(null);
            }
          }}
          departingUserId={offboardingTarget.id}
          departingUserName={offboardingTarget.name}
          departingSubCompanyId={offboardingTarget.subCompanyId}
          onSaveProgress={() => {
            offboardSavedProgressRef.current = true;
            setUserTab('offboarding');
          }}
          onComplete={() => {
            offboardCommittedRef.current = true;
            void loadData();
            queryClient.invalidateQueries({ queryKey: ['offboarding-in-progress'] });
            queryClient.invalidateQueries({ queryKey: ['offboarding-past'] });
          }}
        />
      )}
      {historyTarget && (
        <OffboardingHistorySheet
          userId={historyTarget.id}
          userName={historyTarget.name}
          open={!!historyTarget}
          onOpenChange={(v) => { if (!v) setHistoryTarget(null); }}
        />
      )}

      <Dialog
        open={!!incomingCallsUser}
        onOpenChange={(open) => { if (!open) setIncomingCallsUser(null); }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Incoming calls
              {incomingCallsUser
                ? ` — ${incomingCallsUser.firstName} ${incomingCallsUser.lastName}`
                : ''}
            </DialogTitle>
            <DialogDescription>
              Inbound calls answered or rung for this user.
            </DialogDescription>
          </DialogHeader>
          {incomingCallsUser && (
            <InboundCallsTab
              compact
              currentUserId={incomingCallsUser.id}
              subCompanyId={currentSubCompany?.id ?? effectiveAgencyId ?? ''}
              viewUserId={incomingCallsUser.id}
            />
          )}
        </DialogContent>
      </Dialog>
      <UserDetailSheet
        user={detailSheetUser}
        open={!!detailSheetUser}
        onOpenChange={(v) => { if (!v) setDetailSheetUser(null); }}
      />
    </div>
  );
}
