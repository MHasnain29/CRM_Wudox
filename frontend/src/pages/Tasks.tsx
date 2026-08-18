import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Plus, CheckCircle2, Clock, AlertCircle, Trash2, Loader2, ChevronDown, ChevronUp, TrendingUp, FolderKanban } from 'lucide-react';
import { useClientPagination, SectionPaginationBar } from '@/components/SectionPagination';
import { useStore } from '@/lib/store';
import { format, isBefore, isToday } from 'date-fns';
import { TaskPriority, TaskStatus, Task } from '@/lib/types';
import { TaskDetailDialog } from '@/components/TaskDetailDialog';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { fetchTasks, fetchTaskById, deleteTaskApi, mapApiTaskToTask, fetchUsers, apiFetch, type ApiUser } from '@/lib/api';
import { getUserRoleTitle } from '@/lib/roleLabels';
import { cn } from '@/lib/utils';
import { onTaskComment, onTaskRefresh } from '@/lib/socket';
import { toast } from 'sonner';
import { UserMultiSelect } from '@/components/UserMultiSelect';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { PersonSectionHeader, PersonCardIdentity } from '@/components/PersonSectionHeader';
import {
  useCanViewTeamScope,
  useCanWriteTasks,
  useHasPermission,
  useIsOwnScope,
} from '@/lib/access';
import { useAuthStore } from '@/lib/authStore';

const SOFTWARE_ROLES = new Set([
  'cto', 'project_manager', 'scrum_master', 'team_lead',
  'developer', 'qa_engineer', 'ui_ux_designer',
  'business_analyst', 'devops_engineer', 'hr', 'finance',
]);

const priorityColors: Record<TaskPriority, string> = {
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const statusIcons: Record<TaskStatus, any> = {
  to_do: Clock,
  in_progress: AlertCircle,
  done: CheckCircle2,
};

const statusColors: Record<TaskStatus, string> = {
  to_do: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
};

// ─── Palette: one colour per agency section (cycles) ────────────────────────
const AGENCY_PALETTE = [
  { bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-600',    accent: 'bg-blue-500'    },
  { bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  text: 'text-purple-600',  accent: 'bg-purple-500'  },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-600', accent: 'bg-emerald-500' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  text: 'text-orange-600',  accent: 'bg-orange-500'  },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-600',    accent: 'bg-cyan-500'    },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    text: 'text-rose-600',    accent: 'bg-rose-500'    },
];

