import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  Mail,
  Phone,
  MapPin,
  Clock,
  Briefcase,
  LogOut,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  Circle,
  Minus,
  Users,
  TrendingUp,
  ClipboardList,
  CalendarDays,
  Bell,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OffboardingStep {
  key: string;
  label: string;
  status: 'done' | 'pending' | 'skipped';
  assignees?: { name: string; count: number }[];
}

export interface OffboardingUserDetail {
  type: 'offboarding';
  name: string;
  email: string;
  role: string;
  location: string;
  country?: string;
  agency?: string;
  phone?: string;
  workHours?: string;
  status: string;
  started: string;
  manager?: string;
  steps?: OffboardingStep[];
}

export interface PastUserDetail {
  type: 'past';
  name: string;
  email: string;
  role: string;
  location: string;
  country?: string;
  agency?: string;
  phone?: string;
  workHours?: string;
  departed: string;
  by: string;
  tenure?: string;
  steps?: OffboardingStep[];
}

type UserDetail = OffboardingUserDetail | PastUserDetail;

interface Props {
  user: UserDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  clients: Users,
  pipeline: TrendingUp,
  leads: Briefcase,
  tasks: ClipboardList,
  meetings: CalendarDays,
  followups: Bell,
};

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-sky-100    text-sky-700    dark:bg-sky-900/40    dark:text-sky-300',
  'bg-teal-100   text-teal-700   dark:bg-teal-900/40   dark:text-teal-300',
  'bg-rose-100   text-rose-700   dark:bg-rose-900/40   dark:text-rose-300',
  'bg-amber-100  text-amber-700  dark:bg-amber-900/40  dark:text-amber-300',
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
      {children}
    </p>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-sm font-medium text-foreground leading-snug truncate">{value}</p>
    </div>
  );
}

function StatPill({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-4 py-3 flex-1">
      <span className="text-base font-bold text-foreground tabular-nums leading-none">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function StepRow({ step }: { step: OffboardingStep }) {
  const Icon = STEP_ICONS[step.key] ?? Briefcase;

  if (step.status === 'done') {
    const totalCount = step.assignees?.reduce((s, a) => s + a.count, 0) ?? 0;
    return (
      <div className="rounded-lg border border-border bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground">{step.label}</span>
          </div>
          {totalCount > 0 && (
            <span className="text-xs tabular-nums font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
              {totalCount}
            </span>
          )}
        </div>
        {step.assignees && step.assignees.length > 0 && (
          <div className="mt-2 pl-7 space-y-1">
            {step.assignees.map((a) => (
              <div key={a.name} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  → <span className="font-medium text-foreground">{a.name}</span>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{a.count} items</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step.status === 'skipped') {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 flex items-center gap-3">
        <Minus className="h-4 w-4 text-muted-foreground/40 shrink-0" />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Icon className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <span className="text-sm text-muted-foreground/60">{step.label}</span>
        </div>
        <span className="text-xs text-muted-foreground/50 shrink-0">Nothing to reassign</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-3 flex items-center gap-3">
      <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-sm text-muted-foreground">{step.label}</span>
      </div>
      <Badge variant="outline" className="text-[11px] shrink-0 border-orange-200 text-orange-600 bg-orange-50/60 dark:bg-orange-950/20 dark:border-orange-800/50">
        Pending
      </Badge>
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-indigo-500 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UserDetailSheet({ user, open, onOpenChange }: Props) {
  if (!user) return null;

  const isOffboarding = user.type === 'offboarding';
  const steps = user.steps ?? [];
  const doneCount  = steps.filter((s) => s.status === 'done').length;
  const totalItems = steps.filter((s) => s.status === 'done').reduce((sum, s) => sum + (s.assignees?.reduce((a, b) => a + b.count, 0) ?? 0), 0);
  const avatarCls  = avatarColor(user.name);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[480px] p-0 flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 pt-10 pb-5 border-b">
          <div className="flex items-center gap-4">
            <div className={`h-14 w-14 rounded-xl flex items-center justify-center shrink-0 text-lg font-bold ${avatarCls}`}>
              {initials(user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <SheetHeader className="p-0 space-y-0">
                <SheetTitle className="text-lg font-bold text-foreground text-left leading-tight">
                  {user.name}
                </SheetTitle>
              </SheetHeader>
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{user.email}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <Badge variant="secondary" className="text-xs">{user.role}</Badge>
                <Badge variant="outline" className="text-xs">HR Global</Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 pt-3.5 border-t border-border/50 text-xs text-muted-foreground">
            {isOffboarding ? (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                <span>
                  <span className="font-semibold text-foreground">{(user as OffboardingUserDetail).status}</span>
                  <span className="mx-1.5">·</span>
                  Started {(user as OffboardingUserDetail).started}
                </span>
              </>
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>
                  Departed <span className="font-semibold text-foreground">{(user as PastUserDetail).departed}</span>
                  {(user as PastUserDetail).tenure && (
                    <><span className="mx-1.5">·</span>{(user as PastUserDetail).tenure}</>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── Stats strip ── */}
        {steps.length > 0 && (
          <div className="flex divide-x divide-border border-b shrink-0 bg-muted/10">
            <StatPill value={`${doneCount}/${steps.length}`} label="Categories done" />
            <StatPill value={totalItems} label="Items reassigned" />
            {isOffboarding
              ? <StatPill value={steps.length - doneCount} label="Remaining" />
              : <StatPill value={(user as PastUserDetail).by} label="Offboarded by" />
            }
          </div>
        )}

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-5 space-y-6">

            {/* Details grid */}
            <div>
              <SectionLabel>Details</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <InfoCard icon={Mail} label="Email" value={user.email} />
                {user.phone
                  ? <InfoCard icon={Phone} label="Phone" value={user.phone} />
                  : <InfoCard icon={MapPin} label="Location" value={user.country ? `${user.location}, ${user.country}` : user.location} />
                }
                {user.phone && (
                  <InfoCard icon={MapPin} label="Location" value={user.country ? `${user.location}, ${user.country}` : user.location} />
                )}
                {user.workHours && (
                  <InfoCard icon={Clock} label="Working Hours" value={user.workHours} />
                )}
                {isOffboarding && (user as OffboardingUserDetail).manager && (
                  <InfoCard icon={UserCheck} label="Manager" value={(user as OffboardingUserDetail).manager!} />
                )}
                {!isOffboarding && (
                  <InfoCard icon={UserCheck} label="Offboarded By" value={(user as PastUserDetail).by} />
                )}
              </div>
            </div>

            {/* Data Reassignment */}
            {steps.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel>Data Reassignment</SectionLabel>
                </div>

                <ProgressBar done={doneCount} total={steps.length} />
                <div className="flex items-center justify-between mt-1.5 mb-4">
                  <p className="text-xs text-muted-foreground">
                    {doneCount === steps.length ? 'All categories reassigned' : `${steps.length - doneCount} remaining`}
                  </p>
                  <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {doneCount} / {steps.length}
                  </p>
                </div>

                <div className="space-y-1.5">
                  {steps.map((step) => <StepRow key={step.key} step={step} />)}
                </div>
              </div>
            )}

          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
