import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRight, CheckCircle2, XCircle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchApprovalStatus,
  postApprovalAction,
  type ApprovalWorkflowType,
  type ApprovalStatusResponse,
} from '@/lib/api';
import { mapApprovalApiError, formatRoleLabel, formatApprovalHistoryLine } from '@/lib/approvalMessages';

type Props = {
  workflow: ApprovalWorkflowType;
  entityId: string;
  subCompanyId?: string;
  remarks?: string;
  requireRemarksForReject?: boolean;
  customApprove?: () => Promise<void>;
  /** When set, Final approve opens this handler instead of running customApprove immediately. */
  onApproveClick?: () => void;
  finalApproveLabel?: string;
  forwardLabel?: string;
  onActionComplete?: () => void;
  compact?: boolean;
  onView?: () => void;
  afterViewSlot?: React.ReactNode;
};

export function ApprovalQueueActions({
  workflow,
  entityId,
  subCompanyId,
  remarks,
  requireRemarksForReject = false,
  customApprove,
  onApproveClick,
  finalApproveLabel = 'Final approve',
  forwardLabel = 'Forward',
  onActionComplete,
  compact = false,
  onView,
  afterViewSlot,
}: Props) {
  const [status, setStatus] = useState<ApprovalStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<'forward' | 'approve' | 'reject' | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApprovalStatus(workflow, entityId, subCompanyId);
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [workflow, entityId, subCompanyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runAction = async (action: 'forward' | 'approve' | 'reject') => {
    if (action === 'reject' && requireRemarksForReject && !remarks?.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    setActing(action);
    try {
      if (action === 'approve' && customApprove) {
        await customApprove();
      } else {
        await postApprovalAction(workflow, entityId, action, {
          subCompanyId,
          remarks: remarks?.trim() || undefined,
        });
      }
      await reload();
      onActionComplete?.();
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Action failed';
      toast.error(mapApprovalApiError(raw, status?.targetRoleKey));
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading approval status…
      </div>
    );
  }

  if (!status || status.totalSteps === 0) return null;

  const stepNum = Math.min(status.currentStepIndex + 1, status.totalSteps);
  const target = status.targetRoleKey ? formatRoleLabel(status.targetRoleKey) : 'approver';
  const actionHint = status.isDirectApproval
    ? 'direct approval available'
    : status.isFinalStep
      ? 'final approval'
      : 'forward';
  const nextHint =
    !status.isDirectApproval && !status.isFinalStep && status.nextRoleKey
      ? ` → ${formatRoleLabel(status.nextRoleKey)}`
      : '';

  const showActions = status.allowedAction || status.canReject;

  return (
    <div className={compact ? '' : 'rounded-md border p-2.5 bg-muted/30'}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="shrink-0 text-xs">
          Step {stepNum} of {status.totalSteps}
        </Badge>
        {status.isDirectApproval ? (
          <span className="text-xs text-muted-foreground min-w-0">
            Awaiting <span className="font-medium text-foreground">{target}</span>
            {status.skippedRoleKeys.length > 0 && (
              <>
                {' '}— you can{' '}
                <span className="font-medium text-foreground">approve directly</span>
                {' '}(skips {status.skippedRoleKeys.map(formatRoleLabel).join(', ')})
              </>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground min-w-0">
            Awaiting <span className="font-medium text-foreground">{target}</span>
            {' '}({actionHint}{nextHint})
          </span>
        )}
        {(showActions || onView || afterViewSlot) && (
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            {onView && (
              <Button size="sm" variant="outline" onClick={onView} className="h-7 text-xs px-2.5">
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            )}
            {afterViewSlot}
            {status.allowedAction === 'forward' && (
              <Button size="sm" variant="secondary" disabled={!!acting} onClick={() => runAction('forward')} className="h-7 text-xs px-2.5">
                {acting === 'forward' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ArrowRight className="h-3 w-3 mr-1" />}
                {forwardLabel}
              </Button>
            )}
            {status.allowedAction === 'approve' && (
              <Button
                size="sm"
                disabled={!!acting}
                onClick={() => (onApproveClick ? onApproveClick() : runAction('approve'))}
                className="h-7 text-xs px-2.5"
              >
                {acting === 'approve' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                {status.isDirectApproval ? 'Direct approve' : finalApproveLabel}
              </Button>
            )}
            {status.canReject && (
              <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 text-destructive border-destructive/40 hover:bg-destructive/10" disabled={!!acting} onClick={() => runAction('reject')}>
                {acting === 'reject' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                Reject
              </Button>
            )}
          </div>
        )}
      </div>

      {status.history.length > 0 && !compact && (
        <ul className="text-xs text-muted-foreground space-y-1 border-t pt-2 mt-2">
          {status.history.map((h) => (
            <li key={h.id}>{formatApprovalHistoryLine(h)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
