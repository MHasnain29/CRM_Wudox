/**
 * DEMO adapter — local PDF fill only (no PandaDoc, no backend).
 *
 * TODO(prod): return { mode: 'pdf', url } from
 *   GET /api/v1/employees/:id/onboarding-agreement/preview
 * Agency must come from the employee's owning agency (getEmployeeAgencyId),
 * not the viewer session default.
 */
import {
  buildOnboardingPrefill,
  type EmployeeOnboardingPrefill,
  type OnboardingEmployeeInput,
} from './buildOnboardingPrefill';

export type OnboardingPreviewLocal = {
  mode: 'local';
  prefill: EmployeeOnboardingPrefill;
};

export type OnboardingPreviewResult = OnboardingPreviewLocal;
// Future: | { mode: 'pdf'; url: string }

export function getOnboardingPreview(
  employee: OnboardingEmployeeInput,
  agency: { name: string; emailSendAsDomain?: string | null },
): OnboardingPreviewResult {
  return {
    mode: 'local',
    prefill: buildOnboardingPrefill(employee, agency),
  };
}
