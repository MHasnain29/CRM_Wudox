/**
 * PandaDoc onboarding agreement status for the employee form page and details sheet.
 * Send / Resend / Sync / Preview — separate from the details-sheet submission gate panel.
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, FileText, Loader2, Mail, RefreshCw, Send } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { onEmployeeOnboardingRefresh } from '@/lib/socket';
import {
  fetchEmployeeOnboardingStatus,
  sendEmployeeOnboarding,
  syncEmployeeOnboarding,
  updateEmployee,
  type EmployeeOnboardingStatus,
} from '@/lib/api';
import type { OnboardingEmployeeInput } from '../onboarding/buildOnboardingPrefill';
import { getOnboardingPreview } from '../onboarding/getOnboardingPreview';
import { OnboardingFilledPreviewDialog } from '../onboarding/OnboardingFilledPreviewDialog';
import { ConfirmOnboardingSendDialog } from '../ConfirmOnboardingSendDialog';
import { EmployeePdfPreviewDialog } from '@/components/employees/EmployeePdfPreviewDialog';

type AgreementUiStatus = 'not_sent' | 'awaiting' | 'signed';

function deriveStatus(s: EmployeeOnboardingStatus | undefined): AgreementUiStatus {
  if (!s) return 'not_sent';
  if (s.completed) return 'signed';
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

const STATUS_META: Record<
  AgreementUiStatus,
  { label: string; badgeClass: string; hint: string }
> = {
  not_sent: {
    label: 'Not sent',
    badgeClass: 'bg-muted text-muted-foreground',
    hint: 'Save & Send Agreement asks you to confirm the email and training links, then sends automatically. You can also send the agreement here.',
  },
  awaiting: {
    label: 'Awaiting signature',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    hint: 'PandaDoc package sent. Must be signed before Master approval. Sync when the employee has signed.',
  },
  signed: {
    label: 'Signed',
    badgeClass: 'bg-green-100 text-green-800 border-green-200',
    hint: 'Signed agreement is on file. Manager can approve to Master.',
  },
};

export function AgreementStatusCard({
  employeeId,
  employeeEmail,
  onEmailUpdated,
  previewEmployee,
  includeDemoSignature = false,
}: {
  employeeId: string;
  employeeEmail?: string;
  /** Called when the user changes the recipient email in the confirm dialog. */
  onEmailUpdated?: (email: string) => void;
  /** When provided, enables the filled-document preview. */
  previewEmployee?: OnboardingEmployeeInput;
  /**
   * Master employee flag from parent. Demo name-signature is stamped only when
   * this is true AND there is no real PandaDoc completed/paid agreement.
   */
  includeDemoSignature?: boolean;
}) {
  const agencyName = useStore((s) => s.currentSubCompany?.name ?? '');
  const emailSendAsDomain = useStore((s) => s.currentSubCompany?.emailSendAsDomain ?? null);
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signedPreviewOpen, setSignedPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: onboarding, isLoading } = useQuery({
    queryKey: ['employee-onboarding', employeeId],
    queryFn: () => fetchEmployeeOnboardingStatus(employeeId),
  });

  useEffect(() => {
    return onEmployeeOnboardingRefresh((payload) => {
      if (payload.employeeId !== employeeId) return;
      void queryClient.invalidateQueries({ queryKey: ['employee-onboarding', employeeId] });
      if (payload.completed) {
        toast.success('Agreement signed');
      }
    });
  }, [employeeId, queryClient]);

  const status = deriveStatus(onboarding);
  const meta = STATUS_META[status];
  const updatedAt = formatWhen(onboarding?.updatedAt);
  const recipient = employeeEmail?.trim() || null;

  const preview = useMemo(
    () =>
      previewEmployee
        ? getOnboardingPreview(previewEmployee, { name: agencyName, emailSendAsDomain })
        : null,
    [previewEmployee, agencyName, emailSendAsDomain],
  );

  const applyStatus = (next: EmployeeOnboardingStatus) => {
    queryClient.setQueryData(['employee-onboarding', employeeId], next);
  };

  const handleSendClick = () => {
    if (!recipient) {
      toast.error('Add an email address before sending the agreement');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmSend = async (email: string) => {
    setSending(true);
    try {
      const previous = (employeeEmail ?? '').trim().toLowerCase();
      if (email.trim().toLowerCase() !== previous) {
        await updateEmployee(employeeId, { email: email.trim() });
        onEmailUpdated?.(email.trim());
        void queryClient.invalidateQueries({ queryKey: ['employees'] });
      }
      const next = await sendEmployeeOnboarding(employeeId);
      applyStatus(next);
      setConfirmOpen(false);
      const to = email.trim();
      if (next.trainingEmailed) {
        toast.success(status === 'not_sent' ? 'Agreement and training sent' : 'Agreement and training resent', {
          description: `Sent to ${to}`,
        });
      } else {
        toast.warning(status === 'not_sent' ? 'Agreement sent' : 'Agreement resent', {
          description:
            next.trainingError?.trim() ||
            `PandaDoc package sent to ${to}, but the training email was not sent.`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send agreement');
    } finally {
      setSending(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const next = await syncEmployeeOnboarding(employeeId);
      applyStatus(next);
      if (next.completed) {
        toast.success('Agreement signed');
      } else {
        toast.info('Still awaiting signature', {
          description: next.status ? `PandaDoc status: ${next.status}` : undefined,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync agreement status');
    } finally {
      setSyncing(false);
    }
  };

  const signedDoc = onboarding?.agreementDocument ?? null;
  const pandaDocSigned = isPandaDocSigned(onboarding);
  // Demo signature only for Master + no real PandaDoc signed agreement.
  const stampDemoSignature = includeDemoSignature && !pandaDocSigned;

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
    if (!preview) {
      toast.info('No preview available');
      return;
    }
    setPreviewOpen(true);
  };

  return (
    <>
      <ConfirmOnboardingSendDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!sending) setConfirmOpen(open);
        }}
        defaultEmail={recipient ?? ''}
        mode="onboarding"
        confirmLabel={status === 'not_sent' ? 'Confirm & send' : 'Confirm & resend'}
        confirming={sending}
        onConfirm={handleConfirmSend}
        agencyName={agencyName}
        emailSendAsDomain={emailSendAsDomain}
        previewEmployee={previewEmployee}
      />
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Onboarding Agreement
            </CardTitle>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant="outline" className={cn('text-[10px] font-medium', meta.badgeClass)}>
                {status === 'signed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {meta.label}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
          {recipient && (
            <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{recipient}</span>
            </p>
          )}
          {updatedAt && (
            <p className="text-[11px] text-muted-foreground">Updated {updatedAt}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={status === 'not_sent' ? 'default' : 'outline'}
              onClick={handleSendClick}
              disabled={sending || syncing || isLoading}
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              {status === 'not_sent' ? 'Send' : 'Resend'}
            </Button>
            {status !== 'not_sent' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleSync()}
                disabled={sending || syncing || isLoading}
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Sync status
              </Button>
            )}
            {(pandaDocSigned || !!preview) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleView}
                disabled={isLoading}
              >
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                View
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {preview && (
        <OnboardingFilledPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          prefill={preview.mode === 'local' ? preview.prefill : null}
          includeDemoSignature={stampDemoSignature}
        />
      )}
      <EmployeePdfPreviewDialog
        open={signedPreviewOpen}
        onOpenChange={setSignedPreviewOpen}
        employeeId={employeeId}
        docId={signedDoc?.id ?? null}
        fileName={signedDoc?.name}
      />
    </>
  );
}
