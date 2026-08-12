import { Award, Globe, Hash, IdCard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError, FieldLabel, SectionCard } from './SectionCard';
import { UploadField } from './UploadField';
import { cn } from '@/lib/utils';
import {
  PHOTO_ID_TYPES,
  WORK_STATUS_OPTIONS,
  NON_LICENSE_EXPIRY_TOO_SOON_MSG,
  emptyLicenseEntry,
  expiryStateOf,
  isExpiryTooSoon,
  type DocSlot,
  type EmployeeFormState,
  type ExistingDocRef,
  type FormErrors,
  type PhotoIdTypeKey,
  type SetField,
} from './formTypes';
import type { ResidencyStatus } from '@/lib/employeeTypes';
import {
  FORKLIFT_LICENSE_TYPES,
  isForkliftLicenseType,
  requiredLicensesForSkills,
  skillsRequireForkliftLicenses,
} from './skillLicenseMap';
import { licenseErrorKey } from './validation';

type SectionProps = {
  form: EmployeeFormState;
  errors: FormErrors;
  setField: SetField;
  /** Present in edit mode — enables View on uploaded documents. */
  employeeId?: string;
  /** Open document in the page preview modal (preferred over download). */
  onPreviewDoc?: (doc: ExistingDocRef) => void;
};

function viewDocHandler(
  doc: ExistingDocRef | null | undefined,
  onPreviewDoc?: (doc: ExistingDocRef) => void,
) {
  if (!doc?.id || !onPreviewDoc) return undefined;
  return () => onPreviewDoc(doc);
}

function ExpiryBadge({ date }: { date: string }) {
  const state = expiryStateOf(date);
  if (state === 'expired') {
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0">Expired</Badge>;
  }
  if (state === 'expiring') {
    return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">Expiring soon</Badge>;
  }
  return null;
}

function ExpiryInput({
  value,
  onChange,
  label = 'Expiry Date',
  error,
  dataField,
  required,
  /** When set, show live “must be more than 1 month” validation as soon as a date is entered. */
  enforceMinExpiry,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  dataField?: string;
  required?: boolean;
  enforceMinExpiry?: boolean;
}) {
  // Show as soon as a too-soon date is entered (not only on submit).
  const liveTooSoon = Boolean(enforceMinExpiry && value && isExpiryTooSoon(value));
  const displayError = error || (liveTooSoon ? NON_LICENSE_EXPIRY_TOO_SOON_MSG : undefined);

  return (
    <div className="space-y-1.5" data-field={dataField}>
      <div className="flex items-center gap-2">
        <FieldLabel required={required}>{label}</FieldLabel>
        <ExpiryBadge date={value} />
      </div>
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={displayError ? 'border-destructive' : undefined}
        aria-invalid={displayError ? true : undefined}
      />
      <FieldError message={displayError} />
    </div>
  );
}

function patchSlot(
  setField: SetField,
  key: 'photoId' | 'statusDoc' | 'sinDoc',
  slot: DocSlot,
  patch: Partial<DocSlot>,
) {
  setField(key, { ...slot, ...patch });
}

// ── 1. Photo ID ────────────────────────────────────────────────────────────

export function PhotoIdCard({ form, errors, setField, onPreviewDoc }: SectionProps) {
  return (
    <SectionCard
      icon={IdCard}
      title="Photo ID"
      description="Government-issued photo identification. Must be current and unexpired."
      required
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FieldLabel required>ID Type</FieldLabel>
          <Select
            value={form.photoIdType}
            onValueChange={(v) => setField('photoIdType', v as PhotoIdTypeKey)}
          >
            <SelectTrigger className={errors.photoIdType ? 'border-destructive' : undefined}>
              <SelectValue placeholder="Select ID type" />
            </SelectTrigger>
            <SelectContent>
              {PHOTO_ID_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.photoIdType} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>ID Number</FieldLabel>
          <Input
            value={form.photoIdNumber}
            onChange={(e) => setField('photoIdNumber', e.target.value)}
            placeholder="Enter ID number"
            maxLength={64}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FieldLabel>Upload Document</FieldLabel>
          <UploadField
            file={form.photoId.file}
            existingDoc={form.photoId.existingDoc}
            onFile={(file) => patchSlot(setField, 'photoId', form.photoId, { file })}
            onClear={() => patchSlot(setField, 'photoId', form.photoId, { file: null, existingDoc: null })}
            onView={viewDocHandler(form.photoId.existingDoc, onPreviewDoc)}
          />
        </div>
        <ExpiryInput
          value={form.photoId.expiryDate}
          onChange={(v) => patchSlot(setField, 'photoId', form.photoId, { expiryDate: v })}
          enforceMinExpiry
          error={errors['photoId.expiryDate']}
          dataField="photoId.expiryDate"
        />
      </div>
    </SectionCard>
  );
}

