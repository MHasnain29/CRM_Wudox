import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StickyHeader } from '@/components/StickyHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Search,
  Plus,
  MoreHorizontal,
  Users,
  UserCheck,
  UserX,
  FilePenLine,
  Clock,
  Filter,
  Save,
  Eye,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
  PhoneCall,
  Mail,
  Calendar,
  Link2,
  GraduationCap,
} from 'lucide-react';
import { Employee, EmployeeTag, EmployeeCounts, AvailabilityType } from '@/lib/employeeTypes';
import { FilterView } from '@/lib/types';
import { format } from 'date-fns';
import { EmployeeDetailsSheet } from '@/components/employees/EmployeeDetailsSheet';
import { EmployeeStatusBadge } from '@/components/employees/EmployeeStatusBadge';
import { EmployeeSpecialTags } from '@/components/employees/EmployeeSpecialTags';
import { EmployeeDraftsTab } from '@/components/employees/EmployeeDraftsTab';
import { EmployeeExpiringDocsTab } from '@/components/employees/EmployeeExpiringDocsTab';
import { EmployeesScopeFilterBar } from '@/components/employees/EmployeesScopeFilterBar';
import { EmployeeCallInterface } from '@/components/employees/EmployeeCallInterface';
import { EmployeeFollowUpDialog } from '@/components/employees/EmployeeFollowUpDialog';
import { LinkClientJobDialog } from '@/components/employees/LinkClientJobDialog';
import { EmployeeTrainingDialog } from '@/components/employees/EmployeeTrainingDialog';
import {
  EMPLOYEE_PENDING_STATUS_CHIP_WIDTH,
  EmployeePendingReadinessBadges,
} from '@/components/employees/EmployeePendingReadinessBadges';
import { EmailComposeDialog } from '@/components/EmailComposeDialog';
import { useCallStore } from '@/lib/callStore';
import {
  listEmployeeFormDrafts,
  removeEmployeeFormDraftByKey,
  type StoredDraftSummary,
} from '@/components/employees/form/localExtras';
import { clearDraftFiles } from '@/components/employees/form/draftFiles';
import { toast } from '@/hooks/use-toast';
import { useHasPermission } from '@/lib/access';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import {
  fetchEmployees,
  fetchEmployeeCounts,
  fetchEmployee,
  fetchExpiringEmployeeDocuments,
} from '@/lib/api';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
/** Flow: Draft → Pending → Master → Active (training pending still shows on Active). */
type TabValue =
  | 'draft'
  | 'unregistered'
  | 'pending'
  | 'master'
  | 'active'
  | 'expiring';

const CANADIAN_PROVINCES = [
  'Alberta',
  'British Columbia',
  'Manitoba',
  'New Brunswick',
  'Newfoundland and Labrador',
  'Northwest Territories',
  'Nova Scotia',
  'Nunavut',
  'Ontario',
  'Prince Edward Island',
  'Quebec',
  'Saskatchewan',
  'Yukon',
] as const;

const SPECIAL_TAG_OPTIONS: { value: EmployeeTag; label: string }[] = [
  { value: 'blacklisted', label: 'Blacklisted' },
  { value: 'no_show', label: 'No Show' },
  { value: 'ex', label: 'Ex' },
];

const emptyCounts: EmployeeCounts = {
  master: 0,
  active: 0,
  blacklist: 0,
  ex: 0,
  pending: 0,
  unregistered: 0,
};

const PIPELINE_TABS: TabValue[] = [
  'draft',
  'unregistered',
  'pending',
  'master',
  'active',
  'expiring',
];

export default function Employees() {
  return <LiveEmployees />;
}

