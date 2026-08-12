/**
 * License requirement panel for job assignment requests.
 *
 * When the selected job requires licenses, shows Valid / Expired / Missing
 * status per required type (from the employee's documents, named
 * `license — <type> — <fileName>`) and lets the recruiter upload a missing or
 * expired license inline. Reports overall validity to the parent so the
 * request button can stay disabled until every required license is valid.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BadgeCheck, Loader2, ShieldAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchEmployee, updateEmployee, uploadEmployeeDocument } from '@/lib/api';
import { fetchJob } from '@/lib/jobsApi';
import { fileToBase64 } from '@/lib/emailAttachmentUtils';
import type { EmployeeDocument } from '@/lib/employeeTypes';
import {
  emptyUiExtras,
  loadEmployeeUiExtras,
  mergeEmployeeUiExtras,
  saveEmployeeUiExtras,
} from '@/components/employees/form/localExtras';

const LICENSE_NAME_PREFIX = 'license — ';

type LicenseState = {
  type: string;
  status: 'valid' | 'expired' | 'missing';
  expiryDate: string | null;
};

function licenseStateFor(type: string, docs: EmployeeDocument[]): LicenseState {
  const prefix = `${LICENSE_NAME_PREFIX}${type}`.toLowerCase();
  const matches = docs.filter((d) => {
    const name = d.name.toLowerCase();
    return name === prefix || name.startsWith(`${prefix} — `);
  });
  if (matches.length === 0) return { type, status: 'missing', expiryDate: null };
  const best = matches.reduce((a, b) =>
    (b.expiryDate ?? '') > (a.expiryDate ?? '') ? b : a,
  );
  const valid = best.expiryDate != null && new Date(best.expiryDate) > new Date();
  return { type, status: valid ? 'valid' : 'expired', expiryDate: best.expiryDate ?? null };
}

type UploadDraft = { file: File | null; expiryDate: string };

type Props = {
  employeeId: string;
  jobId: string;
  disabled?: boolean;
  /** Called whenever validity changes; true when no license is required. */
  onValidityChange?: (allValid: boolean) => void;
};

export function JobLicenseRequirementPanel({
  employeeId,
  jobId,
  disabled,
  onValidityChange,
}: Props) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, UploadDraft>>({});
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const { data: job } = useQuery({
    queryKey: ['jobs', jobId, 'license-requirement'],
    queryFn: () => fetchJob(jobId),
    enabled: Boolean(jobId),
  });

  const requiredTypes = job?.licenseRequired ? job.requiredLicenseTypes : [];

  const { data: employee } = useQuery({
    queryKey: ['employees', employeeId, 'license-docs'],
    queryFn: () => fetchEmployee(employeeId),
    enabled: Boolean(employeeId) && requiredTypes.length > 0,
  });

  const states = useMemo(
    () => requiredTypes.map((t) => licenseStateFor(t, employee?.documents ?? [])),
    [requiredTypes, employee],
  );

  const allValid =
    requiredTypes.length === 0 ||
    (employee != null && states.every((s) => s.status === 'valid'));

  useEffect(() => {
    onValidityChange?.(allValid);
  }, [allValid, onValidityChange]);

  if (!job?.licenseRequired || requiredTypes.length === 0) return null;

  const setDraft = (type: string, patch: Partial<UploadDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [type]: { file: null, expiryDate: '', ...prev[type], ...patch },
    }));
  };

  const handleUpload = async (type: string) => {
    const draft = drafts[type];
    if (!draft?.file) {
      toast.error('Choose a license file to upload');
      return;
    }
    if (!draft.expiryDate) {
      toast.error('Set the license expiry date');
      return;
    }
    if (new Date(draft.expiryDate) <= new Date()) {
      toast.error('License expiry date must be in the future');
      return;
    }
    setUploadingType(type);
    try {
      const fileBase64 = await fileToBase64(draft.file);
      const doc = await uploadEmployeeDocument(employeeId, {
        name: `${LICENSE_NAME_PREFIX}${type} — ${draft.file.name}`,
        fileBase64,
        mimeType: draft.file.type || undefined,
        type: 'other',
        expiryDate: draft.expiryDate,
      });

      // Keep Licenses card in sync on server + local cache.
      const emp = await fetchEmployee(employeeId);
      const extras = mergeEmployeeUiExtras(emp.uiExtras, loadEmployeeUiExtras(employeeId));
      extras.licensesNotApplicable = false;
      const entry = { licenseType: type, expiryDate: draft.expiryDate, docId: doc.id };
      const idx = extras.licenses.findIndex((l) => l.licenseType === type);
      if (idx >= 0) extras.licenses[idx] = entry;
      else extras.licenses.push(entry);
      const nextExtras = { ...emptyUiExtras(), ...extras };
      await updateEmployee(employeeId, { uiExtras: nextExtras });
      saveEmployeeUiExtras(employeeId, nextExtras);

      setDrafts((prev) => ({ ...prev, [type]: { file: null, expiryDate: '' } }));
      toast.success(`${type} uploaded`);
      await queryClient.invalidateQueries({ queryKey: ['employees', employeeId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload license');
    } finally {
      setUploadingType(null);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldAlert className="h-4 w-4 text-amber-600" />
        This job requires a valid license
      </div>
      <div className="space-y-3">
        {states.map((s) => {
          const draft = drafts[s.type] ?? { file: null, expiryDate: '' };
          const uploading = uploadingType === s.type;
          return (
            <div key={s.type} className="space-y-2 rounded border bg-background p-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">{s.type}</span>
                {s.status === 'valid' ? (
                  <Badge className="bg-green-600 hover:bg-green-600 gap-1">
                    <BadgeCheck className="h-3 w-3" />
                    Valid
                    {s.expiryDate
                      ? ` · exp ${format(new Date(s.expiryDate), 'MMM d, yyyy')}`
                      : ''}
                  </Badge>
                ) : s.status === 'expired' ? (
                  <Badge variant="destructive">
                    Expired
                    {s.expiryDate
                      ? ` · ${format(new Date(s.expiryDate), 'MMM d, yyyy')}`
                      : ''}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-400 text-amber-700">
                    Missing
                  </Badge>
                )}
              </div>
              {s.status !== 'valid' && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">License file</Label>
                    <Input
                      type="file"
                      className="text-xs"
                      disabled={disabled || uploading}
                      onChange={(e) =>
                        setDraft(s.type, { file: e.target.files?.[0] ?? null })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expiry date</Label>
                    <Input
                      type="date"
                      className="text-xs"
                      value={draft.expiryDate}
                      disabled={disabled || uploading}
                      onChange={(e) => setDraft(s.type, { expiryDate: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || uploading || !draft.file || !draft.expiryDate}
                    onClick={() => void handleUpload(s.type)}
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5 mr-1" />
                    )}
                    Upload
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!allValid && (
        <p className="text-xs text-amber-700">
          Upload a valid license for every required type before requesting approval.
        </p>
      )}
    </div>
  );
}
