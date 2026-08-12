/**
 * Confirm recipient email (+ show training link(s)) before sending agreement/training emails.
 * Onboarding mode can open a filled-agreement preview modal.
 */
import { useEffect, useMemo, useState } from 'react';
import { Eye, ExternalLink, FileText, Loader2, Mail } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { DEFAULT_EMPLOYEE_TRAININGS } from './defaultEmployeeTrainings';
import type { OnboardingEmployeeInput } from './onboarding/buildOnboardingPrefill';
import { getOnboardingPreview } from './onboarding/getOnboardingPreview';
import {
  ONBOARDING_PACKAGE_META,
  ONBOARDING_PACKAGE_NAME,
  OnboardingFilledPreviewDialog,
} from './onboarding/OnboardingFilledPreviewDialog';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'onboarding' | 'training';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmail: string;
  mode: Mode;
  /** Single-course resend: show this link instead of the default pair. */
  trainingTitle?: string;
  trainingUrl?: string;
  confirmLabel?: string;
  confirming?: boolean;
  onConfirm: (email: string) => void | Promise<void>;
  /** When set (onboarding mode), enables View Agreement preview. */
  previewEmployee?: OnboardingEmployeeInput;
  agencyName?: string;
  emailSendAsDomain?: string | null;
};

export function ConfirmOnboardingSendDialog({
  open,
  onOpenChange,
  defaultEmail,
  mode,
  trainingTitle,
  trainingUrl,
  confirmLabel = 'Confirm & send',
  confirming = false,
  onConfirm,
  previewEmployee,
  agencyName = '',
  emailSendAsDomain = null,
}: Props) {
  const [email, setEmail] = useState(defaultEmail);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail.trim());
      setError(null);
      setPreviewOpen(false);
    }
  }, [open, defaultEmail]);

  const links =
    mode === 'training' && trainingUrl?.trim()
      ? [{ title: trainingTitle?.trim() || 'Training link', url: trainingUrl.trim() }]
      : DEFAULT_EMPLOYEE_TRAININGS.map((t) => ({ title: t.title, url: t.url }));

  const agreementPreview = useMemo(() => {
    if (mode !== 'onboarding' || !previewEmployee) return null;
    return getOnboardingPreview(
      { ...previewEmployee, email: email.trim() || previewEmployee.email },
      { name: agencyName, emailSendAsDomain },
    );
  }, [mode, previewEmployee, agencyName, emailSendAsDomain, email]);

  const handleConfirm = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Email is required');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setError('Enter a valid email address');
      return;
    }
    setError(null);
    await onConfirm(trimmed);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              {mode === 'onboarding' ? 'Confirm agreement & training send' : 'Confirm training resend'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'onboarding'
                ? 'Confirm the recipient email, review the agreement, and check the training links that will be included.'
                : 'Confirm the recipient email before resending this training link.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="confirm-send-email">Email</Label>
              <Input
                id="confirm-send-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                disabled={confirming}
                placeholder="employee@example.com"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            {mode === 'onboarding' && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Onboarding agreement</p>
                <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{ONBOARDING_PACKAGE_NAME}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">{ONBOARDING_PACKAGE_META}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Will be emailed from your agency for e-signature (PandaDoc).
                    </p>
                  </div>
                  {agreementPreview && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setPreviewOpen(true)}
                      disabled={confirming}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      View
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">
                {mode === 'onboarding' ? 'Training links' : 'Training link'}
              </p>
              <ul className="space-y-2 rounded-md border bg-muted/40 px-3 py-2.5">
                {links.map((link) => (
                  <li key={link.url} className="text-xs space-y-0.5">
                    <p className="font-medium text-foreground">{link.title}</p>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 text-muted-foreground underline break-all"
                    >
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                      {link.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleConfirm()} disabled={confirming}>
              {confirming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {agreementPreview && (
        <OnboardingFilledPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          prefill={agreementPreview.mode === 'local' ? agreementPreview.prefill : null}
        />
      )}
    </>
  );
}
