import { defaultReportProfile } from './reportMetrics';

/** The account role chooses the measurement source; editable report profiles do not. */
export function usesCrmActivityTracking(role: string | null | undefined): boolean {
  return !!role?.trim() && defaultReportProfile(role) !== 'software';
}
