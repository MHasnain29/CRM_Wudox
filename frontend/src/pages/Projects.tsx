import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { Plus, FolderKanban, Users, CheckSquare, Loader2, Target } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useAuthStore } from '@/lib/authStore';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'on_hold' | 'done';
  startDate: string | null;
  endDate: string | null;
  owner: { id: string; firstName: string; lastName: string };
  _count: { tasks: number; milestones: number };
  members: { userId: string; user: { firstName: string; lastName: string } }[];
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  done: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  done: 'Done',
};

const WRITE_ROLES = new Set([
  'cto', 'project_manager', 'team_lead',
  'super_admin', 'director', 'company_director', 'operations_manager',
]);

export default function Projects() {
  const navigate = useNavigate();
  const userRole = useAuthStore((s) => s.user?.role ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', status: 'active' });

  const canCreate = WRITE_ROLES.has(userRole);

  useEffect(() => {
    apiFetch<{ data: Project[] }>('/projects')
      .then((res) => { if (res.ok && res.data) setProjects((res.data as any).data ?? res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<any>('/projects', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (res.ok && res.data) {
        const created = (res.data as any).data ?? res.data;
        setProjects((prev) => [created, ...prev]);
        setShowDialog(false);
        setForm({ name: '', description: '', status: 'active' });
        toast.success('Project created');
        navigate(`/projects/${created.id}`);
      } else {
        toast.error((res as any).error ?? 'Failed to create project');
      }
    } catch {
      toast.error('Failed to create project');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading projects…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FolderKanban size={22} /> Projects
        </h1>
        {canCreate && (
          <Button onClick={() => setShowDialog(true)}>
            <Plus size={16} className="mr-1" /> New Project
          </Button>
        )}
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No projects yet.{canCreate ? ' Create one to get started.' : ''}
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{p.name}</CardTitle>
                  <Badge className={`text-xs shrink-0 border-0 ${STATUS_COLOR[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {p.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckSquare size={13} /> {p._count.tasks} tasks
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={13} /> {p.members.length} members
                  </span>
                  <span className="flex items-center gap-1">
                    <Target size={13} /> {p._count.milestones} milestones
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span>Owner: {p.owner.firstName} {p.owner.lastName}</span>
                  {p.endDate && (
                    <span className="ml-3">Due: {format(new Date(p.endDate), 'dd MMM yyyy')}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Project name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brief description (optional)"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_hold">On Hold</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
              {creating && <Loader2 size={14} className="animate-spin mr-1" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
