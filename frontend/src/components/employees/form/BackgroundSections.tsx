import { useState } from 'react';
import { Briefcase, ChevronsUpDown, GraduationCap, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FieldError, FieldLabel, SectionCard } from './SectionCard';
import {
  SKILL_OPTIONS,
  emptyEducationEntry,
  emptyExperienceEntry,
  type EmployeeFormState,
  type FormErrors,
  type SetField,
} from './formTypes';

type SectionProps = {
  form: EmployeeFormState;
  errors: FormErrors;
  setField: SetField;
};

const errCls = (msg?: string) => (msg ? 'border-destructive' : undefined);

// ── Education (add multiple) ───────────────────────────────────────────────

export function EducationCard({ form, errors, setField }: SectionProps) {
  const update = (uid: string, patch: Partial<EmployeeFormState['education'][number]>) => {
    setField(
      'education',
      form.education.map((e) => (e.uid === uid ? { ...e, ...patch } : e)),
    );
  };

  return (
    <SectionCard
      icon={GraduationCap}
      title="Education"
      required
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setField('education', [...form.education, emptyEducationEntry()])}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      }
    >
      {form.education.map((entry, index) => {
        const key = (field: string) => `education.${index}.${field}`;
        return (
          <div
            key={entry.uid}
            className={cn('space-y-4', index > 0 && 'border-t pt-4')}
          >
            {form.education.length > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Education {index + 1}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() =>
                    setField('education', form.education.filter((e) => e.uid !== entry.uid))
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5" data-field={key('level')}>
                <FieldLabel required={index === 0}>Level of Education</FieldLabel>
                <Input
                  value={entry.level}
                  onChange={(e) => update(entry.uid, { level: e.target.value })}
                  placeholder="e.g. High School, Bachelor's"
                  className={errCls(errors[key('level')])}
                  maxLength={200}
                />
                <FieldError message={errors[key('level')]} />
              </div>
              <div className="space-y-1.5" data-field={key('graduated')}>
                <FieldLabel required={index === 0}>Graduated</FieldLabel>
                <Select
                  value={entry.graduated}
                  onValueChange={(v) => update(entry.uid, { graduated: v as 'yes' | 'no' })}
                >
                  <SelectTrigger className={errCls(errors[key('graduated')])}>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError message={errors[key('graduated')]} />
              </div>
              <div className="space-y-1.5" data-field={key('fromYear')}>
                <FieldLabel>From Year</FieldLabel>
                <Input
                  type="number"
                  min={1950}
                  max={2100}
                  value={entry.fromYear}
                  onChange={(e) => update(entry.uid, { fromYear: e.target.value })}
                  className={errCls(errors[key('fromYear')])}
                />
                <FieldError message={errors[key('fromYear')]} />
              </div>
              <div className="space-y-1.5" data-field={key('endYear')}>
                <FieldLabel>End Year</FieldLabel>
                <Input
                  type="number"
                  min={1950}
                  max={2100}
                  value={entry.endYear}
                  onChange={(e) => update(entry.uid, { endYear: e.target.value })}
                  className={errCls(errors[key('endYear')])}
                />
                <FieldError message={errors[key('endYear')]} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Course Studied</FieldLabel>
                <Input
                  value={entry.courseStudied}
                  onChange={(e) => update(entry.uid, { courseStudied: e.target.value })}
                  maxLength={255}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel>Diploma / Degree Name</FieldLabel>
                <Input
                  value={entry.diplomaName}
                  onChange={(e) => update(entry.uid, { diplomaName: e.target.value })}
                  maxLength={255}
                />
              </div>
            </div>
          </div>
        );
      })}
    </SectionCard>
  );
}

// ── Work experience (add multiple + none checkbox) ─────────────────────────