// ── 2. Status in Canada ────────────────────────────────────────────────────

export function WorkStatusCard({ form, errors, setField, onPreviewDoc }: SectionProps) {
  const isCitizen = form.residencyStatus === 'citizen';
  return (
    <SectionCard
      icon={Globe}
      title="Status in Canada"
      description="Citizenship or residency status with supporting document."
      required
    >
      <div className="space-y-1.5" data-field="residencyStatus">
        <FieldLabel required>Status Type</FieldLabel>
        <Select
          value={form.residencyStatus}
          onValueChange={(v) => setField('residencyStatus', v as ResidencyStatus)}
        >
          <SelectTrigger className={errors.residencyStatus ? 'border-destructive' : undefined}>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {WORK_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={errors.residencyStatus} />
      </div>
      <div className={cn('grid grid-cols-1 gap-4', !isCitizen && 'sm:grid-cols-2')}>
        <div className="space-y-1.5">
          <FieldLabel>Upload Status Document</FieldLabel>
          <UploadField
            file={form.statusDoc.file}
            existingDoc={form.statusDoc.existingDoc}
            onFile={(file) => patchSlot(setField, 'statusDoc', form.statusDoc, { file })}
            onClear={() => patchSlot(setField, 'statusDoc', form.statusDoc, { file: null, existingDoc: null })}
            onView={viewDocHandler(form.statusDoc.existingDoc, onPreviewDoc)}
          />
        </div>
        {!isCitizen && (
          <ExpiryInput
            value={form.statusDoc.expiryDate}
            onChange={(v) => patchSlot(setField, 'statusDoc', form.statusDoc, { expiryDate: v })}
            enforceMinExpiry
            error={errors['statusDoc.expiryDate']}
            dataField="statusDoc.expiryDate"
          />
        )}
      </div>
      {isCitizen && (
        <p className="text-[11px] text-muted-foreground">
          No expiry date required for Canadian citizens.
        </p>
      )}
    </SectionCard>
  );
}

// ── 3. SIN ─────────────────────────────────────────────────────────────────

function formatSin(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

export function SinCard({ form, errors, setField, onPreviewDoc }: SectionProps) {
  const isCitizen = form.residencyStatus === 'citizen';
  return (
    <SectionCard
      icon={Hash}
      title="Social Insurance Number (SIN)"
      description="Provide the SIN and upload the official document."
      required
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5" data-field="sinNumber">
          <FieldLabel>SIN Number</FieldLabel>
          <Input
            value={form.sinNumber}
            onChange={(e) => setField('sinNumber', formatSin(e.target.value))}
            placeholder="123 456 789"
            inputMode="numeric"
            maxLength={11}
            className={errors.sinNumber ? 'border-destructive' : undefined}
          />
          <FieldError message={errors.sinNumber} />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Upload Document</FieldLabel>
          <UploadField
            file={form.sinDoc.file}
            existingDoc={form.sinDoc.existingDoc}
            onFile={(file) => patchSlot(setField, 'sinDoc', form.sinDoc, { file })}
            onClear={() => patchSlot(setField, 'sinDoc', form.sinDoc, { file: null, existingDoc: null })}
            onView={viewDocHandler(form.sinDoc.existingDoc, onPreviewDoc)}
          />
        </div>
      </div>
      {!isCitizen ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ExpiryInput
            value={form.sinDoc.expiryDate}
            onChange={(v) => patchSlot(setField, 'sinDoc', form.sinDoc, { expiryDate: v })}
            enforceMinExpiry
            error={errors['sinDoc.expiryDate']}
            dataField="sinDoc.expiryDate"
          />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No expiry — permanent SIN for citizens.</p>
      )}
    </SectionCard>
  );
}

// ── 4. Licenses & certifications (skill-driven) ────────────────────────────

export function LicensesCard({ form, errors, setField, onPreviewDoc }: SectionProps) {
  const requiredTypes = requiredLicensesForSkills(form.skills);
  const needsForklift = skillsRequireForkliftLicenses(form.skills);
  const selectedForkliftTypes = form.licenses
    .map((l) => l.licenseType)
    .filter(isForkliftLicenseType);

  const update = (licenseType: string, patch: Partial<EmployeeFormState['licenses'][number]>) => {
    const existing = form.licenses.find((l) => l.licenseType === licenseType);
    if (existing) {
      setField(
        'licenses',
        form.licenses.map((l) => (l.licenseType === licenseType ? { ...l, ...patch } : l)),
      );
    } else {
      setField('licenses', [
        ...form.licenses,
        { ...emptyLicenseEntry(), licenseType, ...patch },
      ]);
    }
  };

  const toggleForkliftType = (type: string) => {
    if (selectedForkliftTypes.includes(type)) {
      setField(
        'licenses',
        form.licenses.filter((l) => l.licenseType !== type),
      );
    } else {
      setField('licenses', [...form.licenses, { ...emptyLicenseEntry(), licenseType: type }]);
    }
  };

  if (requiredTypes.length === 0 && !needsForklift) {
    return (
      <SectionCard
        icon={Award}
        title="Licenses & Certifications"
        description="License fields appear when you select skills that require certification (e.g. Forklift, Driving)."
      >
        <p className="text-sm text-muted-foreground">
          No licenses required for the selected skills.
        </p>
      </SectionCard>
    );
  }

  const fixedRows = requiredTypes.map((licenseType) => {
    const existing = form.licenses.find((l) => l.licenseType === licenseType);
    return (
      existing ?? {
        ...emptyLicenseEntry(),
        uid: licenseType,
        licenseType,
      }
    );
  });

  const forkliftRows = selectedForkliftTypes.map((licenseType) => {
    const existing = form.licenses.find((l) => l.licenseType === licenseType);
    return (
      existing ?? {
        ...emptyLicenseEntry(),
        uid: licenseType,
        licenseType,
      }
    );
  });

  let sectionIndex = 0;

  return (
    <SectionCard
      icon={Award}
      title="Licenses & Certifications"
      description="Required based on selected skills. For forklift, select each equipment type you are licensed on."
      required
    >
      {needsForklift && (
        <div
          className={sectionIndex++ > 0 ? 'space-y-3 border-t pt-4' : 'space-y-3'}
          data-field="licenses.forklift"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Forklift equipment licenses *
          </p>
          <p className="text-xs text-muted-foreground">
            Select every equipment type the employee is licensed to operate.
          </p>
          <div className="flex flex-wrap gap-2">
            {FORKLIFT_LICENSE_TYPES.map((type) => (
              <Badge
                key={type}
                variant={selectedForkliftTypes.includes(type) ? 'default' : 'outline'}
                className="cursor-pointer px-3 py-1.5"
                onClick={() => toggleForkliftType(type)}
              >
                {type}
              </Badge>
            ))}
          </div>
          <FieldError message={errors['licenses.forklift']} />
        </div>
      )}

      {[...forkliftRows, ...fixedRows].map((license) => {
        const expiryErr = errors[licenseErrorKey(license.licenseType, 'expiryDate')];
        const fileErr = errors[licenseErrorKey(license.licenseType, 'file')];
        const index = sectionIndex++;
        return (
          <div key={license.licenseType} className={index > 0 ? 'space-y-4 border-t pt-4' : 'space-y-4'}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {license.licenseType}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <FieldLabel required>License Type</FieldLabel>
                <Input value={license.licenseType} disabled readOnly className="bg-muted" />
              </div>
              <ExpiryInput
                value={license.expiryDate}
                onChange={(v) => update(license.licenseType, { expiryDate: v })}
                error={expiryErr}
                dataField={licenseErrorKey(license.licenseType, 'expiryDate')}
                required
              />
            </div>
            <div
              className="space-y-1.5"
              data-field={licenseErrorKey(license.licenseType, 'file')}
            >
              <FieldLabel required>Upload Document</FieldLabel>
              <UploadField
                file={license.file}
                existingDoc={license.existingDoc}
                onFile={(file) => update(license.licenseType, { file })}
                onClear={() => update(license.licenseType, { file: null, existingDoc: null })}
                onView={viewDocHandler(license.existingDoc, onPreviewDoc)}
                className={fileErr ? '[&_button]:border-destructive' : undefined}
              />
              <FieldError message={fileErr} />
            </div>
          </div>
        );
      })}
    </SectionCard>
  );
}
