export interface CurrentCrmTracking {
  status: 'outside_working_hours' | 'on_break' | 'disconnected' | 'waiting' | 'waiting_for_canonical_measurement' | 'measuring' | 'schedule_unavailable';
  asOf: string;
  workStartTime: string | null;
  workEndTime: string | null;
  timeZone: string | null;
  lastHeartbeatAt: string | null;
  lastObservedAt: string | null;
}

export interface CrmTimePerson {
  userId: string;
  name?: string;
  role?: string;
  agencyId?: string | null;
  timeSource: 'crm' | 'hubstaff';
  currentTracking?: CurrentCrmTracking;
  crmInactivity?: {
    activeSeconds?: number | null;
    idleSeconds: number | null;
    breakSeconds?: number;
    breakOngoing?: boolean;
    observedSeconds: number;
    status: 'measured' | 'unavailable';
  };
}

export interface CrmTimeReport {
  from: string;
  to: string;
  asOf: string;
  people: CrmTimePerson[];
}

/** Current status is separate from the selected period's measured/unavailable totals. */
export function formatCrmWorkingHours(tracking: CurrentCrmTracking): string {
  if (tracking.workStartTime === null && tracking.workEndTime === null) return 'No working-hours restriction';
  if (!tracking.workStartTime || !tracking.workEndTime) return 'Schedule unavailable';
  const zone = tracking.timeZone === 'America/Toronto'
    ? 'Canadian Eastern Time · America/Toronto' : tracking.timeZone ?? 'tracking timezone unavailable';
  return `${tracking.workStartTime}–${tracking.workEndTime} (${zone})`;
}

export function describeCurrentCrmTracking(tracking: CurrentCrmTracking): string {
  switch (tracking.status) {
    case 'outside_working_hours':
      return `Outside working hours ${formatCrmWorkingHours(tracking)}`;
    case 'on_break': return 'On break; active and inactivity measurement is paused';
    case 'disconnected': return 'No recent tracking connection; new active and inactivity time is not being measured';
    case 'waiting': return 'Waiting for a continuous CRM observation';
    case 'waiting_for_canonical_measurement': return 'Waiting for tracking to resume in Canadian Eastern Time';
    case 'measuring': return 'Receiving measured CRM observations';
    case 'schedule_unavailable': return 'Working-hours schedule or tracking timezone is unavailable';
  }
}

/** Missing observations stay unavailable; IT rows never contribute CRM totals. */
export function summarizeCrmTime(people: CrmTimePerson[]) {
  const crm = people.filter(person => person.timeSource === 'crm');
  const measured = crm.filter(person => person.crmInactivity?.status === 'measured');
  const sumKnown = (values: (number | null | undefined)[]) => {
    const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    crmCount: crm.length,
    hubstaffCount: people.length - crm.length,
    measuredCount: measured.length,
    partial: measured.length > 0 && measured.length < crm.length,
    activeSeconds: sumKnown(measured.map(person => person.crmInactivity?.activeSeconds)),
    idleSeconds: sumKnown(measured.map(person => person.crmInactivity?.idleSeconds)),
    breakSeconds: sumKnown(crm.map(person => person.crmInactivity?.breakSeconds)),
    observedSeconds: sumKnown(measured.map(person => person.crmInactivity?.observedSeconds)),
    breakOngoing: crm.some(person => person.crmInactivity?.breakOngoing),
  };
}

export function formatCrmSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'Unavailable';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours ? `${hours}h ${minutes}m ${remaining}s` : minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

/** Empty explicit selections must never expand into an unfiltered audience. */
export function hasCrmTimeAudience(agencyIds?: string[], userIds?: string[]): boolean {
  return (!agencyIds || agencyIds.length > 0) && (!userIds || userIds.length > 0);
}
