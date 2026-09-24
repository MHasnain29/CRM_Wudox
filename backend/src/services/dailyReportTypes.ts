export const REPORT_PROFILES = ['software', 'marketing_sales', 'recruitment', 'general'] as const;
export type ReportProfile = typeof REPORT_PROFILES[number];
export type ReportScope = 'agency' | 'organization';
export interface ReportPolicyInput {
  scope: ReportScope;
  scopeId: string;
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  timezone: string;
  shiftHours: number;
  period: 'today' | 'previous_day';
  recipientEmail: string | null;
  authorizedById?: string | null;
  profiles: string[];
  agencyIds: string[];
}
export interface ReportMetric { key: string; label: string; value: number | null; unit?: string }
export interface ReportTask {
  id: string; title: string; projectName: string; status: string;
  completedAt: string | null; dueAt: string | null; estimateSeconds: number | null;
  todaySeconds: number | null; totalSeconds: number | null; contributionSeconds: number | null;
  sourceUrl: string | null;
}
export interface ReportPerson {
  userId: string; name: string; role: string; profile: ReportProfile;
  agencyId: string | null; agencyName: string;
  metrics: ReportMetric[];
  time: {
    trackedSeconds: number | null; manualSeconds: number | null; idleSeconds: number | null;
    inputActivityPercent: number | null; unallocatedSeconds: number | null;
    status: 'complete' | 'partial' | 'stale' | 'unavailable' | 'restricted';
    categories: { project: string; profile: string; trackedSeconds: number }[];
  };
  crmUsage?: { recordedEvents: number; firstActivityAt: string | null; lastActivityAt: string | null };
  tasks: ReportTask[];
  evidence: { type: string; title: string; at: string; url: string | null }[];
  warnings: string[];
}
export interface DailyReportPayload {
  version: 1; title: string; reportDate: string; timezone: string;
  periodStart: string; periodEnd: string; generatedAt: string;
  recipient: { id: string; name: string; email: string };
  authorizedById?: string;
  scope: ReportScope; agencyIds: string[]; userIds: string[]; requiredPermissions: string[];
  profiles: string[]; people: ReportPerson[];
  summary: { people: number; trackedSeconds: number | null; completedTasks: number | null; personalEmails: number; followUpsCompleted: number; repliesReceived?: number };
  sources: { label: string; status: string; lastSyncedAt: string | null }[];
  warnings: string[];
}
