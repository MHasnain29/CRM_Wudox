/**
 * Compact Client Training upload on Employee details sheet.
 * Separate from Ontario/WHMIS Training dialog.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  fetchEmployeeActiveClientTrainings,
  previewEmployeeActiveClientTrainingFile,
  syncActiveClientTraining,
  uploadSignedActiveClientTraining,
  type ActiveClientTrainingAssignment,
} from '@/lib/activeClientTrainingApi';
import { fileToBase64 } from '@/lib/emailAttachmentUtils';
import { cn } from '@/lib/utils';
import { Eye, Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
  employeeId: string;
  canWrite: boolean;
  open: boolean;
  /** Called after a signed form upload so list counts/tabs can refresh. */
  onChanged?: () => void;
};

export function EmployeeClientTrainingCard({ employeeId, canWrite, open, onChanged }: Props) {
  const [rows, setRows] = useState<ActiveClientTrainingAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchEmployeeActiveClientTrainings(employeeId));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  if (!loading && rows.length === 0) return null;

  const uploadFile = async (row: ActiveClientTrainingAssignment, file: File) => {
    setBusyId(row.id);
    try {
      const fileBase64 = await fileToBase64(file);
      const updated = await uploadSignedActiveClientTraining(employeeId, row.id, {
        name: file.name,
        fileBase64,
        mimeType: file.type || undefined,
      });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success('Signed training saved for this employee');
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the signed training');
    } finally {
      setBusyId(null);
      const input = inputRefs.current[row.id];
      if (input) input.value = '';
    }
  };

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">
          Training required by the client
        </p>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Client training is sent for e-signature when the employee is linked to this client&apos;s
        job. Status updates automatically when they sign.
      </p>

      {rows.map((row) => {
        const busy = busyId === row.id;
        const signed = row.status === 'signed';
        const isPanda = Boolean(row.isPandaDoc || row.pandaDocId);

        return (
          <div key={row.id} className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <p className="text-xs font-medium truncate max-w-[140px] sm:max-w-[180px]">
              {row.activeClientName}
            </p>
            <Badge
              variant="outline"
              className={cn(
                'shrink-0 text-[10px] h-5 px-1.5 font-normal',
                signed
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200',
              )}
            >
              {signed ? 'Signed' : isPanda && row.sentAt ? 'Awaiting signature' : 'Pending'}
            </Badge>

            <div className="flex flex-wrap items-center gap-1 ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                title="Open the training document that was sent"
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
                      toast.error('Could not open the client training form');
                    } finally {
                      setBusyId(null);
                    }
                  })();
                }}
              >
                <Eye className="h-3 w-3" />
                View sent
              </Button>

              {(signed || row.hasSignedDocument) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-emerald-700"
                  title="Open the signed training document"
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
                        toast.error('Could not open the signed training file');
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  <Eye className="h-3 w-3" />
                  View signed
                </Button>
              )}

              {canWrite && isPanda && !signed && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  title="Sync signature status from PandaDoc"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusyId(row.id);
                      try {
                        const updated = await syncActiveClientTraining(employeeId, row.id);
                        setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                        toast.success(
                          updated.status === 'signed'
                            ? 'Training marked signed'
                            : 'Status synced',
                        );
                        if (updated.status === 'signed') onChanged?.();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Sync failed');
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Sync
                </Button>
              )}

              {canWrite && !isPanda && (
                <>
                  <input
                    ref={(el) => {
                      inputRefs.current[row.id] = el;
                    }}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFile(row, file);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    disabled={busy}
                    onClick={() => inputRefs.current[row.id]?.click()}
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    {signed ? 'Replace signed form' : 'Upload signed form'}
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
