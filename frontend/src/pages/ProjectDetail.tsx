import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft, Users, Target, CheckSquare, CalendarOff,
  Plus, Check, Circle, Loader2, Trash2, UserPlus, CheckCircle2,
  Clock, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, isPast, isToday } from 'date-fns';
import { useAuthStore } from '@/lib/authStore';

interface Member {
  userId: string;
  role: 'lead' | 'member';
  user: { id: string; firstName: string; lastName: string; role: string };
}

interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  owner: { id: string; firstName: string; lastName: string } | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'on_hold' | 'done';
  startDate: string | null;
  endDate: string | null;
  ownerId: string;
  owner: { id: string; firstName: string; lastName: string };
  members: Member[];
  milestones: Milestone[];
  tasks: Task[];
}

interface LeaveEntry {
  id: string;
  user: { firstName: string; lastName: string };
  leaveType: { name: string };
  startDate: string;
  endDate: string;
  days: number;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  done: 'bg-gray-100 text-gray-600',
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-600',
};

const TASK_STATUS_ICON: Record<string, typeof Clock> = {
  to_do: Clock,
  in_progress: AlertTriangle,
  done: CheckCircle2,
};

const WRITE_ROLES = new Set([
  'cto', 'project_manager', 'team_lead',
  'super_admin', 'director', 'company_director', 'operations_manager',
]);

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userRole = useAuthStore((s) => s.user?.role ?? '');
  const userId = useAuthStore((s) => s.user?.id ?? '');

  const [project, setProject] = useState<Project | null>(null);
  const [leaveEntries, setLeaveEntries] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Milestone dialog
  const [showMilestoneDialog, setShowMilestoneDialog] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', dueDate: '' });
  const [addingMilestone, setAddingMilestone] = useState(false);

  // Add member dialog
  const [showMemberDialog, setShowMemberDialog] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Edit project status
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const canWrite = WRITE_ROLES.has(userRole);
  const isOwner = project?.ownerId === userId;
  const isMember = project?.members.some((m) => m.userId === userId) ?? false;
  const canManage = canWrite && (isOwner || WRITE_ROLES.has(userRole));

  useEffect(() => {
    if (!id) return;
    Promise.all([
      apiFetch<any>(`/projects/${id}`),
      apiFetch<any>(`/projects/${id}/leave-calendar`),
    ]).then(([projRes, leaveRes]) => {
      if (projRes.ok) setProject(projRes.data?.data ?? projRes.data);
      if (leaveRes.ok) setLeaveEntries(leaveRes.data?.data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  async function handleStatusChange(status: string) {
    if (!project) return;
    setUpdatingStatus(true);
    const res = await apiFetch<any>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setProject((p) => p ? { ...p, status: status as any } : p);
      toast.success('Status updated');
    } else {
      toast.error('Failed to update status');
    }
    setUpdatingStatus(false);
  }

  async function handleAddMilestone() {
    if (!milestoneForm.title.trim() || !milestoneForm.dueDate) return;
    setAddingMilestone(true);
    const res = await apiFetch<any>(`/projects/${id}/milestones`, {
      method: 'POST',
      body: JSON.stringify({
        title: milestoneForm.title,
        dueDate: new Date(milestoneForm.dueDate).toISOString(),
      }),
    });
    if (res.ok) {
      const newMs = res.data?.data ?? res.data;
      setProject((p) => p ? { ...p, milestones: [...p.milestones, newMs] } : p);
      setMilestoneForm({ title: '', dueDate: '' });
      setShowMilestoneDialog(false);
      toast.success('Milestone added');
    } else {
      toast.error('Failed to add milestone');
    }
    setAddingMilestone(false);
  }

  async function handleToggleMilestone(ms: Milestone) {
    const res = await apiFetch<any>(`/projects/${id}/milestones/${ms.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: !ms.done }),
    });
    if (res.ok) {
      setProject((p) =>
        p ? {
          ...p,
          milestones: p.milestones.map((m) =>
            m.id === ms.id ? { ...m, done: !ms.done } : m
          ),
        } : p
      );
    }
  }

  async function handleDeleteMilestone(msId: string) {
    const res = await apiFetch<any>(`/projects/${id}/milestones/${msId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setProject((p) =>
        p ? { ...p, milestones: p.milestones.filter((m) => m.id !== msId) } : p
      );
      toast.success('Milestone deleted');
    }
  }

  async function openAddMember() {
    // Fetch users to pick from
    const res = await apiFetch<any>('/users');
    if (res.ok) {
      const all: UserOption[] = (res.data?.data ?? res.data ?? []).filter(
        (u: UserOption) => !project?.members.some((m) => m.userId === u.id)
      );
      setUserOptions(all);
    }
    setSelectedUserId('');
    setShowMemberDialog(true);
  }

  async function handleAddMember() {
    if (!selectedUserId) return;
    setAddingMember(true);
    const res = await apiFetch<any>(`/projects/${id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: selectedUserId }),
    });
    if (res.ok) {
      const newMember = res.data?.data ?? res.data;
      setProject((p) =>
        p ? { ...p, members: [...p.members, newMember] } : p
      );
      setShowMemberDialog(false);
      toast.success('Member added');
    } else {
      toast.error((res as any).error ?? 'Failed to add member');
    }
    setAddingMember(false);
  }

  async function handleRemoveMember(membUserId: string) {
    const res = await apiFetch<any>(`/projects/${id}/members/${membUserId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setProject((p) =>
        p ? { ...p, members: p.members.filter((m) => m.userId !== membUserId) } : p
      );
      toast.success('Member removed');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading project…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate('/projects')}>
          <ArrowLeft size={16} className="mr-1" /> Back
        </Button>
        <p className="mt-4 text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  const pendingMilestones = project.milestones.filter((m) => !m.done);
  const doneMilestones = project.milestones.filter((m) => m.done);
  const openTasks = project.tasks.filter((t) => t.status !== 'done');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
          <ArrowLeft size={16} />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Select
              value={project.status}
              onValueChange={handleStatusChange}
              disabled={updatingStatus}
            >
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Badge className={`border-0 ${STATUS_COLOR[project.status]}`}>
              {project.status.replace('_', ' ')}
            </Badge>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>Owner: <strong>{project.owner.firstName} {project.owner.lastName}</strong></span>
        {project.startDate && (
          <span>Start: <strong>{format(new Date(project.startDate), 'dd MMM yyyy')}</strong></span>
        )}
        {project.endDate && (
          <span>Due: <strong>{format(new Date(project.endDate), 'dd MMM yyyy')}</strong></span>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column: tasks + milestones */}
        <div className="lg:col-span-2 space-y-6">

          {/* Tasks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckSquare size={16} /> Tasks ({openTasks.length} open)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {project.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks linked to this project.</p>
              ) : (
                <div className="space-y-2">
                  {project.tasks.map((t) => {
                    const Icon = TASK_STATUS_ICON[t.status] ?? Circle;
                    const overdue = t.dueDate && isPast(new Date(t.dueDate)) && !isToday(new Date(t.dueDate)) && t.status !== 'done';
                    return (
                      <div key={t.id} className="flex items-center gap-3 border rounded p-2.5 text-sm">
                        <Icon
                          size={14}
                          className={
                            t.status === 'done'
                              ? 'text-green-500'
                              : t.status === 'in_progress'
                              ? 'text-blue-500'
                              : 'text-gray-400'
                          }
                        />
                        <span className={`flex-1 ${t.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                          {t.title}
                        </span>
                        {t.priority && (
                          <Badge className={`text-xs border-0 ${PRIORITY_COLOR[t.priority]}`}>
                            {t.priority}
                          </Badge>
                        )}
                        {t.owner && (
                          <span className="text-xs text-muted-foreground">
                            {t.owner.firstName} {t.owner.lastName}
                          </span>
                        )}
                        {overdue && (
                          <span className="text-xs text-red-500">overdue</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Milestones */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target size={16} /> Milestones
                </CardTitle>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setShowMilestoneDialog(true)}>
                    <Plus size={14} className="mr-1" /> Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {project.milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No milestones yet.</p>
              ) : (
                <div className="space-y-2">
                  {[...pendingMilestones, ...doneMilestones].map((ms) => {
                    const overdue = !ms.done && isPast(new Date(ms.dueDate));
                    return (
                      <div key={ms.id} className="flex items-center gap-3 border rounded p-2.5 text-sm">
                        <button
                          onClick={() => canManage && handleToggleMilestone(ms)}
                          className={canManage ? 'cursor-pointer' : 'cursor-default'}
                        >
                          {ms.done
                            ? <CheckCircle2 size={16} className="text-green-500" />
                            : <Circle size={16} className="text-gray-400" />
                          }
                        </button>
                        <span className={`flex-1 ${ms.done ? 'line-through text-muted-foreground' : ''}`}>
                          {ms.title}
                        </span>
                        <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
                          {format(new Date(ms.dueDate), 'dd MMM yyyy')}
                          {overdue && ' · overdue'}
                        </span>
                        {canManage && (
                          <button
                            onClick={() => handleDeleteMilestone(ms.id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: members + leave */}
        <div className="space-y-6">
          {/* Members */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users size={16} /> Members ({project.members.length})
                </CardTitle>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={openAddMember}>
                    <UserPlus size={14} className="mr-1" /> Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {project.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members yet.</p>
              ) : (
                <div className="space-y-2">
                  {project.members.map((m) => (
                    <div key={m.userId} className="flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{m.user.firstName} {m.user.lastName}</span>
                        <span className="text-xs text-muted-foreground ml-2">{m.user.role}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{m.role}</Badge>
                        {canManage && m.userId !== project.ownerId && (
                          <button
                            onClick={() => handleRemoveMember(m.userId)}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team Leave */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarOff size={16} /> Team on Leave
              </CardTitle>
            </CardHeader>
            <CardContent>
              {leaveEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming approved leaves.</p>
              ) : (
                <div className="space-y-2">
                  {leaveEntries.map((entry) => (
                    <div key={entry.id} className="border rounded p-2.5 text-sm">
                      <div className="font-medium">
                        {entry.user.firstName} {entry.user.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {entry.leaveType.name} · {entry.days} day(s)
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(entry.startDate), 'dd MMM')} –{' '}
                        {format(new Date(entry.endDate), 'dd MMM yyyy')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Milestone Dialog */}
      <Dialog open={showMilestoneDialog} onOpenChange={setShowMilestoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Milestone</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                value={milestoneForm.title}
                onChange={(e) => setMilestoneForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Milestone title"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due Date *</Label>
              <Input
                type="date"
                value={milestoneForm.dueDate}
                onChange={(e) => setMilestoneForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMilestoneDialog(false)}>Cancel</Button>
            <Button
              onClick={handleAddMilestone}
              disabled={addingMilestone || !milestoneForm.title.trim() || !milestoneForm.dueDate}
            >
              {addingMilestone && <Loader2 size={14} className="animate-spin mr-1" />}
              Add Milestone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={showMemberDialog} onOpenChange={setShowMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a user…" />
                </SelectTrigger>
                <SelectContent>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                      <span className="text-muted-foreground ml-1 text-xs">({u.role})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMemberDialog(false)}>Cancel</Button>
            <Button onClick={handleAddMember} disabled={addingMember || !selectedUserId}>
              {addingMember && <Loader2 size={14} className="animate-spin mr-1" />}
              Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
