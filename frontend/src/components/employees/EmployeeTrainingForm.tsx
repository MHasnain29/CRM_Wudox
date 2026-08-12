/**
 * Per-course training card: open link, resend email, upload/view/replace certificate.
 * Email only — SMS removed.
 */
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  FileUp,
  GraduationCap,
  Loader2,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UploadField } from '@/components/employees/form/UploadField';
import { openOrDownloadEmployeeDocument } from '@/components/employees/openEmployeeDocument';
import { fileToBase64 } from '@/lib/emailAttachmentUtils';
import {
  resendEmployeeTraining,
  updateEmployee,
  uploadEmployeeTrainingCertificate,
} from '@/lib/api';
import type { EmployeeTraining } from '@/lib/employeeTypes';
import { ConfirmOnboardingSendDialog } from './ConfirmOnboardingSendDialog';

type Props = {
  employeeId: string;
  training: EmployeeTraining;
  canWrite: boolean;
  employeeEmail?: string | null;
  onEmailUpdated?: (email: string) => void;
  onUpdated: (training: EmployeeTraining) => void;
};

export function EmployeeTrainingForm({
  employeeId,
  training,
  canWrite,
  employeeEmail,
  onEmailUpdated,
  onUpdated,
}: Props) {
  const sent = Boolean(training.sentAt);
  const complete = Boolean(training.completedAt);
  const title = training.title?.trim() || 'Training';
  const [currentEmail, setCurrentEmail] = useState(employeeEmail?.trim() ?? '');

  useEffect(() => {
    setCurrentEmail(employeeEmail?.trim() ?? '');
  }, [employeeEmail]);

  const emailAvailable = Boolean(currentEmail.trim());

  const [file, setFile] = useState<File | null>(null);
  const [resending, setResending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const handleResendClick = () => {
    if (!canWrite || complete || resending) return;
    if (!emailAvailable) {
      toast.error('Employee email is required to resend training');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmResend = async (email: string) => {
    setResending(true);
    try {
      const previous = currentEmail.trim().toLowerCase();
      if (email.trim().toLowerCase() !== previous) {
        await updateEmployee(employeeId, { email: email.trim() });
        setCurrentEmail(email.trim());
        onEmailUpdated?.(email.trim());
      }
      const updated = await resendEmployeeTraining(employeeId, training.id);
      onUpdated(updated);
      setConfirmOpen(false);
      toast.success('Training email resent', {
        description: `Sent to ${email.trim()}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend training email');
    } finally {
      setResending(false);
    }
  };

  const handleUpload = async (isReplace: boolean) => {
    if (!canWrite || !sent || !file || uploading) return;
    if (!isReplace && complete) return;
    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const updated = await uploadEmployeeTrainingCertificate(employeeId, training.id, {
        name: file.name,
        fileBase64,
        mimeType: file.type || undefined,
      });
      setFile(null);
      setReplacing(false);
      onUpdated(updated);
      toast.success(
        isReplace ? 'Certificate replaced' : 'Certificate saved — training complete',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload certificate');
    } finally {
      setUploading(false);
    }
  };

  const handleViewCertificate = async () => {
    if (!training.certificateDocumentId || viewing) return;
    setViewing(true);
    try {
      await openOrDownloadEmployeeDocument(
        employeeId,
        training.certificateDocumentId,
        'training-certificate',
      );
    } catch {
      toast.error('Failed to open certificate');
    } finally {
      setViewing(false);
    }
  };

  const busy = resending || uploading || viewing;
  const statusLabel = complete ? 'Complete' : sent ? 'Open' : 'Not started';

  return (
    <>
      <ConfirmOnboardingSendDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!resending) setConfirmOpen(open);
        }}
        defaultEmail={currentEmail}
        mode="training"
        trainingTitle={title}
        trainingUrl={training.url ?? undefined}
        confirmLabel="Confirm & resend"
        confirming={resending}
        onConfirm={handleConfirmResend}
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b bg-muted/40 px-3 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <GraduationCap className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{title}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {complete
                ? 'Certificate on file'
                : 'Open the link, then upload the certificate'}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
              complete
                ? 'bg-emerald-100 text-emerald-800'
                : sent
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-slate-100 text-slate-700',
            )}
          >
            {statusLabel}
          </span>
        </div>

        <div className="space-y-3 p-3">
          {training.url && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <a
                href={training.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-1.5 font-medium text-foreground underline break-all"
              >
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {training.url}
              </a>
              {training.sentAt && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  Sent by email
                  {training.sentByName ? ` · ${training.sentByName}` : ''}
                  {` · ${new Date(training.sentAt).toLocaleString()}`}
                </p>
              )}
            </div>
          )}

          {!complete && canWrite && (
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full"
              disabled={busy || !emailAvailable || !training.url}
              onClick={handleResendClick}
            >
              {resending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {resending ? 'Resending…' : 'Resend email'}
            </Button>
          )}

          {complete ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-emerald-200/80 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Certificate on file</p>
                  {training.completedAt && (
                    <p className="text-[11px] text-emerald-800/80">
                      {new Date(training.completedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {training.certificateDocumentId && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full"
                  disabled={busy}
                  onClick={() => void handleViewCertificate()}
                >
                  {viewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  {viewing ? 'Opening…' : 'View certificate'}
                </Button>
              )}

              {canWrite && (
                replacing ? (
                  <div className="space-y-2">
                    <UploadField
                      file={file}
                      onFile={setFile}
                      onClear={() => setFile(null)}
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      disabled={busy}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        disabled={busy}
                        onClick={() => {
                          setReplacing(false);
                          setFile(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="h-9"
                        disabled={!file || busy}
                        onClick={() => void handleUpload(true)}
                      >
                        {uploading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="mr-2 h-4 w-4" />
                        )}
                        {uploading ? 'Saving…' : 'Replace'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 w-full"
                    disabled={busy}
                    onClick={() => setReplacing(true)}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    Replace certificate
                  </Button>
                )
              )}
            </div>
          ) : canWrite ? (
            <div className="space-y-2">
              <UploadField
                file={file}
                onFile={setFile}
                onClear={() => setFile(null)}
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                disabled={busy}
              />
              <Button
                type="button"
                className="h-9 w-full"
                disabled={!file || busy}
                onClick={() => void handleUpload(false)}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="mr-2 h-4 w-4" />
                )}
                {uploading ? 'Saving…' : 'Upload certificate'}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Waiting for certificate upload.</p>
          )}
        </div>
      </div>
    </>
  );
}
