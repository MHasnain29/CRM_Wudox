import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { CalendarDays, Clock3, MessageSquare, UserCheck } from 'lucide-react';
import LeaveDurationBadge from '@/components/LeaveDurationBadge';
import { Badge } from '@/components/ui/badge';
import {
  formatLeaveDate, formatLeaveDays, formatLeaveMinutes, formatLeaveTime,
  HOURLY_LEAVE_CATEGORY_LABELS, LEAVE_SESSION_LABELS, type LeaveTimingFields,
} from '@/lib/leave';

export interface LeaveAdminRequest extends LeaveTimingFields {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdAt: string;
  user: { id: string; firstName: string; lastName: string };
  leaveType: { id: string; name: string; paid: boolean };
  approver: { firstName: string; lastName: string } | null;
}

interface LeaveAdminRequestCardProps {
  request: LeaveAdminRequest;
  actions?: ReactNode;
  showSubmittedDate?: boolean;
}

const STATUS_STYLES: Record<LeaveAdminRequest['status'], string> = {
  pending: 'border-amber-200/70 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300',
  approved: 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300',
  rejected: 'border-red-200/70 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

export default function LeaveAdminRequestCard({
  request, actions, showSubmittedDate = false,
}: LeaveAdminRequestCardProps) {
  const hourly = request.session === 'hourly';
  const sameDate = request.startDate.slice(0, 10) === request.endDate.slice(0, 10);
  const dates = sameDate
    ? formatLeaveDate(request.startDate)
    : `${formatLeaveDate(request.startDate)} – ${formatLeaveDate(request.endDate)}`;
  const duration = hourly
    ? request.durationMinutes != null ? formatLeaveMinutes(request.durationMinutes) : 'Hourly'
    : `${formatLeaveDays(request.days)} ${request.days === 1 ? 'day' : 'days'}`;
  const sessionLabel = hourly
    ? request.hourlyCategory ? HOURLY_LEAVE_CATEGORY_LABELS[request.hourlyCategory] : 'Hourly'
    : LEAVE_SESSION_LABELS[request.session ?? 'full_day'];
  const initials = `${request.user.firstName.charAt(0)}${request.user.lastName.charAt(0)}`.toUpperCase();

  return (
    <article className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-primary/10 text-xs font-semibold text-primary">
            {initials}
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold leading-snug text-foreground">
              {request.user.firstName} {request.user.lastName}
            </h3>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{request.leaveType.name}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-[46px] sm:pl-0">
          <Badge variant="outline" className={`gap-1.5 px-2.5 py-0.5 text-[11px] capitalize ${STATUS_STYLES[request.status]}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {request.status}
          </Badge>
          <LeaveDurationBadge session={request.session} hourlyCategory={request.hourlyCategory} />
        </div>
      </div>

      <dl className="mt-3 grid gap-3 rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <CalendarDays size={13} aria-hidden="true" /> {sameDate ? 'Date' : 'Dates'}
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">{dates}</dd>
          {hourly && request.startTime && request.endTime && <dd className="mt-0.5 text-xs text-muted-foreground">
            {formatLeaveTime(request.startTime) || request.startTime} – {formatLeaveTime(request.endTime) || request.endTime}
          </dd>}
          {hourly && request.timezone && <dd className="mt-0.5 break-words text-[11px] text-muted-foreground">{request.timezone}</dd>}
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Clock3 size={13} aria-hidden="true" /> Duration
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">{duration}</dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">{sessionLabel}</dd>
        </div>
      </dl>

      {request.reason && <div className="mt-3 flex items-start gap-2 text-sm">
        <MessageSquare size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">Reason</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words leading-5 text-foreground/85">{request.reason}</p>
        </div>
      </div>}

      {(showSubmittedDate || request.approver || actions) && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        {showSubmittedDate ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock3 size={13} aria-hidden="true" /> Submitted {format(new Date(request.createdAt), 'dd MMM yyyy')}
        </p> : request.approver ? <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
          <UserCheck size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="break-words">{request.status === 'approved' ? 'Approved' : 'Reviewed'} by {request.approver.firstName} {request.approver.lastName}</span>
        </p> : null}
        {actions && <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">{actions}</div>}
      </div>}
    </article>
  );
}
