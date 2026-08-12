/**
 * Client training checkbox + PandaDoc template select — Add/Edit Active Client.
 */
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GraduationCap, FileText } from 'lucide-react';

/** Keep in sync with backend activeClientTrainingTemplates.ts */
export const ACTIVE_CLIENT_TRAINING_TEMPLATES = [
  {
    id: 'Ev3upM2rNemT3zgcWkieR2',
    name: 'AWFI - 2025 Smoke-Free Workplace Policy',
  },
  {
    id: '7L84RuEDRffWMMdjqSyohh',
    name: 'GMP training',
  },
] as const;

export type ActiveClientTrainingFormState = {
  clientTraining: boolean;
  /** Selected PandaDoc template id */
  trainingPandaDocTemplateId: string | null;
  /** Legacy PDF filename still on file (edit only) */
  existingFileName: string | null;
};

type Props = {
  value: ActiveClientTrainingFormState;
  onChange: (next: ActiveClientTrainingFormState) => void;
  disabled?: boolean;
};

export function ActiveClientTrainingFields({ value, onChange, disabled }: Props) {
  return (
    <section className="space-y-4 rounded-xl border bg-muted/20 p-5">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Client training</h3>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="ac-client-training"
          checked={value.clientTraining}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({
              ...value,
              clientTraining: checked === true,
              ...(checked === true
                ? {}
                : { trainingPandaDocTemplateId: null }),
            })
          }
        />
        <div className="space-y-1">
          <Label htmlFor="ac-client-training" className="text-sm font-medium cursor-pointer">
            Client training required
          </Label>
          <p className="text-xs text-muted-foreground leading-relaxed">
            When enabled, employees linked to this client&apos;s jobs receive the selected PandaDoc
            training by email. Job placement is not blocked.
          </p>
        </div>
      </div>

      {value.clientTraining && (
        <div className="space-y-2">
          <Label>Training document *</Label>
          <Select
            value={value.trainingPandaDocTemplateId ?? undefined}
            disabled={disabled}
            onValueChange={(id) =>
              onChange({ ...value, trainingPandaDocTemplateId: id, existingFileName: null })
            }
          >
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Choose training document" />
            </SelectTrigger>
            <SelectContent>
              {ACTIVE_CLIENT_TRAINING_TEMPLATES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="inline-flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {t.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value.existingFileName && !value.trainingPandaDocTemplateId && (
            <p className="text-[11px] text-muted-foreground">
              Legacy file on file: {value.existingFileName}. Choose a PandaDoc template to switch.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
