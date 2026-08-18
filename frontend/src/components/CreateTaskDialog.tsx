import { useState, useCallback, useEffect } from 'react';
import { TaskPriority, TaskStatus, TaskLinkType } from '@/lib/types';
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
  fetchClients,
  fetchLeads,
  createTask,
  mapApiTaskToTask,
  uploadTaskAttachment,
  apiFetch,
} from '@/lib/api';

import { useCanViewAgencyScope, useCanViewTeamScope, useHasPermission } from '@/lib/access';
import { useActAs } from '@/hooks/useActAs';
import { useEffectiveUser } from '@/lib/effectiveUser';

const SOFTWARE_ROLES = new Set([
  'cto', 'project_manager', 'team_lead',
  'developer', 'qa_engineer', 'ui_ux_designer',
  'business_analyst', 'devops_engineer', 'hr', 'finance',
]);

type UserOption = { id: string; name: string; email: string; designation: string; reportingManagerIds?: string[] };
type LinkOption = { id: string; name: string; location?: string | null; industry?: string | null; corporateCode?: string | null };

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subCompanyId?: string;
  // Sales / Recruitment side
  defaultLinkType?: TaskLinkType;
  defaultLinkId?: string;
  // Software house side
  defaultProjectId?: string;
  projects?: { id: string; name: string }[]; // kept for call-site compat; we fetch internally
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
  defaultLinkType,
  defaultLinkId,
  defaultProjectId,
  onTaskCreated,
}: CreateTaskDialogProps) {
  const { currentUser, currentSubCompany, addTask } = useStore();
  const actAs = useActAs();
  const { id: effectiveSelfId, isActingAs, subCompanyId: actAsAgencyId } = useEffectiveUser();

  const isSoftwareRole = SOFTWARE_ROLES.has(currentUser?.role ?? '');

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

  // Sales/Recruitment link state
  const [linkType, setLinkType] = useState<TaskLinkType | 'none' | ''>(defaultLinkType || '');
  const [linkId, setLinkId] = useState(defaultLinkId || '');
  const [linkOpen, setLinkOpen] = useState(false);
  const [clientOptions, setClientOptions] = useState<LinkOption[]>([]);
  const [leadOptions, setLeadOptions] = useState<LinkOption[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);

  // Software house project state
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId || '');
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [agencyUsers, setAgencyUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

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

  useEffect(() => {
    if (open) setAssigneeId(effectiveSelfId);
  }, [open, effectiveSelfId]);

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
    if (!agencyId) { setAgencyUsers([]); return; }
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

  useEffect(() => {
    if (!open || usersLoading) return;
    if (assigneeId === effectiveSelfId) return;
    if (agencyUsers.length === 0 || !agencyUsers.some((u) => u.id === assigneeId)) {
      setAssigneeId(effectiveSelfId);
    }
  }, [open, usersLoading, agencyUsers, assigneeId, effectiveSelfId]);

  // ── Sales/Recruitment: load clients or leads when link type changes ──────────
  const loadClientOptions = useCallback(async () => {
    setLinkLoading(true);
    try {
      const { data } = await fetchClients({ ...(agencyId ? { subCompanyId: agencyId } : {}), limit: 500 });
      setClientOptions((data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        location: c.location ?? null,
        industry: c.industry ?? null,
        corporateCode: (c as any).corporateCode ?? null,
      })));
    } catch {
      setClientOptions([]);
    } finally {
      setLinkLoading(false);
    }
  }, [agencyId]);

  const loadLeadOptions = useCallback(async () => {
    setLinkLoading(true);
    try {
      const { data } = await fetchLeads({ ...(agencyId ? { subCompanyId: agencyId } : {}), limit: 500 });
      setLeadOptions(
        (data ?? []).map((l) => ({
          id: l.id,
          name: l.client?.name ? `${l.client.name} (Lead)` : l.id,
        }))
      );
    } catch {
      setLeadOptions([]);
    } finally {
      setLinkLoading(false);
    }
  }, [agencyId]);

  useEffect(() => {
    if (!open || isSoftwareRole) return;
    if (linkType === 'client') loadClientOptions();
    else if (linkType === 'lead') loadLeadOptions();
    else { setClientOptions([]); setLeadOptions([]); }
  }, [open, linkType, agencyId, isSoftwareRole, loadClientOptions, loadLeadOptions]);

  // ── Software house: load projects user is a member of ───────────────────────
  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await apiFetch<{ data: { id: string; name: string }[] }>('/projects');
      setProjectOptions(res.ok ? (res.data?.data ?? []) : []);
    } catch {
      setProjectOptions([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && agencyId) loadUsers();
  }, [open, agencyId, loadUsers]);

  useEffect(() => {
    if (open && isSoftwareRole) loadProjects();
  }, [open, isSoftwareRole, loadProjects]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      if (!isSoftwareRole) {
        if (defaultLinkType) setLinkType(defaultLinkType);
        if (defaultLinkId) setLinkId(defaultLinkId);
      }
      setSelectedProjectId(defaultProjectId || '');
      setAssigneeId(effectiveSelfId);
    }
  }, [open, defaultLinkType, defaultLinkId, defaultProjectId, effectiveSelfId, isSoftwareRole]);

  const isManagerScoped = canViewTeamScope && !canViewAgencyScope;
  const assignableUsers = (() => {
    if (!canAssignToAnyone) return [selfOption];
    if (isManagerScoped) {
      const myDirectReports = agencyUsers.filter((u) => u.reportingManagerIds?.includes(effectiveSelfId));
      return [selfOption, ...myDirectReports.filter((u) => u.id !== effectiveSelfId)];
    }
    return agencyUsers.some((u) => u.id === effectiveSelfId) ? agencyUsers : [selfOption, ...agencyUsers];
  })();
  const selectedUser = assignableUsers.find((u) => u.id === assigneeId) ?? selfOption;

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('Please enter a task title'); return; }
    if (!dueDate) { toast.error('Please select a due date'); return; }

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
        // Software house: project link
        ...(isSoftwareRole
          ? { projectId: selectedProjectId || null }
          : {
              linkType: linkType && linkType !== 'none' ? linkType : null,
              linkId: linkId || null,
            }),
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

      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      const next = new Date();
      next.setHours(17, 0, 0, 0);
      setDueDate(next);
      setDueTime(toTimeString(next));
      setAssigneeId(effectiveSelfId);
      setLinkType('');
      setLinkId('');
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

  const linkOptions = linkType === 'client' ? clientOptions : linkType === 'lead' ? leadOptions : [];
  const selectedLink = linkOptions.find((o) => o.id === linkId);

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
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>
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
                              onSelect={() => { setAssigneeId(user.id); setAssigneeOpen(false); }}
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
                <p className="text-xs text-muted-foreground">Tasks are assigned to you by default.</p>
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

          {/* ── Software house: link to project ─────────────────────────────── */}
          {isSoftwareRole && (
            <div className="space-y-2">
              <Label>Project (Optional)</Label>
              <Select
                value={selectedProjectId || 'none'}
                onValueChange={(v) => setSelectedProjectId(v === 'none' ? '' : v)}
                disabled={projectsLoading}
              >
                <SelectTrigger>
                  {projectsLoading
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>
                    : <SelectValue placeholder="Link to a project" />
                  }
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!projectsLoading && projectOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">You are not a member of any project yet.</p>
              )}
            </div>
          )}

          {/* ── Sales / Recruitment: link to client or lead ──────────────────── */}
          {!isSoftwareRole && (
            <div className="space-y-2">
              <Label>Link To (Optional)</Label>
              <Select
                value={linkType || 'none'}
                onValueChange={(v) => {
                  setLinkType(v === 'none' ? '' : (v as TaskLinkType));
                  setLinkId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                </SelectContent>
              </Select>

              {linkType && linkType !== 'none' && (
                <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn('w-full justify-between', !selectedLink && 'text-muted-foreground')}
                      disabled={linkLoading}
                    >
                      {linkLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : selectedLink ? (
                        <span className="truncate">{selectedLink.name}</span>
                      ) : (
                        `Select ${linkType}`
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[380px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
                    {linkType === 'client' && (
                      <Command>
                        <CommandInput placeholder="Search clients..." />
                        <CommandList className="max-h-[200px]">
                          <CommandEmpty>No client found.</CommandEmpty>
                          <CommandGroup>
                            {clientOptions.map((opt) => {
                              const details = [opt.location, opt.industry, opt.corporateCode].filter(Boolean).join(' · ');
                              return (
                                <CommandItem
                                  key={opt.id}
                                  value={`${opt.name} ${opt.location ?? ''} ${opt.industry ?? ''} ${opt.corporateCode ?? ''}`.trim()}
                                  onSelect={() => { setLinkId(opt.id); setLinkOpen(false); }}
                                >
                                  <Check className={cn('mr-2 h-4 w-4 shrink-0', opt.id === linkId ? 'opacity-100' : 'opacity-0')} />
                                  <div className="flex flex-col min-w-0">
                                    <span className="truncate font-medium">{opt.name}</span>
                                    {details && (
                                      <span className="text-xs text-muted-foreground truncate">{details}</span>
                                    )}
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    )}
                    {linkType === 'lead' && (
                      <Command>
                        <CommandInput placeholder="Search leads..." />
                        <CommandList className="max-h-[200px]">
                          <CommandEmpty>No lead found.</CommandEmpty>
                          <CommandGroup>
                            {leadOptions.map((opt) => (
                              <CommandItem
                                key={opt.id}
                                value={opt.name}
                                onSelect={() => { setLinkId(opt.id); setLinkOpen(false); }}
                              >
                                <Check className={cn('mr-2 h-4 w-4', opt.id === linkId ? 'opacity-100' : 'opacity-0')} />
                                {opt.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>
            ) : (
              'Create Task'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
