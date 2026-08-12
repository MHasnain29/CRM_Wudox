import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ChevronLeft, ChevronRight, Check, AlertCircle, Loader2,
  Mail, Users, Briefcase, TrendingUp, ClipboardList, CalendarDays,
  LogOut, ArrowRightLeft, UserCheck, Bell, Minus, Lock, CloudUpload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchOffboardingData,
  commitOffboarding,
  partialCommitOffboarding,
  fetchUsers,
  type OffboardingDataItem,
  type OffboardingEmployeeData,
  type OffboardingCommitPayload,
} from '@/lib/api';

const STEPS = [
  { key: 'email',     label: 'Emails',      icon: Mail },
  { key: 'clients',   label: 'Won Clients', icon: Users },
  { key: 'pipeline',  label: 'Pipeline',    icon: TrendingUp },
  { key: 'leads',     label: 'Leads',       icon: Briefcase },
  { key: 'tasks',     label: 'Tasks',       icon: ClipboardList },
  { key: 'meetings',  label: 'Meetings',    icon: CalendarDays },
  { key: 'followups', label: 'Follow-Ups',  icon: Bell },
  { key: 'review',    label: 'Confirm',     icon: UserCheck },
] as const;

type StepKey = (typeof STEPS)[number]['key'];
type StepStatus = 'pending' | 'done' | 'skipped';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  departingUserId: string;
  departingUserName: string;
  departingSubCompanyId: string;
  onComplete?: () => void;
  onSaveProgress?: () => void;
}

type AssignMap = Record<string, string | null>;

interface WizardState {
  step: number;
  emailAssigneeId: string | null;
  defaultAssigneeId: string | null;
  clientMap: AssignMap;
  pipelineMap: AssignMap;
  leadMap: AssignMap;
  taskMap: AssignMap;
  meetingMap: AssignMap;
  followupMap: AssignMap;
  clientMode: 'all' | 'individual';
  pipelineMode: 'all' | 'individual';
  leadMode: 'all' | 'individual';
  taskMode: 'all' | 'individual';
  meetingMode: 'all' | 'individual';
  followupMode: 'all' | 'individual';
  deactivateUser: boolean;
  privateEmailsRemoved: boolean;
  stepStatuses: Record<number, StepStatus>;
  serverCommittedSteps: number[];
}

const EMPTY_STATE: WizardState = {
  step: 0,
  emailAssigneeId: null,
  defaultAssigneeId: null,
  clientMap: {},
  pipelineMap: {},
  leadMap: {},
  taskMap: {},
  meetingMap: {},
  followupMap: {},
  clientMode: 'all',
  pipelineMode: 'all',
  leadMode: 'all',
  taskMode: 'all',
  meetingMode: 'all',
  followupMode: 'all',
  deactivateUser: true,
  privateEmailsRemoved: false,
  stepStatuses: Object.fromEntries(STEPS.map((_, i) => [i, 'pending' as StepStatus])),
  serverCommittedSteps: [],
};

// ── LocalStorage helpers ──────────────────────────────────────────────────────

const DRAFT_KEY = (id: string) => `offboarding_draft_${id}`;
const COMPLETE_KEY = (id: string) => `offboarding_complete_${id}`;

function loadDraft(userId: string): WizardState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(userId));
    return raw ? (JSON.parse(raw) as WizardState) : null;
  } catch { return null; }
}

function saveDraft(userId: string, state: WizardState) {
  try { localStorage.setItem(DRAFT_KEY(userId), JSON.stringify(state)); } catch { /* ignore */ }
}

function clearDraft(userId: string) {
  localStorage.removeItem(DRAFT_KEY(userId));
}

function isOffboardingLocked(userId: string) {
  return localStorage.getItem(COMPLETE_KEY(userId)) === 'true';
}

function markOffboardingLocked(userId: string) {
  localStorage.setItem(COMPLETE_KEY(userId), 'true');
  clearDraft(userId);
}

// ─────────────────────────────────────────────────────────────────────────────

function initMap(items: OffboardingDataItem[]): AssignMap {
  return Object.fromEntries(items.map((i) => [i.id, null]));
}

function resolveAssignments(
  map: AssignMap,
  fallback: string,
  items: OffboardingDataItem[],
): OffboardingCommitPayload['clients'] {
  return items.map((item) => ({ id: item.id, toUserId: map[item.id] ?? fallback }));
}

