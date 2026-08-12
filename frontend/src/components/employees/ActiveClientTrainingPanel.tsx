/**
 * Separate Client Training section (post-placement paperwork).
 * Not part of Ontario/WHMIS Master approval courses.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UploadField } from '@/components/employees/form/UploadField';
import {
  fetchEmployeeActiveClientTrainings,
  previewEmployeeActiveClientTrainingFile,
  resendActiveClientTraining,
  syncActiveClientTraining,
  uploadSignedActiveClientTraining,
  type ActiveClientTrainingAssignment,
} from '@/lib/activeClientTrainingApi';
import { fileToBase64 } from '@/lib/emailAttachmentUtils';
import { Eye, GraduationCap, Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
  employeeId: string;
  canWrite: boolean;
  open?: boolean;
  /** After resend/upload so parent can refresh list counts / readiness. */
  onChanged?: () => void;
};

export function ActiveClientTrainingPanel({
  employeeId,
  canWrite,
  open = true,
  onChanged,
}: Props) {
  const [rows, setRows] = useState<ActiveClientTrainingAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEmployeeActiveClientTrainings(employeeId);
      setRows(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load client trainings');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading client training…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center">
        No client training for this employee yet. It appears after they are linked to a client job
        that requires training.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const busy = busyId === row.id;
        const file = files[row.id] ?? null;
        const signed = row.status === 'signed';

        return (
          <div key={row.id} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium truncate">{row.activeClientName}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Template: {row.templateFileName}
                </p>
              </div>
              <Badge
                variant="secondary"
                className={
                  signed
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-amber-100 text-amber-900 hover:bg-amber-100'
                }
              >
                {signed ? 'Signed' : 'Pending'}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusyId(row.id);
                    try {
                      await previewEmployeeActiveClientTrainingFile(
                        employeeId,
                        row.id,
                        'template',
                        row.templateFileName,
                      );
                    } catch {
                      toast.error('Could not open training document');
                    } finally {
                      setBusyId(null);
                    }
                  })();
                }}
              >
                <Eye className="h-3.5 w-3.5" />
                View sent
              </Button>

              {canWrite && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusyId(row.id);
                      try {
                        const updated = await resendActiveClientTraining(employeeId, row.id);
                        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                        toast.success('Client training email resent');
                        onChanged?.();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Resend failed');
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Resend
                </Button>
              )}

              {canWrite && (row.isPandaDoc || row.pandaDocId) && !signed && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusyId(row.id);
                      try {
                        const updated = await syncActiveClientTraining(employeeId, row.id);
                        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                        toast.success(
                          updated.status === 'signed' ? 'Training marked signed' : 'Status synced',
                        );
                        onChanged?.();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Sync failed');
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync status
                </Button>
              )}

              {(signed || row.hasSignedDocument) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusyId(row.id);
                      try {
                        await previewEmployeeActiveClientTrainingFile(
                          employeeId,
                          row.id,
                          'signed',
                          row.signedFileName,
                        );
                      } catch {
                        toast.error('Could not open signed document');
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview signed
                </Button>
              )}
            </div>

            {canWrite && (
              <div className="space-y-2 pt-1 border-t">
                <p className="text-[11px] text-muted-foreground">
                  Upload the employee-signed training to mark this complete (allowed even if email
                  was never sent).
                </p>
                <UploadField
                  file={file}
                  onFile={(f) => setFiles((prev) => ({ ...prev, [row.id]: f }))}
                  onClear={() => setFiles((prev) => ({ ...prev, [row.id]: null }))}
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  disabled={busy}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  disabled={busy || !file}
                  onClick={() => {
                    void (async () => {
                      if (!file) return;
                      setBusyId(row.id);
                      try {
                        const fileBase64 = await fileToBase64(file);
                        const updated = await uploadSignedActiveClientTraining(
                          employeeId,
                          row.id,
                          {
                            name: file.name,
                            fileBase64,
                            mimeType: file.type || undefined,
                          },
                        );
                        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                        setFiles((prev) => ({ ...prev, [row.id]: null }));
                        toast.success('Signed training uploaded');
                        onChanged?.();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Upload failed');
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  {signed ? 'Replace signed document' : 'Upload signed document'}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ActiveClientTrainingSectionHeader() {
  return (
    <div className="flex items-center gap-2">
      <GraduationCap className="h-4 w-4 text-muted-foreground" />
      <div>
        <h3 className="text-sm font-semibold">Client training</h3>
        <p className="text-[11px] text-muted-foreground">
          Required by Active Clients after job link — not part of Master approval courses
        </p>
      </div>
    </div>
  );
}
