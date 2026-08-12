/**
 * Assignment details fields for client placement requests.
 */
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export type AssignmentDetailsForm = {
  workLocation: string;
  positionTitle: string;
  payRate: string;
  shiftSchedule: string;
  expectedDuration: string;
  supervisorInfo: string;
  requiredPpe: string;
  workplaceHazards: string;
};

export const EMPTY_ASSIGNMENT_DETAILS: AssignmentDetailsForm = {
  workLocation: '',
  positionTitle: '',
  payRate: '',
  shiftSchedule: '',
  expectedDuration: '',
  supervisorInfo: '',
  requiredPpe: '',
  workplaceHazards: '',
};

type Props = {
  value: AssignmentDetailsForm;
  onChange: (next: AssignmentDetailsForm) => void;
  disabled?: boolean;
};

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <Label className="text-xs">
      {children}
      {required ? <span className="text-destructive"> *</span> : null}
    </Label>
  );
}

export function AssignmentDetailsFields({ value, onChange, disabled }: Props) {
  const set = <K extends keyof AssignmentDetailsForm>(key: K, v: AssignmentDetailsForm[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Assignment details</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel required>Work location</FieldLabel>
          <Input
            value={value.workLocation}
            onChange={(e) => set('workLocation', e.target.value)}
            placeholder="Site address or location name"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel required>Position title</FieldLabel>
          <Input
            value={value.positionTitle}
            onChange={(e) => set('positionTitle', e.target.value)}
            placeholder="e.g. General Labourer"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel required>Pay rate</FieldLabel>
          <Input
            value={value.payRate}
            onChange={(e) => set('payRate', e.target.value)}
            placeholder="e.g. $18.50/hr"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel required>Shift schedule</FieldLabel>
          <Input
            value={value.shiftSchedule}
            onChange={(e) => set('shiftSchedule', e.target.value)}
            placeholder="e.g. Mon–Fri 7am–3pm"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel>Expected assignment duration</FieldLabel>
          <Input
            value={value.expectedDuration}
            onChange={(e) => set('expectedDuration', e.target.value)}
            placeholder="If known"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel required>Supervisor information</FieldLabel>
          <Textarea
            value={value.supervisorInfo}
            onChange={(e) => set('supervisorInfo', e.target.value)}
            placeholder="Name, phone, email"
            rows={2}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel required>Required PPE</FieldLabel>
          <Textarea
            value={value.requiredPpe}
            onChange={(e) => set('requiredPpe', e.target.value)}
            placeholder="e.g. Hard hat, steel-toe boots, safety glasses"
            rows={2}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <FieldLabel>Special workplace hazards</FieldLabel>
          <Textarea
            value={value.workplaceHazards}
            onChange={(e) => set('workplaceHazards', e.target.value)}
            placeholder="If applicable"
            rows={2}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

const DETAIL_ROWS: Array<{ key: keyof AssignmentDetailsForm; label: string }> = [
  { key: 'workLocation', label: 'Work location' },
  { key: 'positionTitle', label: 'Position' },
  { key: 'payRate', label: 'Pay rate' },
  { key: 'shiftSchedule', label: 'Shift' },
  { key: 'expectedDuration', label: 'Expected duration' },
  { key: 'supervisorInfo', label: 'Supervisor' },
  { key: 'requiredPpe', label: 'PPE' },
  { key: 'workplaceHazards', label: 'Hazards' },
];

/** Compact read-only summary for assignment history cards. */
export function AssignmentDetailsSummary({
  assignment,
}: {
  assignment: Partial<AssignmentDetailsForm> & { clientName?: string | null };
}) {
  const rows = DETAIL_ROWS.filter((r) => {
    const v = assignment[r.key];
    return typeof v === 'string' && v.trim().length > 0;
  });
  if (!assignment.clientName && rows.length === 0) return null;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {assignment.clientName ? (
        <>
          <dt className="font-medium text-foreground/80">Client</dt>
          <dd>{assignment.clientName}</dd>
        </>
      ) : null}
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <dt className="font-medium text-foreground/80">{r.label}</dt>
          <dd className="whitespace-pre-wrap break-words">{assignment[r.key]}</dd>
        </div>
      ))}
    </dl>
  );
}
