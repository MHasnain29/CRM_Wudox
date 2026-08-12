import { Building2, CalendarClock } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError, FieldLabel, SectionCard } from './SectionCard';
import {
  ENGLISH_OPTIONS,
  SHIFT_OPTIONS,
  type AvailabilityType,
} from '@/lib/employeeTypes';
import type { EmployeeFormState, FormErrors, SetField } from './formTypes';

type SectionProps = {
  form: EmployeeFormState;
  errors: FormErrors;
  setField: SetField;
};

const errCls = (msg?: string) => (msg ? 'border-destructive' : undefined);

const AVAILABILITY_OPTIONS: { value: AvailabilityType; label: string }[] = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
];

// ── Availability & preferred shift ─────────────────────────────────────────

export function AvailabilityCard({ form, errors, setField }: SectionProps) {
  const toggle = (key: 'shiftsAvailable' | 'englishProficiency', value: string) => {
    const current = form[key];
    let next: string[];
    if (key === 'englishProficiency') {
      if (value === 'All') {
        next = current.includes('All') ? [] : ['All'];
      } else if (current.includes(value)) {
        next = current.filter((v) => v !== value);
      } else {
        next = [...current.filter((v) => v !== 'All'), value];
      }
    } else {
      next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    }
    setField(key, next);
  };

  const toggleAvailability = (value: AvailabilityType) => {
    const current = form.availabilityTypes;
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setField('availabilityTypes', next);
  };

  return (
    <SectionCard icon={CalendarClock} title="Availability & Preferred Shift" required>
      <div className="space-y-1.5" data-field="employeeType">
        <FieldLabel required>Employee Type</FieldLabel>
        <Input value="External" disabled readOnly className="bg-muted" />
        <p className="text-xs text-muted-foreground">Only external employees are supported.</p>
      </div>

      <div className="space-y-1.5" data-field="availabilityTypes">
        <FieldLabel required>Availability</FieldLabel>
        <div className={`flex flex-wrap gap-4 rounded-md p-1 ${errors.availabilityTypes ? 'ring-1 ring-destructive' : ''}`}>
          {AVAILABILITY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.availabilityTypes.includes(opt.value)}
                onCheckedChange={() => toggleAvailability(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <FieldError message={errors.availabilityTypes} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5" data-field="availableFrom">
          <FieldLabel required>Available From</FieldLabel>
          <Input
            type="date"
            value={form.availableFrom}
            onChange={(e) => setField('availableFrom', e.target.value)}
            className={errCls(errors.availableFrom)}
          />
          <FieldError message={errors.availableFrom} />
        </div>
        <div className="space-y-1.5" data-field="ableTwelveHourShift">
          <FieldLabel required>Able to Work 12-Hour Shifts?</FieldLabel>
          <Select
            value={form.ableTwelveHourShift}
            onValueChange={(v) => setField('ableTwelveHourShift', v as 'yes' | 'no')}
          >
            <SelectTrigger className={errCls(errors.ableTwelveHourShift)}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
          <FieldError message={errors.ableTwelveHourShift} />
        </div>
      </div>

      <div className="space-y-1.5" data-field="shiftsAvailable">
        <FieldLabel required>Preferred Shifts</FieldLabel>
        <div className={`flex flex-wrap gap-4 rounded-md p-1 ${errors.shiftsAvailable ? 'ring-1 ring-destructive' : ''}`}>
          {SHIFT_OPTIONS.map((shift) => (
            <label key={shift} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.shiftsAvailable.includes(shift)}
                onCheckedChange={() => toggle('shiftsAvailable', shift)}
              />
              {shift}
            </label>
          ))}
        </div>
        <FieldError message={errors.shiftsAvailable} />
      </div>

      <div className="space-y-1.5" data-field="englishProficiency">
        <FieldLabel required>English Proficiency</FieldLabel>
        <div className={`flex flex-wrap gap-4 rounded-md p-1 ${errors.englishProficiency ? 'ring-1 ring-destructive' : ''}`}>
          {ENGLISH_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.englishProficiency.includes(opt)}
                onCheckedChange={() => toggle('englishProficiency', opt)}
              />
              {opt}
            </label>
          ))}
        </div>
        <FieldError message={errors.englishProficiency} />
      </div>
    </SectionCard>
  );
}

// ── Client assignment ──────────────────────────────────────────────────────

export type ClientOption = { id: string; name: string };

export function ClientAssignmentCard({
  form,
  setField,
  clients,
  loadingClients,
}: {
  form: EmployeeFormState;
  setField: SetField;
  clients: ClientOption[];
  loadingClients: boolean;
}) {
  const NONE = '__none__';
  return (
    <SectionCard
      id="client-assignment"
      icon={Building2}
      title="Client Assignment"
      description="Placement requires assignment details sent to the candidate via Link to Client on the Master list."
    >
      <div className="space-y-1.5">
        <FieldLabel>Assigned Client</FieldLabel>
        <Select
          value={form.assignedClientId || NONE}
          onValueChange={(v) => {
            if (v === NONE) {
              setField('assignedClientId', '');
              setField('assignedClientName', '');
            } else {
              setField('assignedClientId', v);
              setField('assignedClientName', clients.find((c) => c.id === v)?.name ?? '');
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={loadingClients ? 'Loading clients…' : 'Select a client'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not assigned</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SectionCard>
  );
}