// ─── Per-user task section card (manager "All Team" view) ────────────────────
function UserTasksSection({
  user,
  colorIndex,
  onViewTasks,
}: {
  user: ApiUser;
  colorIndex: number;
  onViewTasks: () => void;
}) {
  const color = AGENCY_PALETTE[colorIndex % AGENCY_PALETTE.length];
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const initials = fullName.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['user-tasks-section', user.id],
    queryFn: () => fetchTasks({ ownerIds: [user.id], limit: 500, includeProjectTasks: true }),
    staleTime: 0,
    retry: false,
  });

  useEffect(() => {
    return onTaskRefresh(() => { void refetch(); });
  }, [refetch]);

  const userTasks = useMemo(() =>
    (tasksData?.data ?? []).map(mapApiTaskToTask).filter(t => t.ownerId === user.id),
    [tasksData, user.id]
  );
  const openCount = userTasks.filter(t => t.status !== 'done').length;
  const overdueCount = userTasks.filter(t => t.status !== 'done' && isBefore(new Date(t.dueDate), new Date())).length;
  const doneCount = userTasks.filter(t => t.status === 'done').length;

  return (
    <Card className={cn('border overflow-hidden', color.border)}>
      <div className={cn('flex items-center justify-between px-5 py-4', color.bg)}>
        <PersonCardIdentity
          user={user}
          roleTitle={getUserRoleTitle(user)}
          subtitle={`${userTasks.length} task${userTasks.length !== 1 ? 's' : ''}`}
          accentClassName={color.accent}
        />
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className={cn('px-2 py-1 rounded-full font-medium border', color.bg, color.text, color.border)}>{openCount} open</span>
            {overdueCount > 0 && <span className="px-2 py-1 rounded-full font-medium bg-red-500/10 text-red-600 border border-red-500/20">{overdueCount} overdue</span>}
            <span className="px-2 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">{doneCount} done</span>
          </div>
          <Button size="sm" variant="outline" className={cn('gap-1.5 text-xs shrink-0', color.border)} onClick={onViewTasks}>
            View Tasks <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading tasks...</span>
          </div>
        ) : userTasks.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">No tasks assigned</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'To Do',       count: userTasks.filter(t => t.status === 'to_do').length,       cls: 'bg-gray-500/10 text-gray-600 border-gray-500/20' },
              { label: 'In Progress', count: userTasks.filter(t => t.status === 'in_progress').length, cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
              { label: 'Done',        count: doneCount,                                                 cls: 'bg-green-500/10 text-green-600 border-green-500/20' },
              { label: 'Overdue',     count: overdueCount,                                              cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
            ].map(s => (
              <div key={s.label} className={cn('flex items-center gap-1.5 rounded-lg px-3 py-2 min-w-[80px] border', s.cls)}>
                <div>
                  <p className="text-xs font-bold leading-tight">{s.count}</p>
                  <p className="text-[10px] leading-tight">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Per-agency task section (full table, rendered for each agency in "All" view) ───
function AgencyTasksSection({
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
  const { currentUser, leads, clients, meetings } = useStore();
  const { id: effectiveUserId } = useEffectiveUser();
  const canViewTeam = useCanViewTeamScope();
  const isOwnScope = useIsOwnScope();
  const isManager = canViewTeam;
  const canWriteTasks = useCanWriteTasks();

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all_open');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['agency-tasks-section', agency.id, scopeKey],
    queryFn: () => fetchTasks({ subCompanyId: agency.id, ownerIds, limit: 500, includeProjectTasks: true }),
    staleTime: 0,
  });

  const allTasks = useMemo(() => (tasksData?.data ?? []).map(mapApiTaskToTask), [tasksData]);

  const filteredTasks = useMemo(() => allTasks.filter(task => {
    if (search && !task.title.toLowerCase().includes(search.toLowerCase()) &&
        !task.ownerName.toLowerCase().includes(search.toLowerCase())) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (statusFilter === 'all_open' && task.status === 'done') return false;
    if (statusFilter !== 'all' && statusFilter !== 'all_open' && task.status !== statusFilter) return false;
    return true;
  }), [allTasks, search, priorityFilter, statusFilter]);

  const {
    pageRows,
    startIndex,
    total,
    totalPages,
    page,
    setPage,
    pageSize,
    showPagination,
  } = useClientPagination(filteredTasks, [agency.id, search, priorityFilter, statusFilter]);

  const getLinkedItemName = (task: Task) => {
    if (!task.linkType || !task.linkId) return null;
    switch (task.linkType) {
      case 'lead': {
        const lead = leads.find(l => l.id === task.linkId);
        return lead ? clients.find(c => c.id === lead.clientId)?.name : null;
      }
      case 'client': return clients.find(c => c.id === task.linkId)?.name ?? null;
      case 'meeting': return meetings.find(m => m.id === task.linkId)?.title ?? null;
    }
    return null;
  };

  const isOverdue = (task: Task) => task.status !== 'done' && isBefore(new Date(task.dueDate), new Date());

  const canDelete = (task: Task) => {
    if (!canWriteTasks) return false;
    if (isOwnScope) return false;
    return isManager || task.ownerId === effectiveUserId;
  };

  const handleDelete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteTaskApi(taskId);
      refetch();
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  return (
    <>
      <Card className="border overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-b shrink-0">
          <h2 className="font-semibold text-base">{agency.name}</h2>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onViewAgency}>
            View Agency <TrendingUp className="h-3 w-3" />
          </Button>
        </div>
        <CardContent className="flex-1 overflow-hidden flex flex-col pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading tasks...</span>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="flex gap-2 flex-wrap items-center mb-3 shrink-0">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search tasks or assignee..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_open">All Open</SelectItem>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="to_do">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground ml-auto">{filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}</span>
              </div>
              {/* Scrollable table */}
              <div className="overflow-y-auto flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Assigned To</TableHead>
                      <TableHead>Assigned By</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No tasks found</TableCell>
                      </TableRow>
                    ) : pageRows.map(task => {
                      const StatusIcon = statusIcons[task.status];
                      const linkedItem = getLinkedItemName(task);
                      const taskIsOverdue = isOverdue(task);
                      return (
                        <TableRow
                          key={task.id}
                          className={`cursor-pointer hover:bg-muted/30 transition-colors ${task.status === 'done' ? 'opacity-60' : ''}`}
                          onClick={() => { setSelectedTask(task); setIsTaskDialogOpen(true); }}
                        >
                          <TableCell className="max-w-xs w-64">
                            <div className="min-w-0">
                              <div className="font-medium truncate">{task.title}</div>
                              {task.forwardedFromName && <ForwardedChip name={task.forwardedFromName} />}
                              {task.description && (
                                <div className="text-sm text-muted-foreground mt-1 line-clamp-2 break-words">{task.description}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell><div className="text-sm font-medium">{task.ownerName}</div></TableCell>
                          <TableCell><div className="text-sm">{task.assignedByName}</div></TableCell>
                          <TableCell>
                            <Badge className={priorityColors[task.priority]} variant="secondary">{task.priority}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${statusColors[task.status]} flex items-center gap-1.5 w-fit`} variant="secondary">
                              <StatusIcon className="h-3.5 w-3.5" />
                              <span className="capitalize text-xs font-medium">{task.status.replace('_', ' ')}</span>
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className={taskIsOverdue ? 'text-destructive font-medium' : ''}>
                              {format(new Date(task.dueDate), 'MMM d, yyyy h:mm a')}
                            </div>
                            {taskIsOverdue && <Badge variant="destructive" className="mt-1 text-xs">Overdue</Badge>}
                          </TableCell>
                          <TableCell>
                            {linkedItem ? <div className="text-sm font-medium">{linkedItem}</div> : <span className="text-muted-foreground text-sm">-</span>}
                          </TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            {canDelete(task) && (
                              <Button size="sm" variant="ghost" onClick={e => handleDelete(task.id, e)} className="h-8 w-8 p-0">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
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
            </>
          )}
        </CardContent>
      </Card>
      <TaskDetailDialog
        task={selectedTask}
        open={isTaskDialogOpen}
        onOpenChange={(open) => { setIsTaskDialogOpen(open); if (!open) setSelectedTask(null); }}
      />
    </>
  );
}

// ─── Combined All-Team task table (manager "All Team" view) ─────────────────
function TeamTasksSection({ teamUsers }: { teamUsers: ApiUser[] }) {
  const PAGE_SIZE = 10;
  const { currentUser, leads, clients, meetings } = useStore();
  const { id: effectiveUserId } = useEffectiveUser();
  const canViewTeam = useCanViewTeamScope();
  const isOwnScope = useIsOwnScope();
  const isManager = canViewTeam;
  const canWriteTasks = useCanWriteTasks();

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all_open');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [page, setPage] = useState(1);

  const ownerIds = useMemo(() => teamUsers.map(u => u.id), [teamUsers]);

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ['team-tasks-section', ownerIds.join(',')],
    queryFn: () => fetchTasks({ ownerIds, limit: 500, includeProjectTasks: true }),
    staleTime: 0,
    enabled: ownerIds.length > 0,
  });

  useEffect(() => {
    return onTaskRefresh(() => { void refetch(); });
  }, [refetch]);

  const allTasks = useMemo(() => (tasksData?.data ?? []).map(mapApiTaskToTask), [tasksData]);

  const filteredTasks = useMemo(() => allTasks.filter(task => {
    if (search && !task.title.toLowerCase().includes(search.toLowerCase()) &&
        !task.ownerName.toLowerCase().includes(search.toLowerCase())) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (statusFilter === 'all_open' && task.status === 'done') return false;
    if (statusFilter !== 'all' && statusFilter !== 'all_open' && task.status !== statusFilter) return false;
    return true;
  }), [allTasks, search, priorityFilter, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [ownerIds.join(','), search, priorityFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = filteredTasks.slice(startIndex, startIndex + PAGE_SIZE);

  const getLinkedItemName = (task: Task) => {
    if (!task.linkType || !task.linkId) return null;
    switch (task.linkType) {
      case 'lead': {
        const lead = leads.find(l => l.id === task.linkId);
        return lead ? clients.find(c => c.id === lead.clientId)?.name : null;
      }
      case 'client': return clients.find(c => c.id === task.linkId)?.name ?? null;
      case 'meeting': return meetings.find(m => m.id === task.linkId)?.title ?? null;
    }
    return null;
  };

  const isOverdue = (task: Task) => task.status !== 'done' && isBefore(new Date(task.dueDate), new Date());

  const canDelete = (task: Task) => {
    if (!canWriteTasks) return false;
    if (isOwnScope) return false;
    return isManager || task.ownerId === effectiveUserId;
  };

  const handleDelete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteTaskApi(taskId);
      refetch();
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  return (
    <>
      <Card className="border overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <CardContent className="flex-1 overflow-hidden flex flex-col pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading tasks...</span>
            </div>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap items-center mb-3 shrink-0">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search tasks or assignee..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_open">All Open</SelectItem>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="to_do">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground ml-auto">{filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-y-auto flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Assigned To</TableHead>
                      <TableHead>Assigned By</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No tasks found</TableCell>
                      </TableRow>
                    ) : pageRows.map(task => {
                      const StatusIcon = statusIcons[task.status];
                      const linkedItem = getLinkedItemName(task);
                      const taskIsOverdue = isOverdue(task);
                      return (
                        <TableRow
                          key={task.id}
                          className={`cursor-pointer hover:bg-muted/30 transition-colors ${task.status === 'done' ? 'opacity-60' : ''}`}
                          onClick={() => { setSelectedTask(task); setIsTaskDialogOpen(true); }}
                        >
                          <TableCell className="max-w-xs w-64">
                            <div className="min-w-0">
                              <div className="font-medium truncate">{task.title}</div>
                              {task.forwardedFromName && <ForwardedChip name={task.forwardedFromName} />}
                              {task.description && (
                                <div className="text-sm text-muted-foreground mt-1 line-clamp-2 break-words">{task.description}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell><div className="text-sm font-medium">{task.ownerName}</div></TableCell>
                          <TableCell><div className="text-sm">{task.assignedByName}</div></TableCell>
                          <TableCell>
                            <Badge className={priorityColors[task.priority]} variant="secondary">{task.priority}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${statusColors[task.status]} flex items-center gap-1.5 w-fit`} variant="secondary">
                              <StatusIcon className="h-3.5 w-3.5" />
                              <span className="capitalize text-xs font-medium">{task.status.replace('_', ' ')}</span>
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className={taskIsOverdue ? 'text-destructive font-medium' : ''}>
                              {format(new Date(task.dueDate), 'MMM d, yyyy h:mm a')}
                            </div>
                            {taskIsOverdue && <Badge variant="destructive" className="mt-1 text-xs">Overdue</Badge>}
                          </TableCell>
                          <TableCell>
                            {linkedItem ? <div className="text-sm font-medium">{linkedItem}</div> : <span className="text-muted-foreground text-sm">-</span>}
                          </TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            {canDelete(task) && (
                              <Button size="sm" variant="ghost" onClick={e => handleDelete(task.id, e)} className="h-8 w-8 p-0">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {filteredTasks.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-3 mt-2 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, filteredTasks.length)} of {filteredTasks.length}
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
            </>
          )}
        </CardContent>
      </Card>
      <TaskDetailDialog
        task={selectedTask}
        open={isTaskDialogOpen}
        onOpenChange={(open) => { setIsTaskDialogOpen(open); if (!open) setSelectedTask(null); }}
      />
    </>
  );
}

export default function Tasks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tasks, setTasks, currentUser, currentSubCompany, leads, clients, meetings, followUps, updateTask, refreshTasksTrigger } = useStore();
  const { id: effectiveUserId } = useEffectiveUser();
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all_open');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const loadCounterRef = useRef(0);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isSoftwareRole = SOFTWARE_ROLES.has(user?.role ?? '');
  const [projectFilter, setProjectFilter] = useState('all');
  const [projects, setProjects] = useState<{id: string; name: string}[]>([]);

  const agencyId = currentSubCompany?.id ?? currentUser.subCompanyId;

  useEffect(() => {
    if (!isSoftwareRole) return;
    apiFetch('/projects').then(res => {
      if (res.ok) setProjects((res.data as any).data ?? []);
    }).catch(() => {});
  }, [isSoftwareRole]);

  const canViewTeam = useCanViewTeamScope();
  const isOwnScope = useIsOwnScope();
  const canWriteTasks = useCanWriteTasks();
  const isManager = canViewTeam;
  const isAssociate = isOwnScope;

  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    agencies,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedManagerId,
    setSelectedUserId,
    onlyMe,
    getAssociatesForManager,
    getUsersForLeader,
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
  } = scopeFilter;

  const writeAgencyId = useWriteAgencyId(
    isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? selectedAgencyId : agencyId,
  );

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);
  const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';

  const openTaskId = searchParams.get('openTask');

  useEffect(() => {
    if (!openTaskId || tasksLoading) return;
    // Always fetch fresh data from API so comments are up-to-date
    fetchTaskById(openTaskId).then((api) => {
      if (!api) {
        // Fallback to local list if API fetch fails
        const fromList = tasks.find((t) => t.id === openTaskId);
        if (fromList) {
          setSelectedTask(fromList);
          setIsCreateMode(false);
          setIsTaskDialogOpen(true);
        }
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('openTask');
          return next;
        }, { replace: true });
        return;
      }
      const task = mapApiTaskToTask(api);
      setSelectedTask(task);
      setTasks(tasks.some((t) => t.id === task.id) ? tasks.map((t) => (t.id === task.id ? task : t)) : [...tasks, task]);
      setIsCreateMode(false);
      setIsTaskDialogOpen(true);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('openTask');
        return next;
      }, { replace: true });
    }).catch(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('openTask');
        return next;
      }, { replace: true });
    });
  }, [openTaskId, tasksLoading, tasks, setTasks, setSearchParams]);

  const loadTasks = useCallback(async () => {
    if (!agencyId) return;
    // "All Agencies" view — per-section components handle fetching (only when toggle active)
    if (showAgencySections || showAllTeamView) { setTasksLoading(false); return; }
    // "All Team" view — per-user cards handle fetching (only when toggle active)
    if (showAllTeamView) { setTasksLoading(false); return; }
    const counter = ++loadCounterRef.current;
    setTasksLoading(true);
    try {
      const ownerIds = elevatedOwnerIds;
      // Manager selected with no associates — skip fetch, show empty state immediately
      if (ownerIds !== undefined && ownerIds.length === 0) {
        if (counter === loadCounterRef.current) { setTasks([]); setTasksLoading(false); }
        return;
      }
      const { data } = await fetchTasks({
        subCompanyId: linkedUserIdParam
          ? undefined
          : isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
            ? selectedAgencyId
            : (isElevated ? undefined : agencyId),
        ownerIds,
        limit: 500,
        includeProjectTasks: true,
        ...(projectFilter !== 'all' ? { projectId: projectFilter } : {}),
      });
      if (counter !== loadCounterRef.current) return; // stale response — a newer call is in-flight
      const mapped = data.map((api) => mapApiTaskToTask(api));
      setTasks(mapped);
    } catch {
      if (counter !== loadCounterRef.current) return;
      toast.error('Failed to load tasks');
      setTasks([]);
    } finally {
      if (counter === loadCounterRef.current) setTasksLoading(false);
    }
  }, [agencyId, isElevated, isPureManager, isManager, showAllTeamView, selectedAgencyId, setTasks, currentUser?.id, elevatedOwnerIds, linkedUserIdParam, projectFilter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Re-run loadTasks when agencyId becomes available (store hydrates after mount)
  useEffect(() => {
    if (agencyId) loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  // Auto-refresh: re-run loadTasks when a task:refresh socket event fires (counter increments)
  useEffect(() => {
    if (refreshTasksTrigger === 0) return; // skip the initial mount (loadTasks already runs above)
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTasksTrigger]);

  // Keep selected task in sync with store (e.g. after adding a comment) so the dialog shows the latest without refresh
  useEffect(() => {
    if (!selectedTask?.id) return;
    const fromStore = tasks.find((t) => t.id === selectedTask.id);
    if (fromStore) setSelectedTask(fromStore);
  }, [tasks, selectedTask?.id]);

  // Real-time: when someone else adds a comment to a task, append it so the other user sees it without refresh
  useEffect(() => {
    const unsub = onTaskComment((payload) => {
      const state = useStore.getState();
      const task = state.tasks.find((t) => t.id === payload.taskId);
      if (!task) return;
      const newComment = {
        id: payload.comment.id,
        taskId: payload.comment.taskId,
        userId: payload.comment.userId,
        userName: payload.comment.userName,
        content: payload.comment.content,
        createdAt: new Date(payload.comment.createdAt),
      };
      const existingComments = Array.isArray(task.comments) ? task.comments : [];
      state.updateTask(payload.taskId, {
        comments: [...existingComments, newComment],
      });
    });
    return unsub;
  }, []);

  // When a linked user filter is active, backend already scoped correctly — show all returned tasks
  const linkedFilterActive = !!linkedUserIdParam && linkedUserIdParam.split(',').some(id => id !== currentUser?.id);

  const visibleTasks = tasks.filter(task => {
    if (linkedFilterActive) return true;
    if (isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me') return task.subCompanyId === selectedAgencyId;
    if (isPureManager && selectedUserId !== 'all') return task.ownerId === selectedUserId;
    if (isManager) return task.subCompanyId === agencyId;
    return task.ownerId === effectiveUserId;
  });

  // Apply filters
  const filteredTasks = visibleTasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
    
    let matchesStatus = true;
    if (statusFilter === 'all_open') {
      matchesStatus = task.status !== 'done';
    } else if (statusFilter !== 'all') {
      matchesStatus = task.status === statusFilter;
    }
    
    let matchesOwner = true;
    if (ownerFilter === 'my_tasks') {
      matchesOwner = task.ownerId === currentUser.id;
    } else if (ownerFilter === 'assigned_by_me') {
      matchesOwner = task.assignedById === currentUser.id && task.ownerId !== currentUser.id;
    } else if (ownerFilter === 'assigned_to_me') {
      matchesOwner = task.ownerId === currentUser.id && task.assignedById !== currentUser.id;
    }

    return matchesSearch && matchesPriority && matchesStatus && matchesOwner;
  });

  // Calculate stats
  const overdueCount = visibleTasks.filter(t => 
    t.status !== 'done' && isBefore(new Date(t.dueDate), new Date())
  ).length;
  const todayCount = visibleTasks.filter(t => 
    t.status !== 'done' && isToday(new Date(t.dueDate))
  ).length;
  const completedCount = visibleTasks.filter(t => t.status === 'done').length;

  const handleDelete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteTaskApi(taskId);
      setTasks(tasks.filter((t) => t.id !== taskId));
      if (selectedTask?.id === taskId) {
        setSelectedTask(null);
        setIsTaskDialogOpen(false);
      }
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  const handleRowClick = (task: Task) => {
    setSelectedTask(task);
    setIsCreateMode(false);
    setIsTaskDialogOpen(true);
  };

  const getLinkedItemName = (task: typeof tasks[0]) => {
    if (!task.linkType || !task.linkId) return null;

    switch (task.linkType) {
      case 'client':
        return task.linkedClient?.name ?? clients.find(c => c.id === task.linkId)?.name ?? null;
      case 'lead':
        return task.linkedLead?.clientName ?? (() => {
          const lead = leads.find(l => l.id === task.linkId);
          if (lead) return clients.find(c => c.id === lead.clientId)?.name ?? null;
          return null;
        })();
      case 'meeting':
        return meetings.find(m => m.id === task.linkId)?.title ?? null;
      case 'follow_up': {
        const followUp = followUps.find(f => f.id === task.linkId);
        return followUp ? (clients.find(c => c.id === followUp.clientId)?.name ?? null) : null;
      }
    }
    return null;
  };

  const isOverdue = (task: typeof tasks[0]) => {
    return task.status !== 'done' && isBefore(new Date(task.dueDate), new Date());
  };

  const canEdit = (task: typeof tasks[0]) => {
    if (!canWriteTasks) return false;
    return isManager || task.ownerId === effectiveUserId;
  };

  const canDelete = (task: typeof tasks[0]) => {
    if (!canWriteTasks) return false;
    if (isOwnScope) return false;
    return canEdit(task);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Tasks</h1>
          <p className="text-muted-foreground mt-1">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canWriteTasks && (
          <Button className="gap-2" onClick={() => { setSelectedTask(null); setIsCreateMode(true); setIsTaskDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            Create Task
          </Button>
        )}
      </div>

      <StickyHeader zIndex={40}>
        <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
      </StickyHeader>

      {/* All Agencies sections — one card per agency */}
      {showAgencySections && (
        agencies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">No agencies in scope</p>
        ) : (
          <div className="space-y-3">
            {agencies.map((agency) => (
              <AgencyTasksSection
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
                <TeamTasksSection teamUsers={[user]} />
              </div>
            ))}
          </div>
        )
      )}

      {!showAgencySections && !showAllTeamView && <>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{overdueCount}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Due Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{todayCount}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_open">All Open</SelectItem>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="to_do">To Do</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>

            {isManager && (
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="my_tasks">My Tasks</SelectItem>
                  <SelectItem value="assigned_by_me">Assigned By Me</SelectItem>
                  <SelectItem value="assigned_to_me">Assigned To Me</SelectItem>
                </SelectContent>
              </Select>
            )}

            {isSoftwareRole && projects.length > 0 && (
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {tasksLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Assigned By</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due Date</TableHead>
                {isSoftwareRole ? <TableHead>Project</TableHead> : <TableHead>Client</TableHead>}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map(task => {
                const StatusIcon = statusIcons[task.status];
                const linkedItem = getLinkedItemName(task);
                const taskIsOverdue = isOverdue(task);
                const editable = canEdit(task);
                const deletable = canDelete(task);

                return (
                  <TableRow 
                    key={task.id} 
                    className={`cursor-pointer hover:bg-muted/30 transition-colors ${task.status === 'done' ? 'opacity-60' : ''}`}
                    onClick={() => handleRowClick(task)}
                  >
                    <TableCell className="max-w-xs w-64">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{task.title}</div>
                        {task.forwardedFromName && (selectedAgencyId === 'all' || selectedAgencyId === 'me' || selectedAgencyId === task.forwardedFromSubCompanyId) && <ForwardedChip name={task.forwardedFromName} />}
                        {task.description && (
                          <div className="text-sm text-muted-foreground mt-1 line-clamp-2 break-words">
                            {task.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{task.ownerName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{task.assignedByName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={priorityColors[task.priority]} variant="secondary">
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${statusColors[task.status]} flex items-center gap-1.5 w-fit`} variant="secondary">
                        <StatusIcon className="h-3.5 w-3.5" />
                        <span className="capitalize text-xs font-medium">{task.status.replace('_', ' ')}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className={taskIsOverdue ? 'text-destructive font-medium' : ''}>
                        {format(new Date(task.dueDate), 'MMM d, yyyy h:mm a')}
                      </div>
                      {taskIsOverdue && (
                        <Badge variant="destructive" className="mt-1 text-xs">
                          Overdue
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isSoftwareRole ? (
                        task.projectId ? (
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                            onClick={e => { e.stopPropagation(); navigate(`/projects/${task.projectId}`); }}
                          >
                            <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate max-w-[120px]">{task.projectName ?? 'Project'}</span>
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )
                      ) : linkedItem ? (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline truncate max-w-[140px]"
                          onClick={e => {
                            e.stopPropagation();
                            const clientId = task.linkType === 'client'
                              ? task.linkId
                              : task.linkedLead?.clientId ?? leads.find(l => l.id === task.linkId)?.clientId;
                            if (clientId) navigate(`/clients/${clientId}`);
                          }}
                        >
                          {linkedItem}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {deletable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => handleDelete(task.id, e)}
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filteredTasks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No tasks found matching your criteria
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>

      </>}

      <TaskDetailDialog
        task={selectedTask}
        open={isTaskDialogOpen && !isCreateMode}
        onOpenChange={setIsTaskDialogOpen}
      />

      <CreateTaskDialog
        open={isTaskDialogOpen && isCreateMode}
        onOpenChange={(open) => {
          setIsTaskDialogOpen(open);
          if (!open) setIsCreateMode(false);
        }}
        subCompanyId={writeAgencyId}
        onTaskCreated={loadTasks}
        defaultProjectId={projectFilter !== 'all' ? projectFilter : undefined}
      />
    </div>
  );
}
