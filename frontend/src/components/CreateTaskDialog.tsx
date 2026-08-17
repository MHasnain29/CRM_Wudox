import { useState, useCallback, useEffect } from 'react';
import { TaskPriority, TaskStatus } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { CalendarIcon, Check, ChevronsUpDown, Loader2, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';
import {
  fetchUsers,
  createTask,
  mapApiTaskToTask,
  uploadTaskAttachment,
} from '@/lib/api';

import { useCanViewAgencyScope, useCanViewTeamScope, useHasPermission } from '@/lib/access';
import { useActAs } from '@/hooks/useActAs';
import { useEffectiveUser } from '@/lib/effectiveUser';

type UserOption = { id: string; name: string; email: string; designation: string; reportingManagerIds?: string[] };
interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subCompanyId?: string;
  defaultProjectId?: string;
  projects?: { id: string; name: string }[];
  onTaskCreated?: () => void;
}

function toTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function combineDateAndTime(date: Date, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const out = new Date(date);
  out.setHours(h, m, 0, 0);
  return out;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  subCompanyId,
  defaultProjectId,
  projects,
  onTaskCreated,
}: CreateTaskDialogProps) {
  const { currentUser, currentSubCompany, addTask } = useStore();
  const actAs = useActAs();
  const { id: effectiveSelfId, isActingAs, subCompanyId: actAsAgencyId } = useEffectiveUser();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    return d;
  });
  const [dueTime, setDueTime] = useState(() => toTimeString(new Date()));
  const [assigneeId, setAssigneeId] = useState(effectiveSelfId);
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId || '');

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [agencyUsers, setAgencyUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Under act-as, always use the linked user's agency — never the login home agency.
  const agencyId = isActingAs
    ? (actAsAgencyId || subCompanyId || currentSubCompany?.id || currentUser.subCompanyId)
    : (subCompanyId ?? currentSubCompany?.id ?? currentUser.subCompanyId);
  const canWriteTasks = useHasPermission('tasks:write');
  const canViewTeamScope = useCanViewTeamScope();
  const canViewAgencyScope = useCanViewAgencyScope();
  const canAssignToAnyone = canWriteTasks && canViewTeamScope;

  useEffect(() => {
    if (open && !canWriteTasks) {
      onOpenChange(false);
      toast.error('You do not have permission to create tasks');
    }
  }, [open, canWriteTasks, onOpenChange]);

  // Reset assignee to effective self whenever dialog opens or act-as target changes.
  useEffect(() => {
    if (open) setAssigneeId(effectiveSelfId);
  }, [open, effectiveSelfId]);

  // Self option so current user (or act-as user) is always assignable; backend GET /users excludes super_user roles
  const selfOption: UserOption = actAs.isActive
    ? (agencyUsers.find((u) => u.id === actAs.userId) ?? {
        id: actAs.userId!,
        name: `${actAs.firstName} ${actAs.lastName}`,
        email: '',
        designation: actAs.agencyName ?? '',
      })
    : {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email ?? '',
        designation: currentUser.userType ?? currentUser.role ?? '',
      };

  const loadUsers = useCallback(async () => {
    if (!agencyId) {
      setAgencyUsers([]);
      return;
    }
    setUsersLoading(true);
    try {
      const users = await fetchUsers({ subCompanyId: agencyId });
      const list: UserOption[] = users
        .filter((u) => u.isActive)
        .map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email ?? '',
          designation: u.userType ?? u.role ?? '',
          reportingManagerIds: (u as { reportingManagerIds?: string[] }).reportingManagerIds,
        }));
      setAgencyUsers(list);
      if (!assigneeId || !list.some((u) => u.id === assigneeId)) {
        setAssigneeId(effectiveSelfId);
      }
    } catch {
      toast.error('Failed to load users');
      setAgencyUsers([]);
      setAssigneeId(effectiveSelfId);
    } finally {
      setUsersLoading(false);
    }
  }, [agencyId, effectiveSelfId]);

  // Always prefer effective self when the current assignee is not in the loaded agency list
  // (e.g. login user still selected while act-as agency list loaded).
  useEffect(() => {
    if (!open || usersLoading) return;
    if (assigneeId === effectiveSelfId) return;
    if (agencyUsers.length === 0 || !agencyUsers.some((u) => u.id === assigneeId)) {
      setAssigneeId(effectiveSelfId);
    }
  }, [open, usersLoading, agencyUsers, assigneeId, effectiveSelfId]);

  useEffect(() => {
    if (open && agencyId) {
      loadUsers();
    }
  }, [open, agencyId, loadUsers]);

  useEffect(() => {
    if (open) {
      setSelectedProjectId(defaultProjectId || '');
      setAssigneeId(effectiveSelfId);
    }
  }, [open, defaultProjectId, effectiveSelfId]);

  // Always include self (e.g. super_admin isn't returned by GET /users); default to self
  const isManagerScoped = canViewTeamScope && !canViewAgencyScope;
  const assignableUsers = (() => {
    if (!canAssignToAnyone) return [selfOption];
    if (isManagerScoped) {
      // Managers see self + direct reports only
      const myDirectReports = agencyUsers.filter((u) => u.reportingManagerIds?.includes(effectiveSelfId));
      return [selfOption, ...myDirectReports.filter((u) => u.id !== effectiveSelfId)];
    }
    // Operations manager / director / super_admin: everyone in agency
    return agencyUsers.some((u) => u.id === effectiveSelfId) ? agencyUsers : [selfOption, ...agencyUsers];
  })();
  const selectedUser = assignableUsers.find((u) => u.id === assigneeId) ?? selfOption;

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Please enter a task title');
      return;
    }
    if (!dueDate) {
      toast.error('Please select a due date');
      return;
    }
    const effectiveOwnerId = canAssignToAnyone ? assigneeId : effectiveSelfId;
    const combinedDue = combineDateAndTime(dueDate, dueTime);
    const dueDateIso = combinedDue.toISOString();

    setSubmitting(true);
    try {
      const apiTask = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDateIso,
        priority,
        ownerId: effectiveOwnerId,
        subCompanyId: agencyId,
        projectId: selectedProjectId || null,
      });

      if (pendingFiles.length > 0) {
        const results = await Promise.allSettled(pendingFiles.map((f) => uploadTaskAttachment(apiTask.id, f)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) toast.warning(`Task created, but ${failed} attachment(s) failed to upload`);
        const uploaded = results
          .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
          .map((r) => r.value);
        apiTask.attachments = uploaded;
      }

      const task = mapApiTaskToTask(apiTask);
      addTask(task);
      setTitle('');
      setDescription('');
      setPriority('medium');
      const next = new Date();
      next.setHours(17, 0, 0, 0);
      setDueDate(next);
      setDueTime(toTimeString(next));
      setAssigneeId(effectiveSelfId);
      setSelectedProjectId('');
      setPendingFiles([]);
      onTaskCreated?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  if (!canWriteTasks) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>
            Create a new task and assign it to yourself or a team member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="Enter task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter task description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Assign To</Label>
              <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    disabled={usersLoading || !canAssignToAnyone}
                    className={cn(
                      'h-10 w-full justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-normal',
                      !selectedUser && 'text-muted-foreground'
                    )}
                  >
                    {usersLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : selectedUser ? (
                      <>
                        <span className="truncate">
                          {selectedUser.designation ? `${selectedUser.name} (${selectedUser.designation})` : selectedUser.name}
                        </span>
                        {canAssignToAnyone && <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
                      </>
                    ) : (
                      'Select user'
                    )}
                  </Button>
                </PopoverTrigger>
                {canAssignToAnyone && (
                  <PopoverContent className="w-[380px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
                    <Command>
                      <CommandInput placeholder="Search by name, email or designation..." />
                      <CommandList className="max-h-[240px]">
                        <CommandEmpty>No user found.</CommandEmpty>
                        <CommandGroup>
                          {assignableUsers.map((user) => (
                            <CommandItem
                              key={user.id}
                              value={`${user.name} ${user.email} ${user.designation}`.trim()}
                              onSelect={() => {
                                setAssigneeId(user.id);
                                setAssigneeOpen(false);
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4 shrink-0', user.id === assigneeId ? 'opacity-100' : 'opacity-0')} />
                              <div className="flex flex-col min-w-0">
                                <span className="truncate font-medium">{user.name}</span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {user.designation && `${user.designation} · `}{user.email}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                )}
              </Popover>
              {!canAssignToAnyone && (
                <p className="text-xs text-muted-foreground">
                  Tasks are assigned to you by default.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Due Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal', !dueDate && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Due Time *</Label>
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Attachments (Optional)</Label>
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <Paperclip className="h-4 w-4" />
                Add files
              </div>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setPendingFiles((prev) => [...prev, ...files]);
                  e.target.value = '';
                }}
              />
            </label>
            {pendingFiles.length > 0 && (
              <ul className="space-y-1">
                {pendingFiles.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-sm">
                    <span className="truncate max-w-[260px]">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="ml-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {projects && projects.length > 0 && (
            <div className="space-y-2">
              <Label>Project (Optional)</Label>
              <Select value={selectedProjectId || 'none'} onValueChange={v => setSelectedProjectId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Link to a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Task'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