type UserOption = { id: string; firstName: string; lastName: string; role: string };

export function OffboardingWizard({
  open,
  onOpenChange,
  departingUserId,
  departingUserName,
  departingSubCompanyId,
  onComplete,
  onSaveProgress,
}: Props) {
  const { data: employeeData, isLoading: loadingData, error: loadError } = useQuery({
    queryKey: ['offboarding-data', departingUserId],
    queryFn: () => fetchOffboardingData(departingUserId),
    enabled: open && !!departingUserId,
    retry: false,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users', departingSubCompanyId],
    queryFn: () => fetchUsers({ subCompanyId: departingSubCompanyId }),
    enabled: open && !!departingSubCompanyId,
  });

  const availableUsers: UserOption[] = (usersData ?? []).filter(
    (u) => u.id !== departingUserId && u.isActive !== false,
  );

  const [state, setState] = useState<WizardState>(EMPTY_STATE);
  const [draftRestored, setDraftRestored] = useState(false);
  const [locked, setLocked] = useState(false);

  // Restore draft or reset on open
  useEffect(() => {
    if (!open) return;
    const isLocked = isOffboardingLocked(departingUserId);
    setLocked(isLocked);
    if (isLocked) { setState({ ...EMPTY_STATE, step: STEPS.length - 1 }); setDraftRestored(false); return; }

    const draft = loadDraft(departingUserId);
    if (draft) {
      setState(draft);
      setDraftRestored(true);
      toast.info('Draft restored — continue where you left off.', { id: 'draft-restored' });
    } else {
      setState(EMPTY_STATE);
      setDraftRestored(false);
    }
  }, [open, departingUserId]); // eslint-disable-line

  // Init maps only when no draft is restored.
  // Also clear any stale localStorage lock — if the API returned fresh data,
  // the offboarding was never committed (or was reverted in DB).
  useEffect(() => {
    if (!employeeData) return;
    localStorage.removeItem(COMPLETE_KEY(departingUserId));
    setLocked((wasLocked) => {
      if (wasLocked) {
        // Stale lock — reset step to beginning
        setState(EMPTY_STATE);
      }
      return false;
    });
    if (draftRestored) return;
    setState((prev) => ({
      ...prev,
      clientMap: initMap(employeeData.clients),
      pipelineMap: initMap(employeeData.pipeline),
      leadMap: initMap(employeeData.leads),
      taskMap: initMap(employeeData.tasks),
      meetingMap: initMap(employeeData.meetings),
      followupMap: initMap(employeeData.followUps),
    }));
  }, [employeeData, draftRestored, departingUserId]); // eslint-disable-line

  const mutation = useMutation({
    mutationFn: commitOffboarding,
    onSuccess: () => {
      markOffboardingLocked(departingUserId);
      toast.success(`${departingUserName} has been successfully offboarded.`);
      onOpenChange(false);
      onComplete?.();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? 'Offboarding failed. No data was changed.');
    },
  });

  function setEmailAssignee(userId: string) {
    setState((prev) => ({ ...prev, emailAssigneeId: userId, defaultAssigneeId: userId }));
  }

  function setItemAssignee(
    mapKey: 'clientMap' | 'pipelineMap' | 'leadMap' | 'taskMap' | 'meetingMap' | 'followupMap',
    itemId: string,
    userId: string,
  ) {
    setState((prev) => ({ ...prev, [mapKey]: { ...prev[mapKey], [itemId]: userId } }));
  }

  function setBulkAssignee(
    mapKey: 'clientMap' | 'pipelineMap' | 'leadMap' | 'taskMap' | 'meetingMap' | 'followupMap',
    items: OffboardingDataItem[],
    userId: string,
  ) {
    const bulk = Object.fromEntries(items.map((i) => [i.id, userId]));
    setState((prev) => ({ ...prev, [mapKey]: { ...prev[mapKey], ...bulk } }));
  }

  function handleNext() {
    setState((prev) => ({
      ...prev,
      step: Math.min(prev.step + 1, STEPS.length - 1),
      stepStatuses: { ...prev.stepStatuses, [prev.step]: 'done' },
    }));
  }

  function handleBack() {
    setState((prev) => ({ ...prev, step: Math.max(prev.step - 1, 0) }));
  }

  function handleSkip() {
    if (state.step === 0 && !state.emailAssigneeId) {
      toast.warning('Email forwarding skipped — make sure to configure this before finalizing.');
    }
    setState((prev) => ({
      ...prev,
      step: Math.min(prev.step + 1, STEPS.length - 1),
      stepStatuses: { ...prev.stepStatuses, [prev.step]: 'skipped' },
    }));
  }

  async function handleSaveProgress() {
    saveDraft(departingUserId, state);

    if (employeeData && state.defaultAssigneeId) {
      const fallback = state.defaultAssigneeId;
      const isDone  = (idx: number) => state.stepStatuses[idx] === 'done';
      const isSkipped = (idx: number) => state.stepStatuses[idx] === 'skipped';
      try {
        await partialCommitOffboarding({
          departingUserId,
          fallbackUserId: fallback,
          emailForwardToUserId: state.emailAssigneeId ?? undefined,
          clients:  isDone(1) || isSkipped(1) ? resolveAssignments(state.clientMap,   fallback, employeeData.clients)   : undefined,
          pipeline: isDone(2) || isSkipped(2) ? resolveAssignments(state.pipelineMap, fallback, employeeData.pipeline)  : undefined,
          leads:    isDone(3) || isSkipped(3) ? resolveAssignments(state.leadMap,     fallback, employeeData.leads)     : undefined,
          tasks:    isDone(4) || isSkipped(4) ? resolveAssignments(state.taskMap,     fallback, employeeData.tasks)     : undefined,
          meetings: isDone(5) || isSkipped(5) ? resolveAssignments(state.meetingMap,  fallback, employeeData.meetings)  : undefined,
          followUps:isDone(6) || isSkipped(6) ? resolveAssignments(state.followupMap, fallback, employeeData.followUps) : undefined,
        });
        const committed = Object.entries(state.stepStatuses)
          .filter(([, s]) => s === 'done' || s === 'skipped')
          .map(([i]) => Number(i));
        setState((prev) => ({ ...prev, serverCommittedSteps: committed }));
      } catch (err) {
        console.error('[offboarding] partial commit error:', err);
        // Non-fatal — progress is still saved locally
      }
    }

    onSaveProgress?.();
    toast.success('Progress saved. You can continue this offboarding later.');
    onOpenChange(false);
  }

  function handleConfirm() {
    if (!state.emailAssigneeId || !state.defaultAssigneeId) {
      toast.error('Email forwarding is not configured. Please assign it before completing.');
      setState((prev) => ({ ...prev, step: 0 }));
      return;
    }
    if (!employeeData) return;
    const fallback = state.defaultAssigneeId;
    const skipped = (idx: number) => state.stepStatuses[idx] === 'skipped';
    mutation.mutate({
      departingUserId,
      emailForwardToUserId: state.emailAssigneeId,
      clients:   skipped(1) ? [] : resolveAssignments(state.clientMap,   fallback, employeeData.clients),
      pipeline:  skipped(2) ? [] : resolveAssignments(state.pipelineMap, fallback, employeeData.pipeline),
      leads:     skipped(3) ? [] : resolveAssignments(state.leadMap,     fallback, employeeData.leads),
      tasks:     skipped(4) ? [] : resolveAssignments(state.taskMap,     fallback, employeeData.tasks),
      meetings:  skipped(5) ? [] : resolveAssignments(state.meetingMap,  fallback, employeeData.meetings),
      followUps: skipped(6) ? [] : resolveAssignments(state.followupMap, fallback, employeeData.followUps),
      fallbackUserId: fallback,
      deactivateUser: state.deactivateUser,
    });
  }

  const stepKey: StepKey = STEPS[state.step].key;
  const progress = (state.step / (STEPS.length - 1)) * 100;
  const hasDraft = !locked && draftRestored;

  if (loadError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="font-semibold">Failed to load employee data</p>
              <p className="text-sm text-muted-foreground mt-1">Close and try again.</p>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden rounded-2xl">

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <LogOut className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">Employee Offboarding</h2>
                <p className="text-sm text-muted-foreground">
                  Transferring data from <span className="font-medium text-foreground">{departingUserName}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 shrink-0">
              {hasDraft && (
                <span className="text-[11px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                  Draft saved
                </span>
              )}
              {locked && (
                <span className="text-[11px] text-muted-foreground border border-border rounded px-1.5 py-0.5 flex items-center gap-1">
                  <Lock className="h-2.5 w-2.5" /> Completed
                </span>
              )}
              <Badge variant="outline" className="text-xs">
                Step {state.step + 1} of {STEPS.length}
              </Badge>
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-1 mb-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const status = state.stepStatuses[i] as StepStatus;
              const isDone = status === 'done';
              const isSkipped = status === 'skipped';
              const isActive = i === state.step;
              const isServerCommitted = (state.serverCommittedSteps ?? []).includes(i);
              return (
                <button
                  key={s.key}
                  onClick={() => { if (isDone || isSkipped) setState((p) => ({ ...p, step: i })); }}
                  disabled={(!isDone && !isSkipped) || mutation.isPending}
                  title={isServerCommitted ? `${s.label} (saved to server)` : s.label}
                  className={`flex flex-col items-center gap-1 flex-1 py-2 rounded-lg transition-all ${
                    isActive ? 'bg-primary/8' : (isDone || isSkipped) ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                    isDone && isServerCommitted
                      ? 'bg-blue-500 text-white'
                      : isDone
                        ? 'bg-green-500 text-white'
                        : isSkipped
                          ? 'bg-muted text-muted-foreground border-2 border-dashed border-muted-foreground/30'
                          : isActive
                            ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                            : 'bg-muted text-muted-foreground/40'
                  }`}>
                    {isDone && isServerCommitted
                      ? <CloudUpload className="h-3.5 w-3.5" />
                      : isDone
                        ? <Check className="h-3.5 w-3.5" />
                        : isSkipped
                          ? <Minus className="h-3.5 w-3.5" />
                          : <Icon className="h-3.5 w-3.5" />
                    }
                  </div>
                  <span className={`text-[10px] leading-tight font-medium ${
                    isActive ? 'text-primary' : (isDone && isServerCommitted) ? 'text-blue-600' : isDone ? 'text-green-600' : isSkipped ? 'text-muted-foreground/50' : 'text-muted-foreground/40'
                  }`}>
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* ── Body ── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5">
            {loadingData ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                <p className="text-sm text-muted-foreground">Loading employee data…</p>
              </div>
            ) : (
              <>
                {stepKey === 'email' && (
                  <StepEmail
                    assigneeId={state.emailAssigneeId}
                    users={availableUsers}
                    emailCount={employeeData?.emails.length ?? 0}
                    departingUserName={departingUserName}
                    privateEmailsRemoved={state.privateEmailsRemoved}
                    onChange={setEmailAssignee}
                    onPrivateEmailsRemovedChange={(v) => setState((p) => ({ ...p, privateEmailsRemoved: v }))}
                  />
                )}
                {stepKey === 'clients' && (
                  <StepItems
                    label="Won Clients" icon={Users}
                    items={employeeData?.clients ?? []}
                    mode={state.clientMode} map={state.clientMap}
                    defaultAssigneeId={state.defaultAssigneeId} users={availableUsers}
                    onModeChange={(m) => setState((p) => ({ ...p, clientMode: m }))}
                    onItemChange={(id, uid) => setItemAssignee('clientMap', id, uid)}
                    onBulkChange={(items, uid) => setBulkAssignee('clientMap', items, uid)}
                  />
                )}
                {stepKey === 'pipeline' && (
                  <StepItems
                    label="Pipeline / Deals" icon={TrendingUp}
                    items={employeeData?.pipeline ?? []}
                    mode={state.pipelineMode} map={state.pipelineMap}
                    defaultAssigneeId={state.defaultAssigneeId} users={availableUsers}
                    onModeChange={(m) => setState((p) => ({ ...p, pipelineMode: m }))}
                    onItemChange={(id, uid) => setItemAssignee('pipelineMap', id, uid)}
                    onBulkChange={(items, uid) => setBulkAssignee('pipelineMap', items, uid)}
                  />
                )}
                {stepKey === 'leads' && (
                  <StepItems
                    label="Leads" icon={Briefcase}
                    items={employeeData?.leads ?? []}
                    mode={state.leadMode} map={state.leadMap}
                    defaultAssigneeId={state.defaultAssigneeId} users={availableUsers}
                    onModeChange={(m) => setState((p) => ({ ...p, leadMode: m }))}
                    onItemChange={(id, uid) => setItemAssignee('leadMap', id, uid)}
                    onBulkChange={(items, uid) => setBulkAssignee('leadMap', items, uid)}
                  />
                )}
                {stepKey === 'tasks' && (
                  <StepItems
                    label="Tasks" icon={ClipboardList}
                    items={employeeData?.tasks ?? []}
                    mode={state.taskMode} map={state.taskMap}
                    defaultAssigneeId={state.defaultAssigneeId} users={availableUsers}
                    onModeChange={(m) => setState((p) => ({ ...p, taskMode: m }))}
                    onItemChange={(id, uid) => setItemAssignee('taskMap', id, uid)}
                    onBulkChange={(items, uid) => setBulkAssignee('taskMap', items, uid)}
                  />
                )}
                {stepKey === 'meetings' && (
                  <StepItems
                    label="Meetings" icon={CalendarDays}
                    items={employeeData?.meetings ?? []}
                    mode={state.meetingMode} map={state.meetingMap}
                    defaultAssigneeId={state.defaultAssigneeId} users={availableUsers}
                    onModeChange={(m) => setState((p) => ({ ...p, meetingMode: m }))}
                    onItemChange={(id, uid) => setItemAssignee('meetingMap', id, uid)}
                    onBulkChange={(items, uid) => setBulkAssignee('meetingMap', items, uid)}
                  />
                )}
                {stepKey === 'followups' && (
                  <StepItems
                    label="Follow-Ups" icon={Bell}
                    items={employeeData?.followUps ?? []}
                    mode={state.followupMode} map={state.followupMap}
                    defaultAssigneeId={state.defaultAssigneeId} users={availableUsers}
                    onModeChange={(m) => setState((p) => ({ ...p, followupMode: m }))}
                    onItemChange={(id, uid) => setItemAssignee('followupMap', id, uid)}
                    onBulkChange={(items, uid) => setBulkAssignee('followupMap', items, uid)}
                  />
                )}
                {stepKey === 'review' && (
                  <StepReview
                    employeeData={employeeData}
                    state={state}
                    users={availableUsers}
                    locked={locked}
                    onDeactivateChange={(v) => setState((p) => ({ ...p, deactivateUser: v }))}
                  />
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3 bg-muted/30">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={state.step === 0 || mutation.isPending}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>

          {stepKey !== 'review' ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={handleSkip}
                disabled={mutation.isPending}
                className="text-muted-foreground"
              >
                Skip
              </Button>
              <Button
                variant="outline"
                onClick={handleSaveProgress}
                disabled={mutation.isPending}
              >
                Save Progress
              </Button>
              <Button
                onClick={handleNext}
                disabled={loadingData || (state.step === 0 && !state.privateEmailsRemoved)}
                className="gap-1 px-6"
              >
                Continue <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : locked ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={mutation.isPending}
              className="gap-2 px-6 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {mutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                : <><LogOut className="h-4 w-4" /> Save and Close</>
              }
            </Button>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StepEmail({
  assigneeId, emailCount, departingUserName, users, onChange,
  privateEmailsRemoved, onPrivateEmailsRemovedChange,
}: {
  assigneeId: string | null;
  emailCount: number;
  departingUserName: string;
  users: UserOption[];
  onChange: (userId: string) => void;
  privateEmailsRemoved: boolean;
  onPrivateEmailsRemovedChange: (checked: boolean) => void;
}) {
  const firstName = departingUserName.split(' ')[0];
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-amber-50 border-amber-200 px-4 py-3 flex items-start gap-3">
        <Mail className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-900">
            {emailCount} existing email{emailCount !== 1 ? 's' : ''} to transfer
          </p>
          <p className="text-xs text-amber-700 leading-relaxed">
            {firstName}&apos;s current inbox, sent, and draft emails will be transferred to the selected person.
          </p>
          <p className="text-xs text-amber-700 leading-relaxed">
            Going forward, <strong>any new emails sent to {firstName}&apos;s address will be automatically forwarded</strong> to them as well.
          </p>
          <p className="text-xs text-amber-700 leading-relaxed">
            This person also becomes the <strong>default assignee</strong> for all later steps.
          </p>
        </div>
      </div>
      <div className="rounded-xl border-2 border-amber-400 bg-white px-4 py-3.5 shadow-sm">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            id="private-emails-removed"
            checked={privateEmailsRemoved}
            onCheckedChange={(v) => onPrivateEmailsRemovedChange(v === true)}
            className="mt-0.5 h-5 w-5 shrink-0 border-amber-500 data-[state=checked]:bg-amber-600 data-[state=checked]:border-amber-600"
          />
          <span className="text-sm font-semibold text-foreground leading-snug">
            All private and other important personal emails have been removed from {firstName}&apos;s account.
          </span>
        </label>
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium">Forward all emails to</Label>
        <UserPicker users={users} value={assigneeId} onChange={onChange} />
      </div>
    </div>
  );
}

function StepItems({
  label, icon: Icon, items, mode, map, defaultAssigneeId, users,
  onModeChange, onItemChange, onBulkChange,
}: {
  label: string;
  icon: React.ElementType;
  items: OffboardingDataItem[];
  mode: 'all' | 'individual';
  map: AssignMap;
  defaultAssigneeId: string | null;
  users: UserOption[];
  onModeChange: (m: 'all' | 'individual') => void;
  onItemChange: (id: string, userId: string) => void;
  onBulkChange: (items: OffboardingDataItem[], userId: string) => void;
}) {
  const [bulkValue, setBulkValue] = useState<string | null>(defaultAssigneeId);
  useEffect(() => { setBulkValue(defaultAssigneeId); }, [defaultAssigneeId]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 gap-3">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Icon className="h-6 w-6 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">No {label.toLowerCase()} to reassign</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-medium">{items.length} {label.toLowerCase()} to reassign</span>
        </div>
        <div className="flex items-center rounded-lg border bg-muted p-0.5 gap-0.5">
          <button
            onClick={() => onModeChange('all')}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${
              mode === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All to one
          </button>
          <button
            onClick={() => onModeChange('individual')}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${
              mode === 'individual' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Individual
          </button>
        </div>
      </div>

      {mode === 'all' ? (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">Assign all {items.length} {label.toLowerCase()} to one person</p>
          <UserPicker
            users={users}
            value={bulkValue}
            onChange={(uid) => { setBulkValue(uid); onBulkChange(items, uid); }}
          />
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden divide-y">
          {items.map((item, idx) => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                {item.subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>}
              </div>
              <div className="shrink-0 w-48">
                <UserPicker
                  users={users}
                  value={map[item.id] ?? defaultAssigneeId}
                  onChange={(uid) => onItemChange(item.id, uid)}
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getEffectiveLabel(
  mode: 'all' | 'individual',
  map: AssignMap,
  items: OffboardingDataItem[],
  fallback: string | null,
  getUser: (id: string | null | undefined) => UserOption | undefined,
): { label: string; warning: boolean } {
  if (items.length === 0) return { label: 'None', warning: false };
  if (mode === 'individual') {
    const ids = new Set(items.map((i) => map[i.id] ?? fallback).filter(Boolean));
    if (ids.size === 1) {
      const u = getUser([...ids][0] as string);
      return { label: u ? `${u.firstName} ${u.lastName}` : '—', warning: !u };
    }
    return { label: `${ids.size} people`, warning: false };
  }
  const id = map[items[0].id] ?? fallback;
  const u = getUser(id);
  return { label: u ? `${u.firstName} ${u.lastName}` : '—', warning: !u };
}

function StepReview({
  employeeData, state, users, locked, onDeactivateChange,
}: {
  employeeData: OffboardingEmployeeData | undefined;
  state: WizardState;
  users: UserOption[];
  locked: boolean;
  onDeactivateChange: (v: boolean) => void;
}) {
  const getUser = (id: string | null | undefined) => users.find((u) => u.id === id);
  const fallback = state.defaultAssigneeId;
  const emailUser = getUser(state.emailAssigneeId);

  const skippedStepLabels = STEPS
    .filter((_, i) => state.stepStatuses[i] === 'skipped')
    .map((s) => s.label);

  const rows = [
    { label: 'Emails',      icon: Mail,          stepIdx: 0, count: employeeData?.emails.length ?? 0,    effective: { label: emailUser ? `${emailUser.firstName} ${emailUser.lastName}` : '—', warning: !emailUser } },
    { label: 'Won Clients', icon: Users,          stepIdx: 1, count: employeeData?.clients.length ?? 0,   effective: getEffectiveLabel(state.clientMode,   state.clientMap,   employeeData?.clients   ?? [], fallback, getUser) },
    { label: 'Pipeline',    icon: TrendingUp,     stepIdx: 2, count: employeeData?.pipeline.length ?? 0,  effective: getEffectiveLabel(state.pipelineMode, state.pipelineMap, employeeData?.pipeline  ?? [], fallback, getUser) },
    { label: 'Leads',       icon: Briefcase,      stepIdx: 3, count: employeeData?.leads.length ?? 0,     effective: getEffectiveLabel(state.leadMode,     state.leadMap,     employeeData?.leads     ?? [], fallback, getUser) },
    { label: 'Tasks',       icon: ClipboardList,  stepIdx: 4, count: employeeData?.tasks.length ?? 0,     effective: getEffectiveLabel(state.taskMode,     state.taskMap,     employeeData?.tasks     ?? [], fallback, getUser) },
    { label: 'Meetings',    icon: CalendarDays,   stepIdx: 5, count: employeeData?.meetings.length ?? 0,  effective: getEffectiveLabel(state.meetingMode,  state.meetingMap,  employeeData?.meetings  ?? [], fallback, getUser) },
    { label: 'Follow-Ups',  icon: Bell,           stepIdx: 6, count: employeeData?.followUps.length ?? 0, effective: getEffectiveLabel(state.followupMode, state.followupMap, employeeData?.followUps ?? [], fallback, getUser) },
  ].map((r) => ({ ...r, skipped: state.stepStatuses[r.stepIdx] === 'skipped' }));

  const totalItems = rows.filter((r) => !r.skipped).reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-5">
      {locked ? (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-start gap-3">
          <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Offboarding complete</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This offboarding has been finalized and can no longer be edited.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <ArrowRightLeft className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Ready to transfer {totalItems} items</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Review the assignments below. Once you click <strong>Save and Close</strong>, this offboarding will be finalized and locked.
            </p>
          </div>
        </div>
      )}

      {skippedStepLabels.length > 0 && !locked && (
        <div className="rounded-xl border border-border px-4 py-3 flex items-start gap-3">
          <Minus className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Skipped steps</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {skippedStepLabels.join(', ')} — items in skipped steps will be assigned using the default assignee. Go back to assign them individually.
            </p>
          </div>
        </div>
      )}

      {/* Summary table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="grid grid-cols-3 px-4 py-2 bg-muted/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <span>Category</span>
          <span className="text-center">Items</span>
          <span>Goes to</span>
        </div>
        {rows.filter((r) => r.count > 0).map((row, i) => {
          const Icon = row.icon;
          return (
            <div
              key={row.label}
              className={`grid grid-cols-3 px-4 py-3 items-center text-sm ${
                row.skipped ? 'opacity-40' : i % 2 === 0 ? 'bg-background' : 'bg-muted/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className={`font-medium ${row.skipped ? 'line-through' : ''}`}>{row.label}</span>
              </div>
              <div className="flex justify-center">
                <Badge variant="secondary" className="tabular-nums text-xs">{row.count}</Badge>
              </div>
              {row.skipped ? (
                <span className="text-muted-foreground italic text-xs">Skipped — go back to assign</span>
              ) : (
                <span className={row.effective.warning ? 'text-amber-600 font-medium' : 'text-foreground'}>
                  {row.effective.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!locked && (
        <div className="flex items-start gap-3 rounded-xl border px-4 py-3 bg-muted/30">
          <Checkbox
            id="deactivate-user"
            checked={state.deactivateUser}
            onCheckedChange={(v) => onDeactivateChange(!!v)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor="deactivate-user" className="cursor-pointer text-sm font-medium">
              Deactivate login after offboarding
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Prevents the user from logging in once the transfer completes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function UserPicker({
  users, value, onChange, compact,
}: {
  users: UserOption[];
  value: string | null | undefined;
  onChange: (userId: string) => void;
  compact?: boolean;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger className={compact ? 'h-8 text-xs' : undefined}>
        <SelectValue placeholder="Select a person…" />
      </SelectTrigger>
      <SelectContent className="z-[300]" position="popper" sideOffset={4}>
        {users.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No users available</div>
        ) : (
          users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.firstName} {u.lastName}{' '}
              <span className="text-xs text-muted-foreground opacity-70">({u.role})</span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
