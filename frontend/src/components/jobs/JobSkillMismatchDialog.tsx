/**
 * Confirm placing an employee when their skills don't fully match the job.
 * Portaled above Manage Employees; outside click closes only this layer.
 */
import type { MouseEvent, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export const SKILL_MISMATCH_OVERLAY_ATTR = 'data-skill-mismatch-overlay';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  missingSkills: string[];
  busy?: boolean;
  onAllow: () => void;
};

export function JobSkillMismatchDialog({
  open,
  onOpenChange,
  employeeName,
  missingSkills,
  busy,
  onAllow,
}: Props) {
  if (!open || typeof document === 'undefined') return null;

  const skillList = missingSkills.join(', ');

  const dismiss = (e: MouseEvent | PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) onOpenChange(false);
  };

  return createPortal(
    <div
      {...{ [SKILL_MISMATCH_OVERLAY_ATTR]: '' }}
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4 pointer-events-auto"
      onPointerDown={(e) => {
        // Stop Radix parent Dialog from treating this as an outside dismiss.
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={dismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skill-mismatch-title"
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg pointer-events-auto"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="skill-mismatch-title" className="text-lg font-semibold">
          Skills don&apos;t match
        </h2>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{employeeName}</span> is missing
            required skill{missingSkills.length === 1 ? '' : 's'} for this job
            {skillList ? `: ${skillList}` : ''}.
          </p>
          <p>Allow adding them to this job anyway?</p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={onAllow}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              'Allow'
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Case-insensitive: which required skills the employee lacks. */
export function missingRequiredSkills(
  employeeSkills: string[] | null | undefined,
  requiredSkills: string[] | null | undefined,
): string[] {
  const required = (requiredSkills ?? []).map((s) => s.trim()).filter(Boolean);
  if (required.length === 0) return [];
  const have = new Set((employeeSkills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
  return required.filter((s) => !have.has(s.toLowerCase()));
}