function LiveEmployees() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [counts, setCounts] = useState<EmployeeCounts>(emptyCounts);
  const [loading, setLoading] = useState(true);
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabValue>(() => {
    // Legacy tab removed: placed + unsigned training now lives under Active.
    if (initialTab === 'in_client_training') return 'active';
    if (initialTab && (PIPELINE_TABS as string[]).includes(initialTab)) {
      return initialTab as TabValue;
    }
    return 'master';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [callingEmployee, setCallingEmployee] = useState<Employee | null>(null);
  const [emailingEmployee, setEmailingEmployee] = useState<Employee | null>(null);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [followUpEmployee, setFollowUpEmployee] = useState<Employee | null>(null);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [linkEmployee, setLinkEmployee] = useState<Employee | null>(null);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [trainingEmployee, setTrainingEmployee] = useState<Employee | null>(null);
  const [isTrainingOpen, setIsTrainingOpen] = useState(false);
  const [expiringTotal, setExpiringTotal] = useState(0);

  const [employeeTypeFilter, setEmployeeTypeFilter] = useState<string[]>([]);
  const [availabilityFilter, setAvailabilityFilter] = useState<string[]>([]);
  const [cityFilters, setCityFilters] = useState<string[]>([]);
  const [provinceFilters, setProvinceFilters] = useState<string[]>([]);
  const [specialTagFilters, setSpecialTagFilters] = useState<string[]>([]);

  const [savedViews, setSavedViews] = useState<FilterView[]>(() => {
    const stored = localStorage.getItem('employeeViews');
    return stored ? JSON.parse(stored) : [];
  });
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const [isNewViewDialogOpen, setIsNewViewDialogOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const canManageEmployees = useHasPermission('employees:write');
  const canApproveEmployees = useHasPermission('employees:approve');
  const canReadEmployees = useHasPermission('employees:read');
  const canSeePending = canManageEmployees || canApproveEmployees;
  const canAccessEmployeeActions = canManageEmployees || canReadEmployees;
  const { openCallInterface, isCallInterfaceOpen, isMinimized, activeCall } = useCallStore();

  const scopeFilter = useScopeFilter({ domain: 'recruitment' });
  const { agencyId, ownerIds, ownerExact, scopeKey } = useScopeQueryParams(scopeFilter);
  // Fallback agency when the scope shows "all agencies".
  const { agencyId: demoAgencyId } = useRecruitmentAgencyId();
  const writeAgencyId = useWriteAgencyId(agencyId || demoAgencyId || undefined);
  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';
  const linkedAccountsQuery = useLinkedAccounts();
  const linkedAccounts = linkedAccountsQuery.data ?? [];
  const linkedIds = useMemo(
    () => linkedUserIdParam.split(',').filter(Boolean),
    [linkedUserIdParam],
  );
  /** Wait for linked accounts before resolving agency scope (avoids all→subset race). */
  const linkedScopePending = linkedIds.length > 0 && linkedAccountsQuery.isLoading;

  const elevatedAllAgencies =
    scopeFilter.showAgencyFilterBar || scopeFilter.showHierarchyFilters;

  /** Agency scope for list/counts: hierarchy agency, or union of linked agencies. */
  const listAgencyIds = useMemo(() => {
    if (agencyId) return [agencyId];
    if (linkedIds.length > 0) {
      const agencies = new Set<string>();
      for (const a of linkedAccounts) {
        if (a.isActive && linkedIds.includes(a.userId) && a.subCompanyId) {
          agencies.add(a.subCompanyId);
        }
      }
      if (agencies.size > 0) return [...agencies].sort();
      // Linked chips selected but accounts not loaded / empty — do not fall back yet.
      if (linkedAccountsQuery.isLoading || linkedAccountsQuery.isFetching) return undefined;
    }
    // Explicit All Agencies only — unselected defaults to home agency.
    if (elevatedAllAgencies && scopeFilter.selectedAgencyId === 'all') {
      return undefined;
    }
    return demoAgencyId ? [demoAgencyId] : undefined;
  }, [
    agencyId,
    linkedIds,
    linkedAccounts,
    linkedAccountsQuery.isLoading,
    linkedAccountsQuery.isFetching,
    elevatedAllAgencies,
    scopeFilter.selectedAgencyId,
    demoAgencyId,
  ]);

  const wantsAllAgencies =
    !listAgencyIds?.length &&
    elevatedAllAgencies &&
    linkedIds.length === 0 &&
    scopeFilter.selectedAgencyId === 'all';
  const agencyScopeReady =
    !linkedScopePending &&
    (wantsAllAgencies || (listAgencyIds?.length ?? 0) > 0 || !!demoAgencyId);

  /** Stable key so array identity does not thrash loaders. */
  const listAgencyKey = listAgencyIds?.join(',') ?? (wantsAllAgencies ? 'all' : '');

  const [unregisteredCount, setUnregisteredCount] = useState(0);
  const [drafts, setDrafts] = useState<StoredDraftSummary[]>([]);
  const refreshGenRef = useRef(0);

  const refreshDrafts = useCallback(() => {
    setDrafts(listEmployeeFormDrafts());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const agencyFetchOpts = useMemo(() => {
    const base = listAgencyIds?.length
      ? { agencyIds: listAgencyIds }
      : wantsAllAgencies
        ? { allAgencies: true as const }
        : undefined;
    if (!base) return undefined;
    // Own-default / recruitment chips → narrow to my candidates (addedById on the server).
    return ownerIds?.length ? { ...base, ownerIds, ownerExact } : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listAgencyKey, wantsAllAgencies, listAgencyIds, ownerIds?.join(','), ownerExact]);

  const loadExpiringCount = useCallback(async () => {
    try {
      const result = await fetchExpiringEmployeeDocuments({ withinDays: 90, page: 1, limit: 1 });
      setExpiringTotal(result.total);
    } catch {
      /* keep previous */
    }
  }, []);

  const loadCounts = useCallback(async () => {
    if (!agencyScopeReady) return;
    try {
      const data = await fetchEmployeeCounts(agencyFetchOpts);
      setCounts(data);
      setUnregisteredCount(data.unregistered ?? 0);
    } catch {
      /* keep previous */
    }
  }, [agencyScopeReady, agencyFetchOpts]);

  /** Full refresh: counts + list together so Pending card cannot lag/race list rows. */
  const refresh = useCallback(async () => {
    refreshDrafts();
    if (!agencyScopeReady) return;

    const gen = ++refreshGenRef.current;
    void loadExpiringCount();

    const isDraftOrExpiring = activeTab === 'draft' || activeTab === 'expiring';
    if (isDraftOrExpiring) {
      setEmployees([]);
      setLoading(false);
      try {
        const data = await fetchEmployeeCounts(agencyFetchOpts);
        if (gen !== refreshGenRef.current) return;
        setCounts(data);
        setUnregisteredCount(data.unregistered ?? 0);
      } catch {
        /* keep previous */
      }
      return;
    }

    setLoading(true);
    try {
      const [listSettled, countsSettled] = await Promise.allSettled([
        fetchEmployees({
          page: 1,
          limit: 200,
          search: debouncedSearch || undefined,
          pipelineBucket: activeTab,
          ...agencyFetchOpts,
        }),
        fetchEmployeeCounts(agencyFetchOpts),
      ]);
      if (gen !== refreshGenRef.current) return;

      let nextCounts: EmployeeCounts | null = null;
      if (countsSettled.status === 'fulfilled') {
        nextCounts = countsSettled.value;
      }

      if (listSettled.status === 'fulfilled') {
        const result = listSettled.value;
        setEmployees(result.data);
        // Trust pipeline list total for the active tab (same filters as the table).
        // Prevents “Pending Approval 0” while the Pending tab still has rows.
        if (!debouncedSearch) {
          const base = nextCounts ?? emptyCounts;
          if (activeTab === 'pending') {
            nextCounts = { ...base, pending: result.total };
          } else if (activeTab === 'master') {
            nextCounts = { ...base, master: result.total };
          } else if (activeTab === 'active') {
            nextCounts = { ...base, active: result.total };
          } else if (activeTab === 'unregistered') {
            nextCounts = { ...base, unregistered: result.total };
          }
        }
      } else {
        toast({
          title: 'Failed to load employees',
          description:
            listSettled.reason instanceof Error
              ? listSettled.reason.message
              : 'Unknown error',
          variant: 'destructive',
        });
        setEmployees([]);
      }

      if (nextCounts) {
        setCounts(nextCounts);
        setUnregisteredCount(nextCounts.unregistered ?? 0);
      }
    } finally {
      if (gen === refreshGenRef.current) setLoading(false);
    }
  }, [
    refreshDrafts,
    agencyScopeReady,
    loadExpiringCount,
    activeTab,
    debouncedSearch,
    agencyFetchOpts,
    scopeKey,
    listAgencyKey,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Stay in loading state until agency scope can be resolved (linked accounts, etc.).
  useEffect(() => {
    if (!agencyScopeReady && activeTab !== 'draft' && activeTab !== 'expiring') {
      setLoading(true);
    }
  }, [agencyScopeReady, activeTab]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (PIPELINE_TABS as string[]).includes(tab) && tab !== activeTab) {
      setActiveTab(tab as TabValue);
    }
  }, [searchParams, activeTab]);

  const handleTabChange = (v: string) => {
    const next = v as TabValue;
    setActiveTab(next);
    if (next === 'master') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  const cities = Array.from(new Set(employees.map((e) => e.city).filter(Boolean) as string[])).sort();
  const provinces = Array.from(
    new Set([
      ...CANADIAN_PROVINCES,
      ...employees.map((e) => e.province).filter(Boolean) as string[],
    ]),
  ).sort();

  const toggleFilter = (value: string, current: string[], setter: (v: string[]) => void) => {
    setter(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
    setCurrentViewId(null);
  };

  const hasActiveFilters =
    employeeTypeFilter.length > 0 ||
    availabilityFilter.length > 0 ||
    cityFilters.length > 0 ||
    provinceFilters.length > 0 ||
    specialTagFilters.length > 0;

  const clearAllFilters = () => {
    setEmployeeTypeFilter([]);
    setAvailabilityFilter([]);
    setCityFilters([]);
    setProvinceFilters([]);
    setSpecialTagFilters([]);
    setCurrentViewId(null);
  };

  const saveCurrentView = () => {
    if (!newViewName.trim()) {
      toast({ title: 'Error', description: 'Please enter a view name', variant: 'destructive' });
      return;
    }

    const newView: FilterView = {
      id: Date.now().toString(),
      name: newViewName.trim(),
      type: 'employees' as FilterView['type'],
      filters: {
        employeeTypeFilter,
        availabilityFilter,
        cityFilters,
        provinceFilters,
        specialTagFilters,
      } as FilterView['filters'],
      createdAt: new Date(),
    };

    const updatedViews = [...savedViews, newView];
    setSavedViews(updatedViews);
    localStorage.setItem('employeeViews', JSON.stringify(updatedViews));
    setCurrentViewId(newView.id);
    setIsNewViewDialogOpen(false);
    setNewViewName('');
    toast({ title: 'View saved', description: `View "${newView.name}" has been saved` });
  };

  const applyView = (viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    const filters = view.filters as Record<string, string[]>;
    setEmployeeTypeFilter(filters.employeeTypeFilter || []);
    setAvailabilityFilter(filters.availabilityFilter || []);
    setCityFilters(filters.cityFilters || []);
    setProvinceFilters(filters.provinceFilters || []);
    setSpecialTagFilters(filters.specialTagFilters || []);
    setCurrentViewId(viewId);
    toast({ title: 'View applied', description: `Filters from "${view.name}" applied` });
  };

  const deleteView = (viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId);
    const updatedViews = savedViews.filter((v) => v.id !== viewId);
    setSavedViews(updatedViews);
    localStorage.setItem('employeeViews', JSON.stringify(updatedViews));
    if (currentViewId === viewId) setCurrentViewId(null);
    toast({ title: 'View deleted', description: `View "${view?.name}" has been deleted` });
  };

  const filteredEmployees = useMemo(() => {
    let filtered = employees;

    if (employeeTypeFilter.length > 0) {
      filtered = filtered.filter((emp) => employeeTypeFilter.includes(emp.employeeType));
    }
    if (availabilityFilter.length > 0) {
      filtered = filtered.filter(
        (emp) =>
          emp.availabilityTypes?.some((t) => availabilityFilter.includes(t)) ?? false,
      );
    }
    if (cityFilters.length > 0) {
      filtered = filtered.filter((emp) => emp.city && cityFilters.includes(emp.city));
    }
    if (provinceFilters.length > 0) {
      filtered = filtered.filter((emp) => emp.province && provinceFilters.includes(emp.province));
    }
    if (specialTagFilters.length > 0) {
      filtered = filtered.filter((emp) =>
        specialTagFilters.some((tag) => (emp.specialTags ?? []).includes(tag as EmployeeTag)),
      );
    }

    return filtered;
  }, [
    employees,
    employeeTypeFilter,
    availabilityFilter,
    cityFilters,
    provinceFilters,
    specialTagFilters,
  ]);

  const handleEmployeeClick = async (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsDetailsOpen(true);
    try {
      const detail = await fetchEmployee(employee.id);
      setSelectedEmployee(detail);
    } catch {
      /* list row is enough to open */
    }
  };

  const handleExpiringEmployeeSelect = async (employeeId: string) => {
    try {
      const detail = await fetchEmployee(employeeId);
      setSelectedEmployee(detail);
      setIsDetailsOpen(true);
    } catch (err) {
      toast({
        title: 'Failed to open employee',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleExpiringCountsChange = useCallback(
    (c: { total: number; expired: number; expiring: number }) => {
      setExpiringTotal(c.total);
    },
    [],
  );

  const handleEmployeeUpdated = (updated: Employee) => {
    setSelectedEmployee(updated);

    const stillPending =
      updated.approvalStatus === 'pending' && !!updated.submitterRole;
    const stillUnreg =
      updated.approvalStatus === 'rejected' ||
      (updated.approvalStatus === 'pending' && !updated.submitterRole);

    if (activeTab === 'pending' && !stillPending) {
      setEmployees((prev) => prev.filter((e) => e.id !== updated.id));
      setCounts((c) => ({ ...c, pending: Math.max(0, c.pending - 1) }));
    } else if (activeTab === 'unregistered' && !stillUnreg) {
      setEmployees((prev) => prev.filter((e) => e.id !== updated.id));
      setUnregisteredCount((n) => Math.max(0, n - 1));
      setCounts((c) => ({
        ...c,
        unregistered: Math.max(0, (c.unregistered ?? 0) - 1),
      }));
    } else if (activeTab === 'master' && updated.approvalStatus !== 'approved') {
      setEmployees((prev) => prev.filter((e) => e.id !== updated.id));
      setCounts((c) => ({ ...c, master: Math.max(0, c.master - 1) }));
    } else {
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
    }

    void loadCounts();
    void loadExpiringCount();
  };

  const selectTab = (tab: TabValue) => {
    handleTabChange(tab);
  };

  const discardDraft = (draft: StoredDraftSummary) => {
    removeEmployeeFormDraftByKey(draft.storageKey);
    void clearDraftFiles(draft.employeeId ?? undefined);
    refreshDrafts();
    toast({ title: 'Draft discarded', description: `"${draft.name}" was removed from this device.` });
  };

  /** Master = approved without an active client placement. */
  const masterOnlyCount = counts.master;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
        </div>
        <div className="flex items-center gap-2">
          {canManageEmployees && (
            <Button onClick={() => navigate('/employees/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          )}
        </div>
      </div>

      <EmployeesScopeFilterBar />

      {/* Equal-width columns so all pipeline cards span the full page (no spare 6th slot). */}
      <div
        className={
          canManageEmployees
            ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
            : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'
        }
      >
        {canManageEmployees && (
          <Card
            className={`cursor-pointer transition-colors hover:bg-muted/40 ${
              activeTab === 'draft' ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => selectTab('draft')}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Draft</CardTitle>
              <FilePenLine className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{drafts.length}</div>
              <p className="text-xs text-muted-foreground">Saved on this device</p>
            </CardContent>
          </Card>
        )}
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            activeTab === 'unregistered' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => selectTab('unregistered')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unregistered</CardTitle>
            <UserX className="h-4 w-4 shrink-0 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{unregisteredCount}</div>
            <p className="text-xs text-muted-foreground">Rejected or not yet submitted</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            activeTab === 'pending' ? 'ring-2 ring-primary' : ''
          } ${!canSeePending ? 'opacity-60' : ''}`}
          onClick={() => canSeePending && selectTab('pending')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
            <Clock className="h-4 w-4 shrink-0 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.pending}</div>
            <p className="text-xs text-muted-foreground">Awaiting manager review</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            activeTab === 'master' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => selectTab('master')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Master</CardTitle>
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{masterOnlyCount}</div>
            <p className="text-xs text-muted-foreground">Approved, available for work</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors hover:bg-muted/40 ${
            activeTab === 'active' ? 'ring-2 ring-primary' : ''
          }`}
          onClick={() => selectTab('active')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium leading-snug">Active with Client</CardTitle>
            <UserCheck className="h-4 w-4 shrink-0 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.active}</div>
            <p className="text-xs text-muted-foreground">Currently placed</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <StickyHeader bleed={false} className="border-b-0 bg-card py-0">
                  <TabsList>
                    {canManageEmployees && (
                      <TabsTrigger value="draft">Draft ({drafts.length})</TabsTrigger>
                    )}
                    <TabsTrigger value="unregistered">Unregistered ({unregisteredCount})</TabsTrigger>
                    {canSeePending && (
                      <TabsTrigger value="pending" className="relative">
                        Pending
                        {counts.pending > 0 && (
                          <Badge variant="destructive" className="ml-2 h-5 px-1.5">
                            {counts.pending}
                          </Badge>
                        )}
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="master">Master ({masterOnlyCount})</TabsTrigger>
                    <TabsTrigger value="active">Active with Client ({counts.active})</TabsTrigger>
                    <TabsTrigger value="expiring" className="relative">
                      Expiring Docs
                      {expiringTotal > 0 && (
                        <Badge
                          variant="outline"
                          className="ml-2 h-5 px-1.5 bg-amber-50 text-amber-700 border-amber-200"
                        >
                          <AlertTriangle className="h-3 w-3 mr-0.5" />
                          {expiringTotal}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </StickyHeader>
              </Tabs>
              <div className="relative w-full lg:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Type {employeeTypeFilter.length > 0 && `(${employeeTypeFilter.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-3" align="start">
                  <div className="space-y-2">
                    {['internal', 'external'].map((type) => (
                      <div key={type} className="flex items-center space-x-2">
                        <Checkbox
                          id={`type-${type}`}
                          checked={employeeTypeFilter.includes(type)}
                          onCheckedChange={() =>
                            toggleFilter(type, employeeTypeFilter, setEmployeeTypeFilter)
                          }
                        />
                        <label htmlFor={`type-${type}`} className="text-sm capitalize cursor-pointer">
                          {type}
                        </label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Availability {availabilityFilter.length > 0 && `(${availabilityFilter.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-3" align="start">
                  <div className="space-y-2">
                    {([
                      { value: 'full_time', label: 'Full Time' },
                      { value: 'part_time', label: 'Part Time' },
                    ] as { value: AvailabilityType; label: string }[]).map((opt) => (
                      <div key={opt.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`availability-${opt.value}`}
                          checked={availabilityFilter.includes(opt.value)}
                          onCheckedChange={() =>
                            toggleFilter(opt.value, availabilityFilter, setAvailabilityFilter)
                          }
                        />
                        <label
                          htmlFor={`availability-${opt.value}`}
                          className="text-sm cursor-pointer"
                        >
                          {opt.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    City {cityFilters.length > 0 && `(${cityFilters.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3 max-h-64 overflow-y-auto" align="start">
                  <div className="space-y-2">
                    {cities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No cities in this list yet</p>
                    ) : (
                      cities.map((city) => (
                        <div key={city} className="flex items-center space-x-2">
                          <Checkbox
                            id={`city-${city}`}
                            checked={cityFilters.includes(city)}
                            onCheckedChange={() => toggleFilter(city, cityFilters, setCityFilters)}
                          />
                          <label htmlFor={`city-${city}`} className="text-sm cursor-pointer">
                            {city}
                          </label>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Province {provinceFilters.length > 0 && `(${provinceFilters.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-3 max-h-64 overflow-y-auto" align="start">
                  <div className="space-y-2">
                    {provinces.map((province) => (
                      <div key={province} className="flex items-center space-x-2">
                        <Checkbox
                          id={`province-${province}`}
                          checked={provinceFilters.includes(province)}
                          onCheckedChange={() =>
                            toggleFilter(province, provinceFilters, setProvinceFilters)
                          }
                        />
                        <label htmlFor={`province-${province}`} className="text-sm cursor-pointer">
                          {province}
                        </label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Tags {specialTagFilters.length > 0 && `(${specialTagFilters.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-3" align="start">
                  <div className="space-y-2">
                    {SPECIAL_TAG_OPTIONS.map((tag) => (
                      <div key={tag.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`tag-${tag.value}`}
                          checked={specialTagFilters.includes(tag.value)}
                          onCheckedChange={() =>
                            toggleFilter(tag.value, specialTagFilters, setSpecialTagFilters)
                          }
                        />
                        <label htmlFor={`tag-${tag.value}`} className="text-sm cursor-pointer">
                          {tag.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Select
                value={currentViewId || 'default'}
                onValueChange={(value) => {
                  if (value === 'default') clearAllFilters();
                  else applyView(value);
                }}
              >
                <SelectTrigger className="w-48">
                  <Eye className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Select View" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">All (Default)</SelectItem>
                  {savedViews.map((view) => (
                    <SelectItem key={view.id} value={view.id}>
                      {view.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Dialog open={isNewViewDialogOpen} onOpenChange={setIsNewViewDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Save className="h-4 w-4 mr-2" />
                      Save View
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Save Current View</DialogTitle>
                      <DialogDescription>Save your current filter settings as a view</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="view-name">View Name</Label>
                        <Input
                          id="view-name"
                          placeholder="e.g., Toronto Operators"
                          value={newViewName}
                          onChange={(e) => setNewViewName(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsNewViewDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={saveCurrentView}>Save View</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {savedViews.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Eye className="h-4 w-4 mr-2" />
                      Manage ({savedViews.length})
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="start">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm mb-2">Saved Views</h4>
                      {savedViews.map((view) => (
                        <div
                          key={view.id}
                          className="flex items-center justify-between p-2 hover:bg-accent rounded"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium">{view.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(view.createdAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => deleteView(view.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                  <X className="h-4 w-4 mr-1" />
                  Clear Filters
                </Button>
              )}
            </div>

            {hasActiveFilters && (
              <div className="flex flex-wrap gap-1.5">
                {employeeTypeFilter.map((type) => (
                  <Badge key={`type-${type}`} variant="secondary" className="gap-1 capitalize">
                    {type}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:bg-muted"
                      onClick={() => toggleFilter(type, employeeTypeFilter, setEmployeeTypeFilter)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {availabilityFilter.map((availability) => (
                  <Badge key={`availability-${availability}`} variant="secondary" className="gap-1">
                    {availability === 'full_time' ? 'Full Time' : 'Part Time'}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:bg-muted"
                      onClick={() =>
                        toggleFilter(availability, availabilityFilter, setAvailabilityFilter)
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {cityFilters.map((city) => (
                  <Badge key={`city-${city}`} variant="secondary" className="gap-1">
                    {city}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:bg-muted"
                      onClick={() => toggleFilter(city, cityFilters, setCityFilters)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {provinceFilters.map((province) => (
                  <Badge key={`province-${province}`} variant="secondary" className="gap-1">
                    {province}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:bg-muted"
                      onClick={() => toggleFilter(province, provinceFilters, setProvinceFilters)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {specialTagFilters.map((tag) => (
                  <Badge key={`tag-${tag}`} variant="secondary" className="gap-1">
                    {SPECIAL_TAG_OPTIONS.find((t) => t.value === tag)?.label ?? tag}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:bg-muted"
                      onClick={() => toggleFilter(tag, specialTagFilters, setSpecialTagFilters)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === 'draft' ? (
            <EmployeeDraftsTab drafts={drafts} onDiscard={discardDraft} />
          ) : activeTab === 'expiring' ? (
            <EmployeeExpiringDocsTab
              onSelectEmployee={handleExpiringEmployeeSelect}
              onCountsChange={handleExpiringCountsChange}
            />
          ) : loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading employees…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Availability</TableHead>
                  {(activeTab === 'pending' || activeTab === 'unregistered') && (
                    <TableHead>Status</TableHead>
                  )}
                  {activeTab === 'active' && <TableHead>Client</TableHead>}
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={
                        activeTab === 'active' ||
                        activeTab === 'pending' ||
                        activeTab === 'unregistered'
                          ? 8
                          : 7
                      }
                      className="text-center py-8 text-muted-foreground"
                    >
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((employee) => (
                    <TableRow
                      key={employee.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleEmployeeClick(employee)}
                    >
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {employee.firstName} {employee.lastName}
                          </div>
                          <EmployeeSpecialTags tags={employee.specialTags ?? []} />
                          {activeTab === 'active' && employee.clientTrainingPending && (
                            <span className="mt-1 inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              Training pending
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={employee.employeeType === 'internal' ? 'default' : 'secondary'}
                        >
                          {employee.employeeType === 'internal' ? 'Internal' : 'External'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{employee.email || '-'}</div>
                          <div className="text-muted-foreground">{employee.phone || '-'}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {[employee.city, employee.province].filter(Boolean).join(', ') || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {(employee.availabilityTypes ?? [])
                            .map((t) =>
                              t === 'full_time' ? 'Full Time' : t === 'part_time' ? 'Part Time' : t,
                            )
                            .join(', ') || '-'}
                        </div>
                      </TableCell>
                      {(activeTab === 'pending' || activeTab === 'unregistered') && (
                        <TableCell className="w-[1%] whitespace-nowrap align-top">
                          <div
                            className={
                              activeTab === 'pending'
                                ? `flex ${EMPLOYEE_PENDING_STATUS_CHIP_WIDTH} flex-col items-stretch gap-1`
                                : 'flex w-max flex-col items-start gap-1'
                            }
                          >
                            <EmployeeStatusBadge
                              approvalStatus={employee.approvalStatus}
                              className={activeTab === 'pending' ? 'w-full' : undefined}
                            />
                            {activeTab === 'pending' && (
                              <EmployeePendingReadinessBadges
                                employee={employee}
                                onOpenTraining={
                                  canManageEmployees
                                    ? () => {
                                        setTrainingEmployee(employee);
                                        setIsTrainingOpen(true);
                                      }
                                    : undefined
                                }
                              />
                            )}
                            {activeTab === 'unregistered' && employee.rejectionReason && (
                              <p className="max-w-[180px] whitespace-normal text-xs text-muted-foreground line-clamp-2">
                                {employee.rejectionReason}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      )}
                      {activeTab === 'active' && (
                        <TableCell>
                          <div className="text-sm">
                            {employee.activeClientName ||
                              employee.assignedClientName ||
                              '—'}
                          </div>
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(employee.createdAt), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canAccessEmployeeActions && (
                            <>
                              {employee.phone?.trim() && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCallingEmployee(employee);
                                    openCallInterface();
                                  }}
                                >
                                  <PhoneCall className="h-4 w-4" />
                                </Button>
                              )}
                              {employee.email?.trim() && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEmailingEmployee(employee);
                                    setIsEmailOpen(true);
                                  }}
                                >
                                  <Mail className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFollowUpEmployee(employee);
                                  setIsFollowUpOpen(true);
                                }}
                              >
                                <Calendar className="h-4 w-4" />
                              </Button>
                              {activeTab === 'master' &&
                                canManageEmployees &&
                                !employee.specialTags?.includes('blacklisted') && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Link to Client & Job"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLinkEmployee(employee);
                                      setIsLinkOpen(true);
                                    }}
                                  >
                                    <Link2 className="h-4 w-4" />
                                  </Button>
                                )}
                            </>
                          )}
                          {(activeTab === 'master' || activeTab === 'pending') &&
                            (canManageEmployees || canApproveEmployees || canReadEmployees) &&
                            !employee.specialTags?.includes('blacklisted') && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 px-2 text-xs"
                                title="Employee training — open, resend, upload"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTrainingEmployee(employee);
                                  setIsTrainingOpen(true);
                                }}
                              >
                                <GraduationCap className="h-3.5 w-3.5" />
                                Training
                              </Button>
                            )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEmployeeClick(employee);
                                }}
                              >
                                View Details
                              </DropdownMenuItem>
                              {activeTab === 'master' &&
                                canManageEmployees &&
                                !employee.specialTags?.includes('blacklisted') && (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLinkEmployee(employee);
                                      setIsLinkOpen(true);
                                    }}
                                  >
                                    Link to Client & Job
                                  </DropdownMenuItem>
                                )}
                              {(activeTab === 'master' || activeTab === 'pending') &&
                                (canManageEmployees || canApproveEmployees || canReadEmployees) &&
                                !employee.specialTags?.includes('blacklisted') && (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTrainingEmployee(employee);
                                      setIsTrainingOpen(true);
                                    }}
                                  >
                                    Training
                                  </DropdownMenuItem>
                                )}
                              {canManageEmployees && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/employees/${employee.id}/edit`);
                                  }}
                                >
                                  Edit
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      <EmployeeDetailsSheet
        employee={selectedEmployee}
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        onUpdated={handleEmployeeUpdated}
        onListRefresh={refresh}
      />

      <LinkClientJobDialog
        employee={linkEmployee}
        open={isLinkOpen}
        onOpenChange={(open) => {
          setIsLinkOpen(open);
          if (!open) setLinkEmployee(null);
        }}
        onChanged={() => {
          void refresh();
          if (linkEmployee) {
            void fetchEmployee(linkEmployee.id).then((updated) => {
              setLinkEmployee(updated);
              handleEmployeeUpdated(updated);
            });
          }
        }}
      />

      <EmployeeTrainingDialog
        employee={trainingEmployee}
        open={isTrainingOpen}
        onOpenChange={(open) => {
          setIsTrainingOpen(open);
          if (!open) setTrainingEmployee(null);
        }}
        onChanged={() => {
          void refresh();
          if (trainingEmployee) {
            void fetchEmployee(trainingEmployee.id).then((updated) => {
              setTrainingEmployee(updated);
              handleEmployeeUpdated(updated);
            });
          }
        }}
      />

      {(callingEmployee || activeCall?.employee) && isCallInterfaceOpen && !isMinimized && (
        <EmployeeCallInterface
          employee={callingEmployee ?? (activeCall!.employee as Employee)}
          subCompanyId={writeAgencyId}
          open={isCallInterfaceOpen && !isMinimized}
          onOpenChange={(open) => {
            if (!open) {
              // Keep callingEmployee while a live call is minimized so the bubble can restore UI
              if (!activeCall || activeCall.status === 'ended') {
                setCallingEmployee(null);
              }
            }
          }}
        />
      )}

      <EmailComposeDialog
        open={isEmailOpen}
        onOpenChange={(open) => {
          setIsEmailOpen(open);
          if (!open) setEmailingEmployee(null);
        }}
        fixedRecipient={
          emailingEmployee?.email
            ? {
                email: emailingEmployee.email,
                name: `${emailingEmployee.firstName} ${emailingEmployee.lastName}`.trim(),
              }
            : null
        }
        selectedAgencyId={writeAgencyId}
      />

      {followUpEmployee && (
        <EmployeeFollowUpDialog
          open={isFollowUpOpen}
          onOpenChange={(open) => {
            setIsFollowUpOpen(open);
            if (!open) setFollowUpEmployee(null);
          }}
          employeeId={followUpEmployee.id}
          employeeName={`${followUpEmployee.firstName} ${followUpEmployee.lastName}`.trim()}
          subCompanyId={writeAgencyId}
        />
      )}
    </div>
  );
}