export function WorkExperienceCard({ form, errors, setField }: SectionProps) {
  const update = (uid: string, patch: Partial<EmployeeFormState['workExperiences'][number]>) => {
    setField(
      'workExperiences',
      form.workExperiences.map((e) => (e.uid === uid ? { ...e, ...patch } : e)),
    );
  };

  return (
    <SectionCard
      icon={Briefcase}
      title="Work Experience"
      required
      actions={
        !form.noWorkExperience && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setField('workExperiences', [...form.workExperiences, emptyExperienceEntry()])
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        )
      }
    >
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <Checkbox
          checked={form.noWorkExperience}
          onCheckedChange={(v) => setField('noWorkExperience', v === true)}
        />
        No work experience
      </label>

      {!form.noWorkExperience && (
        <>
          {form.workExperiences.map((entry, index) => {
            const key = (field: string) => `work.${index}.${field}`;
            return (
              <div key={entry.uid} className={cn('space-y-4', index > 0 && 'border-t pt-4')}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Company {index + 1}
                  </p>
                  {form.workExperiences.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() =>
                        setField(
                          'workExperiences',
                          form.workExperiences.filter((e) => e.uid !== entry.uid),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5" data-field={key('companyName')}>
                    <FieldLabel required>Company Name</FieldLabel>
                    <Input
                      value={entry.companyName}
                      onChange={(e) => update(entry.uid, { companyName: e.target.value })}
                      className={errCls(errors[key('companyName')])}
                      maxLength={255}
                    />
                    <FieldError message={errors[key('companyName')]} />
                  </div>
                  <div className="space-y-1.5" data-field={key('contactNumber')}>
                    <FieldLabel required>Contact Number</FieldLabel>
                    <Input
                      value={entry.contactNumber}
                      onChange={(e) => update(entry.uid, { contactNumber: e.target.value })}
                      className={errCls(errors[key('contactNumber')])}
                      maxLength={50}
                    />
                    <FieldError message={errors[key('contactNumber')]} />
                  </div>
                  <div className="space-y-1.5" data-field={key('position')}>
                    <FieldLabel required>Position</FieldLabel>
                    <Input
                      value={entry.position}
                      onChange={(e) => update(entry.uid, { position: e.target.value })}
                      className={errCls(errors[key('position')])}
                      maxLength={255}
                    />
                    <FieldError message={errors[key('position')]} />
                  </div>
                  <div className="space-y-1.5" data-field={key('duration')}>
                    <FieldLabel required>How Long</FieldLabel>
                    <Input
                      value={entry.duration}
                      onChange={(e) => update(entry.uid, { duration: e.target.value })}
                      placeholder="e.g. 2 years"
                      className={errCls(errors[key('duration')])}
                      maxLength={100}
                    />
                    <FieldError message={errors[key('duration')]} />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="space-y-1.5 border-t pt-4" data-field="experienceDuties">
            <FieldLabel required>Relevant Experience / Duties</FieldLabel>
            <Textarea
              value={form.experienceDuties}
              onChange={(e) => setField('experienceDuties', e.target.value)}
              rows={3}
              placeholder="Summarize relevant experience and duties…"
              className={errCls(errors.experienceDuties)}
              maxLength={10000}
            />
            <FieldError message={errors.experienceDuties} />
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── Skills (multi-select with custom entries) ──────────────────────────────

export function SkillsCard({ form, errors, setField }: SectionProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const toggleSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed) return;
    setField(
      'skills',
      form.skills.includes(trimmed)
        ? form.skills.filter((s) => s !== trimmed)
        : [...form.skills, trimmed],
    );
  };

  const showAddCustom =
    query.trim().length > 1 &&
    !SKILL_OPTIONS.some((s) => s.toLowerCase() === query.trim().toLowerCase()) &&
    !form.skills.some((s) => s.toLowerCase() === query.trim().toLowerCase());

  return (
    <SectionCard
      icon={Sparkles}
      title="Skills"
      description="Select all skills that apply — used for matching to job orders."
    >
      <div data-field="skills">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {form.skills.length > 0
              ? `${form.skills.length} skill${form.skills.length === 1 ? '' : 's'} selected`
              : 'Search and select skills…'}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search skills…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching skill.</CommandEmpty>
              <CommandGroup>
                {showAddCustom && (
                  <CommandItem
                    value={`add-${query}`}
                    onSelect={() => {
                      toggleSkill(query);
                      setQuery('');
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    Add “{query.trim()}”
                  </CommandItem>
                )}
                {SKILL_OPTIONS.map((skill) => (
                  <CommandItem key={skill} value={skill} onSelect={() => toggleSkill(skill)}>
                    <Checkbox checked={form.skills.includes(skill)} className="mr-2 pointer-events-none" />
                    {skill}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {form.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {form.skills.map((skill) => (
            <Badge key={skill} variant="secondary" className="gap-1 pr-1 font-normal">
              {skill}
              <button
                type="button"
                onClick={() => toggleSkill(skill)}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${skill}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <FieldError message={errors.skills} />
      </div>
    </SectionCard>
  );
}
