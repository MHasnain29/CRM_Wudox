import { apiFetch } from './api';

export type ReportScope = 'agency' | 'organization';
export type ReportProfile = 'software' | 'marketing_sales' | 'recruitment' | 'general';

export const REPORT_PROFILES: { key: ReportProfile; label: string }[] = [
  { key: 'software', label: 'Software / IT' },
  { key: 'marketing_sales', label: 'Marketing / Sales' },
  { key: 'recruitment', label: 'Recruitment' },
  { key: 'general', label: 'General' },
];

export interface ReportPerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export interface DailyReportPolicy {
  id?: string;
  scope: ReportScope;
  scopeId: string;
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  timezone: string;
  shiftHours: number;
  period: 'today' | 'previous_day';
  recipientEmail: string | null;
  authorizedById: string | null;
  profiles: ReportProfile[];
  agencyIds: string[];
}

export interface DailyReportSettingsData {
  policy: DailyReportPolicy;
  members: (ReportPerson & { profile: ReportProfile; profileOverride: ReportProfile | null })[];
  roles: { key: string; name: string; profile: ReportProfile }[];
  agencies: { id: string; name: string }[];
  canManageOrganization: boolean;
  canConfigureDelivery: boolean;
  defaultScope: ReportScope;
}

export interface ReportDelivery {
  id: string;
  snapshotId: string;
  recipientName: string;
  recipientEmail: string;
  reportDate: string;
  status: string;
  attempts: number;
  lastError: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface ReportMetric {
  key: string;
  label: string;
  value: number | null;
  unit?: string;
}

export interface ReportTask {
  id: string;
  title: string;
  projectName: string;
  status: string;
  completedAt: string | null;
  dueAt: string | null;
  estimateSeconds: number | null;
  todaySeconds: number | null;
  totalSeconds: number | null;
  contributionSeconds: number | null;
  sourceUrl: string | null;
}

export interface ReportEmployee {
  userId: string;
  name: string;
  role: string;
  profile: ReportProfile;
  agencyId: string | null;
  agencyName: string;
  metrics: ReportMetric[];
  time: {
    trackedSeconds: number | null;
    manualSeconds: number | null;
    idleSeconds: number | null;
    inputActivityPercent: number | null;
    unallocatedSeconds: number | null;
    status: 'complete' | 'partial' | 'stale' | 'unavailable' | 'restricted';
    categories: { project: string; profile: string; trackedSeconds: number }[];
  };
  crmUsage?: { recordedEvents: number; firstActivityAt: string | null; lastActivityAt: string | null };
  tasks: ReportTask[];
  evidence: { type: string; title: string; at: string; url: string | null }[];
  warnings: string[];
}

export interface DailyReportPayload {
  version: 1;
  title: string;
  reportDate: string;
  timezone: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  recipient: { id: string; name: string; email: string };
  authorizedById?: string | null;
  scope: ReportScope;
  agencyIds: string[];
  userIds: string[];
  requiredPermissions: string[];
  profiles: string[];
  people: ReportEmployee[];
  summary: { people: number; trackedSeconds: number | null; completedTasks: number | null; personalEmails: number; repliesReceived?: number; followUpsCompleted: number };
  sources: { label: string; status: string; lastSyncedAt: string | null }[];
  warnings: string[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch<T>(path, options);
  if (response.ok === false) throw new Error(response.error || 'The daily report request could not be completed.');
  return response.data;
}

export const getDailyReportSettings = (scope: ReportScope) =>
  request<DailyReportSettingsData>(`/daily-reports/settings?scope=${scope}`);

export const saveDailyReportSettings = (scope: ReportScope, policy: DailyReportPolicy) =>
  request<DailyReportSettingsData>(`/daily-reports/settings?scope=${scope}`, {
    method: 'PATCH', body: JSON.stringify({
      enabled: policy.enabled,
      recipientEmail: policy.recipientEmail?.trim() || null,
      sendHour: policy.sendHour,
      sendMinute: policy.sendMinute,
      timezone: policy.timezone,
      shiftHours: policy.shiftHours,
      period: policy.period,
    }),
  });

export const saveReportProfile = (subjectType: 'user' | 'role', subjectId: string, profile: ReportProfile | null) =>
  request<{ ok: true }>('/daily-reports/profiles', {
    method: 'PATCH', body: JSON.stringify({ subjectType, subjectId, profile }),
  });

export const getReportHistory = (scope: ReportScope) =>
  request<{ data: ReportDelivery[] }>(`/daily-reports/history?scope=${scope}`).then((result) => result.data);

export const retryReportDelivery = (id: string) =>
  request<{ ok: true }>(`/daily-reports/deliveries/${encodeURIComponent(id)}/retry`, { method: 'POST' });

export const previewDailyReport = (scope: ReportScope, date?: string) =>
  request<{ id: string; report: DailyReportPayload }>(`/daily-reports/preview?scope=${scope}`, {
    method: 'POST', body: JSON.stringify(date ? { date } : {}),
  });

export const getDailyReportSnapshot = (id: string) =>
  request<DailyReportPayload>(`/daily-reports/snapshots/${encodeURIComponent(id)}`);
