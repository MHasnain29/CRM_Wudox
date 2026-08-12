import { format, parseISO } from 'date-fns';
import { Activity, Building2, Calendar, CheckSquare, Clock, FileText, Mail, Phone, UserCircle, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DailyActivityItemDto, DailyActivityKind } from '@/lib/api';

const KIND_LABELS: Record<DailyActivityKind, string> = {
  task: 'Task',
  meeting: 'Meeting',
  follow_up: 'Follow-up',
  lead: 'Lead',
  proposal: 'Proposal',
  call: 'Call',
  email: 'Email',
  note: 'Note',
  lead_request: 'Lead request',
  client_submission: 'Client submission',
  client_edit: 'Client edit',
  notification: 'Notification',
  reminder: 'Reminder',
  resource_request: 'Request',
  lead_extension: 'Lead extension',
  proposal_extension: 'Proposal extension',
  employee: 'Employee',
};

const KIND_ICONS: Record<DailyActivityKind, typeof Activity> = {
  task: CheckSquare,
  meeting: Calendar,
  follow_up: Clock,
  lead: UserCircle,
  proposal: FileText,
  call: Phone,
  email: Mail,
  note: FileText,
  lead_request: UserCircle,
  client_submission: Building2,
  client_edit: Building2,
  notification: Activity,
  reminder: Clock,
  resource_request: FileText,
  lead_extension: UserCircle,
  proposal_extension: FileText,
  employee: Users,
};

function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

type Props = {
  item: DailyActivityItemDto;
  onOpen: (item: DailyActivityItemDto) => void;
};

/** Read-only pending-approval row — status + Open only (no approve/reject). */
export function DailyActivityApprovalRow({ item, onOpen }: Props) {
  const Icon = KIND_ICONS[item.kind] ?? Activity;
  const when = item.dueAt ?? item.occurredAt;
  const requesterName = metaString(item.meta, 'requesterName');
  const stepLabel = metaString(item.meta, 'stepLabel') ?? item.subtitle;

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
      onClick={() => onOpen(item)}
    >
      <div className="mt-0.5 rounded-md bg-muted p-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {KIND_LABELS[item.kind] ?? item.kind}
          </Badge>
          <span className="font-medium truncate">{item.title}</span>
        </div>
        {requesterName && (
          <p className="text-sm text-muted-foreground truncate">
            From <span className="text-foreground/80">{requesterName}</span>
          </p>
        )}
        {stepLabel && (
          <p className="text-sm text-muted-foreground truncate">
            Status:{' '}
            <span className={cn('text-foreground/90')}>{stepLabel}</span>
          </p>
        )}
        {when && (
          <p className="text-xs text-muted-foreground">
            {format(parseISO(when), 'MMM d, yyyy · h:mm a')}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs font-medium text-primary">Open →</span>
    </button>
  );
}
