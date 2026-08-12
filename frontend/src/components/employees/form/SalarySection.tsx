/**
 * Salary & payment section for employee create/edit:
 * hourly rate, cheque vs deposit, bank details + void-cheque upload for deposit.
 */
import { Banknote } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { FieldError, FieldLabel, SectionCard } from './SectionCard';
import { UploadField } from './UploadField';
import type { SalaryPaymentMethod } from '@/lib/employeeTypes';
import type { EmployeeFormState, ExistingDocRef, FormErrors, SetField } from './formTypes';

type SectionProps = {
  form: EmployeeFormState;
  errors: FormErrors;
  setField: SetField;
  /** Present in edit mode — enables View on uploaded deposit attachment. */
  employeeId?: string;
  /** Open document in the page preview modal. */
  onPreviewDoc?: (doc: ExistingDocRef) => void;
};

const errCls = (msg?: string) => (msg ? 'border-destructive' : undefined);

export function SalaryCard({ form, errors, setField, onPreviewDoc }: SectionProps) {
  const isDeposit = form.salaryPaymentMethod === 'deposit';

  const setPaymentMethod = (value: SalaryPaymentMethod) => {
    setField('salaryPaymentMethod', value);
    if (value === 'cheque') {
      setField('bankName', '');
      setField('bankInstitutionNumber', '');
      setField('bankTransitNumber', '');
      setField('bankAccountNumber', '');
    }
  };

  return (
    <SectionCard
      icon={Banknote}
      title="Salary & Payment"
      description="Hourly rate and how the employee is paid."
      required
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5" data-field="hourlyRate">
          <FieldLabel>Hourly Rate (CAD)</FieldLabel>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="e.g. 18.50"
            value={form.hourlyRate}
            onChange={(e) => setField('hourlyRate', e.target.value)}
            className={errCls(errors.hourlyRate)}
          />
          <FieldError message={errors.hourlyRate} />
        </div>
      </div>

      <div className="space-y-2" data-field="salaryPaymentMethod">
        <FieldLabel required>Salary Deposit Method</FieldLabel>
        <RadioGroup
          value={form.salaryPaymentMethod || undefined}
          onValueChange={(v) => setPaymentMethod(v as SalaryPaymentMethod)}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <Label
            htmlFor="pay-cheque"
            className={`flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer ${
              form.salaryPaymentMethod === 'cheque' ? 'border-primary bg-primary/5' : ''
            } ${errors.salaryPaymentMethod ? 'border-destructive' : ''}`}
          >
            <RadioGroupItem value="cheque" id="pay-cheque" />
            <span className="text-sm font-medium">Cheque</span>
          </Label>
          <Label
            htmlFor="pay-deposit"
            className={`flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer ${
              form.salaryPaymentMethod === 'deposit' ? 'border-primary bg-primary/5' : ''
            } ${errors.salaryPaymentMethod ? 'border-destructive' : ''}`}
          >
            <RadioGroupItem value="deposit" id="pay-deposit" />
            <span className="text-sm font-medium">Direct Deposit</span>
          </Label>
        </RadioGroup>
        <FieldError message={errors.salaryPaymentMethod} />
      </div>

      {isDeposit && (
        <div className="space-y-4 rounded-md border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            Bank details and a void cheque / direct deposit form are required for deposit.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2" data-field="bankName">
              <FieldLabel required>Bank Name</FieldLabel>
              <Input
                value={form.bankName}
                onChange={(e) => setField('bankName', e.target.value)}
                placeholder="e.g. TD Canada Trust"
                className={errCls(errors.bankName)}
              />
              <FieldError message={errors.bankName} />
            </div>
            <div className="space-y-1.5" data-field="bankInstitutionNumber">
              <FieldLabel required>Institution Number</FieldLabel>
              <Input
                value={form.bankInstitutionNumber}
                onChange={(e) =>
                  setField('bankInstitutionNumber', e.target.value.replace(/\D/g, '').slice(0, 3))
                }
                placeholder="3 digits"
                inputMode="numeric"
                className={errCls(errors.bankInstitutionNumber)}
              />
              <FieldError message={errors.bankInstitutionNumber} />
            </div>
            <div className="space-y-1.5" data-field="bankTransitNumber">
              <FieldLabel required>Transit Number</FieldLabel>
              <Input
                value={form.bankTransitNumber}
                onChange={(e) =>
                  setField('bankTransitNumber', e.target.value.replace(/\D/g, '').slice(0, 5))
                }
                placeholder="5 digits"
                inputMode="numeric"
                className={errCls(errors.bankTransitNumber)}
              />
              <FieldError message={errors.bankTransitNumber} />
            </div>
            <div className="space-y-1.5 sm:col-span-2" data-field="bankAccountNumber">
              <FieldLabel required>Account Number</FieldLabel>
              <Input
                value={form.bankAccountNumber}
                onChange={(e) =>
                  setField('bankAccountNumber', e.target.value.replace(/\D/g, '').slice(0, 12))
                }
                placeholder="Account number"
                inputMode="numeric"
                className={errCls(errors.bankAccountNumber)}
              />
              <FieldError message={errors.bankAccountNumber} />
            </div>
          </div>

          <div className="space-y-1.5" data-field="depositDoc">
            <FieldLabel required>Deposit Attachment</FieldLabel>
            <p className="text-xs text-muted-foreground mb-1.5">
              Upload a void cheque or bank direct-deposit form.
            </p>
            <UploadField
              file={form.depositDoc.file}
              existingDoc={form.depositDoc.existingDoc}
              onFile={(file) =>
                setField('depositDoc', { ...form.depositDoc, file, existingDoc: null })
              }
              onClear={() =>
                setField('depositDoc', { file: null, existingDoc: null, expiryDate: '' })
              }
              onView={
                form.depositDoc.existingDoc?.id && onPreviewDoc
                  ? () => onPreviewDoc(form.depositDoc.existingDoc!)
                  : undefined
              }
              className={errors.depositDoc ? '[&_button]:border-destructive' : undefined}
            />
            <FieldError message={errors.depositDoc} />
          </div>
        </div>
      )}
    </SectionCard>
  );
}
