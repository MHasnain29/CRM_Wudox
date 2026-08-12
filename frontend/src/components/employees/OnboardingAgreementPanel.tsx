/**
 * Onboarding agreement gate for Unregistered employees — live PandaDoc APIs.
 * Send package → poll/sync signature status → submit for approval when signed.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  Eye,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { onEmployeeOnboardingRefresh } from '@/lib/socket';
import {
  fetchEmployeeOnboardingStatus,
  sendEmployeeOnboarding,
  syncEmployeeOnboarding,
  type EmployeeOnboardingStatus,
} from '@/lib/api';
import type { OnboardingEmployeeInput } from './onboarding/buildOnboardingPrefill';
import { getOnboardingPreview } from './onboarding/getOnboardingPreview';
import {
  ONBOARDING_PACKAGE_META,
  ONBOARDING_PACKAGE_NAME,
  OnboardingFilledPreviewDialog,
} from './onboarding/OnboardingFilledPreviewDialog';
import { EmployeePdfPreviewDialog } from '@/components/employees/EmployeePdfPreviewDialog';

export type OnboardingAgreementStatus = 'not_sent' | 'awaiting' | 'ready';

type Props = {
  employee: OnboardingEmployeeInput & { id: string };
  busy?: boolean;
  rejectionReason?: string | null;
  onSubmitForApproval: () => void;
};

function deriveStatus(s: EmployeeOnboardingStatus | undefined): OnboardingAgreementStatus {
  if (!s) return 'not_sent';
  if (s.completed) return 'ready';
  if (s.pandaDocId) return 'awaiting';
  return 'not_sent';
}

/** True only after a real PandaDoc completion (not seed/script placeholder agreements). */
function isPandaDocSigned(s: EmployeeOnboardingStatus | undefined): boolean {
  const st = s?.status ?? '';
  return st === 'document.completed' || st === 'document.paid';
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OnboardingAgreementPanel({
  employee,
  busy = false,
  rejectionReason,
  onSubmitForApproval,
}: Props) {
  const agencyName = useStore((s) => s.currentSubCompany?.name ?? '');
  const emailSendAsDomain = useStore((s) => s.currentSubCompany?.emailSendAsDomain ?? null);
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signedPreviewOpen, setSignedPreviewOpen] = useState(false);

  const { data: onboarding, isLoading } = useQuery({
    queryKey: ['employee-onboarding', employee.id],
    queryFn: () => fetchEmployeeOnboardingStatus(employee.id),
  });

  useEffect(() => {
    return onEmployeeOnboardingRefresh((payload) => {
      if (payload.employeeId !== employee.id) return;
      void queryClient.invalidateQueries({ queryKey: ['employee-onboarding', employee.id] });
      if (payload.completed) {
        toast.success('Agreement signed', {
          description: 'Employee signed the onboarding package. You can submit for approval.',
        });
      }
    });
  }, [employee.id, queryClient]);

  const status = deriveStatus(onboarding);
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
  const employeeEmail = employee.email;
  const recipient = employeeEmail || employeeName;
  const updatedAt = formatWhen(onboarding?.updatedAt);

  const preview = useMemo(
    () => getOnboardingPreview(employee, { name: agencyName, emailSendAsDomain }),
    [employee, agencyName, emailSendAsDomain],
  );

  const applyStatus = (next: EmployeeOnboardingStatus) => {
    queryClient.setQueryData(['employee-onboarding', employee.id], next);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const next = await sendEmployeeOnboarding(employee.id);
      applyStatus(next);
      if (next.trainingEmailed) {
        toast.success('Agreement and training sent', {
          description: `Sent to ${recipient}`,
        });
      } else {
        toast.warning('Agreement sent', {
          description:
            next.trainingError?.trim() ||
            `PandaDoc package sent to ${recipient}, but the training email was not sent.`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send onboarding agreement');
    } finally {
      setSending(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const next = await syncEmployeeOnboarding(employee.id);
      applyStatus(next);
      if (next.completed) {
        toast.success('Agreement signed', {
          description: 'Employee signed the onboarding package. You can submit for approval.',
        });
      } else {
        toast.info('Still awaiting signature', {
          description: next.status ? `PandaDoc status: ${next.status}` : undefined,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync onboarding agreement');
    } finally {
      setSyncing(false);
    }
  };

  const signedDoc = onboarding?.agreementDocument ?? null;
  const pandaDocSigned = isPandaDocSigned(onboarding);

  const handleView = () => {
    // Real PandaDoc signature → stored PDF in the same in-page modal.
    // Script/seed / not-sent employees → local filled preview modal.
    if (pandaDocSigned) {
      if (!signedDoc) {
        toast.info('Signed PDF not on file yet', {
          description: 'Click Sync status to pull the signed document from PandaDoc.',
        });
        return;
      }
      setSignedPreviewOpen(true);
      return;
    }
    setPreviewOpen(true);
  };

  return (
    <div className="mb-5">
      <motion.div
        layout
        className={cn(
          'overflow-hidden rounded-xl border transition-colors',
          status === 'ready'
            ? 'border-emerald-200/80 bg-gradient-to-b from-emerald-50/80 to-background'
            : status === 'awaiting'
              ? 'border-border bg-gradient-to-b from-muted/50 to-background'
              : 'border-border bg-gradient-to-b from-muted/30 to-background',
        )}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
              Onboarding agreement
            </p>
            <p className="text-[13px] font-semibold tracking-tight text-foreground">
              {isLoading && 'Loading…'}
              {!isLoading && status === 'not_sent' && 'Ready to send'}
              {!isLoading && status === 'awaiting' && 'Awaiting signature'}
              {!isLoading && status === 'ready' && 'Signed & ready'}
            </p>
          </div>
          <StatusChip status={status} syncing={syncing || sending || isLoading} />
        </div>

        <div className="px-4 pb-3">
          <div
            className={cn(
              'relative overflow-hidden rounded-lg border bg-background/80 px-3 py-3',
              status === 'awaiting' && 'border-dashed',
            )}
          >
            {status === 'awaiting' && (
              <motion.span
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/[0.06] to-transparent"
                initial={{ x: '-100%' }}
                animate={{ x: '300%' }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                aria-hidden
              />
            )}
            <div className="relative flex items-start gap-3">
              <div
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                  status === 'ready'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-border bg-muted/60 text-muted-foreground',
                )}
              >
                {status === 'ready' ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-snug">{ONBOARDING_PACKAGE_NAME}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{ONBOARDING_PACKAGE_META}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Mail className="h-3 w-3 shrink-0 opacity-70" />
                  <span className="truncate">{recipient}</span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => void handleView()}
                aria-label="View"
                title="View"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>

            <AnimatePresence mode="wait">
              {updatedAt && status !== 'not_sent' && (
                <motion.div
                  key={`${status}-${updatedAt}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="relative mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/70 pt-2.5 text-[11px] text-muted-foreground"
                >
                  {status === 'awaiting' && <span>Sent {updatedAt}</span>}
                  {status === 'ready' && (
                    <span className="font-medium text-emerald-700">Signed {updatedAt}</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {rejectionReason && (
          <p className="px-4 pb-2 text-[12px] leading-relaxed text-destructive/90">
            Previously rejected — {rejectionReason}
          </p>
        )}

        <div className="border-t border-border/60 bg-background/40 px-4 py-3">
          <AnimatePresence mode="wait">
            {status === 'not_sent' && (
              <motion.div
                key="send"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <Button
                  className="h-10 w-full font-medium shadow-sm"
                  onClick={() => void handleSend()}
                  disabled={busy || sending || isLoading}
                >
                  {sending ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-3.5 w-3.5 opacity-90" />
                  )}
                  Send Onboarding Agreement
                  <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-60" />
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Sends the PandaDoc onboarding package by email
                </p>
              </motion.div>
            )}

            {status === 'awaiting' && (
              <motion.div
                key="sync"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <Button
                  className="h-10 w-full font-medium"
                  variant="outline"
                  onClick={() => void handleSync()}
                  disabled={busy || syncing}
                >
                  {syncing ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  )}
                  {syncing ? 'Checking PandaDoc…' : 'Sync signature status'}
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Auto-updates when PandaDoc webhook is configured; use Sync if status looks stuck
                </p>
              </motion.div>
            )}

            {status === 'ready' && (
              <motion.div
                key="submit"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <Button
                  className="h-10 w-full font-medium shadow-sm"
                  onClick={onSubmitForApproval}
                  disabled={busy}
                >
                  <Check className="mr-2 h-3.5 w-3.5" />
                  Submit for Approval
                  <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-60" />
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Routes to Recruitment Manager · then Master
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <OnboardingFilledPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        prefill={preview.mode === 'local' ? preview.prefill : null}
      />
      <EmployeePdfPreviewDialog
        open={signedPreviewOpen}
        onOpenChange={setSignedPreviewOpen}
        employeeId={employee.id}
        docId={signedDoc?.id ?? null}
        fileName={signedDoc?.name}
      />
    </div>
  );
}

function StatusChip({
  status,
  syncing,
}: {
  status: OnboardingAgreementStatus;
  syncing: boolean;
}) {
  const label =
    syncing
      ? 'Syncing'
      : status === 'not_sent'
        ? 'Not sent'
        : status === 'awaiting'
          ? 'Pending'
          : 'Complete';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide',
        status === 'ready' && 'bg-emerald-100 text-emerald-800',
        status === 'awaiting' && 'bg-amber-100 text-amber-900',
        status === 'not_sent' && 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'ready' && 'bg-emerald-500',
          status === 'awaiting' && (syncing ? 'animate-pulse bg-amber-500' : 'bg-amber-500'),
          status === 'not_sent' && 'bg-muted-foreground/50',
        )}
      />
      {label}
    </span>
  );
}
