/**
 * Daily Report Emailer
 *
 * Runs every 5 minutes. For each agency with daily reports enabled,
 * checks if it's past the configured send time (in the agency's timezone).
 * If so, gathers today's stats for each manager's team and sends a combined
 * performance report email via SendGrid.
 *
 * Deduplication: one 'daily_report_sent' activity log per agency per day.
 */
import prisma from '../config/database';
import { createActivityLog } from '../services/activityLog';
import { sendDailyReportEmail, type UserDailyStats } from '../services/email';
import { env } from '../config/env';
import { getRoleLabel } from '../config/permissions';
import { getUserIdsWithMinScope } from '../services/accessContext';
import { DEFAULT_BRAND_NAME } from '../config/branding';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let intervalTimer: ReturnType<typeof setInterval> | null = null;

// ─── Timezone helpers ───────────────────────────────────────────────────────

function getCurrentTimeInTimezone(timezone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());

    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    return { hour, minute };
  } catch {
    return { hour: new Date().getUTCHours(), minute: new Date().getUTCMinutes() };
  }
}

function getDayBoundsUTC(timezone: string): { startUTC: Date; endUTC: Date } {
  const now = new Date();
  // Get today's date in the target timezone
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "2026-03-26"

  // Create dates and use timezone offset to find UTC equivalents
  // We create a temporary date to calculate the offset
  const tempDate = new Date(`${dateStr}T12:00:00Z`);
  const utcStr = tempDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = tempDate.toLocaleString('en-US', { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  const offsetMs = utcDate.getTime() - tzDate.getTime();

  // Midnight in the target timezone → UTC
  const midnightLocal = new Date(`${dateStr}T00:00:00Z`);
  const startUTC = new Date(midnightLocal.getTime() + offsetMs);
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);

  return { startUTC, endUTC };
}

function formatDateForTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

// ─── Data gathering ─────────────────────────────────────────────────────────

async function gatherUserDailyStats(
  userId: string,
  user: { firstName: string; lastName: string; role: string; email: string },
  startUTC: Date,
  endUTC: Date,
  shiftHours: number,
  subCompanyId: string,
): Promise<UserDailyStats> {
  const [
    callsTotal,
    callsAnswered,
    callsDurationAgg,
    emailsSent,
    meetingsTotal,
    meetingsCompleted,
    tasksAssigned,
    tasksCompleted,
    followUpsAssigned,
    followUpsCompleted,
    meetingsScheduled,
    leadsWon,
    leadsAssigned,
    breakLogs,
    idleLogs,
  ] = await Promise.all([
    // Calls
    prisma.call.count({ where: { ownerId: userId, timestamp: { gte: startUTC, lt: endUTC } } }),
    prisma.call.count({ where: { ownerId: userId, timestamp: { gte: startUTC, lt: endUTC }, outcome: 'answered' } }),
    prisma.call.aggregate({ where: { ownerId: userId, timestamp: { gte: startUTC, lt: endUTC } }, _sum: { duration: true } }),
    // Emails
    prisma.activityLog.count({ where: { userId, type: 'email_sent', timestamp: { gte: startUTC, lt: endUTC } } }),
    // Meetings
    prisma.meeting.count({ where: { ownerId: userId, startTime: { gte: startUTC, lt: endUTC } } }),
    prisma.meeting.count({ where: { ownerId: userId, startTime: { gte: startUTC, lt: endUTC }, status: 'completed' } }),
    // Tasks
    prisma.task.count({ where: { ownerId: userId, dueDate: { gte: startUTC, lt: endUTC } } }),
    prisma.task.count({ where: { ownerId: userId, status: 'done', updatedAt: { gte: startUTC, lt: endUTC } } }),
    // Follow-ups
    prisma.followUp.count({ where: { ownerId: userId, dueDate: { gte: startUTC, lt: endUTC } } }),
    prisma.followUp.count({ where: { ownerId: userId, completed: true, updatedAt: { gte: startUTC, lt: endUTC } } }),
    // Meetings scheduled (created today)
    prisma.meeting.count({ where: { ownerId: userId, createdAt: { gte: startUTC, lt: endUTC } } }),
    // Pipeline
    prisma.lead.count({ where: { ownerId: userId, status: 'closed_won', updatedAt: { gte: startUTC, lt: endUTC } } }),
    prisma.lead.count({ where: { ownerId: userId, createdAt: { gte: startUTC, lt: endUTC } } }),
    // Break logs
    prisma.activityLog.findMany({
      where: { userId, type: 'break_detected', timestamp: { gte: startUTC, lt: endUTC } },
      select: { metadata: true },
    }),
    // Idle logs
    prisma.activityLog.findMany({
      where: { userId, type: 'idle_detected', timestamp: { gte: startUTC, lt: endUTC } },
      select: { metadata: true },
    }),
  ]);

  const coachingTime = breakLogs
    .filter((l) => (l.metadata as Record<string, unknown>)?.breakType === 'coaching')
    .reduce((a, l) => a + (((l.metadata as Record<string, unknown>)?.duration as number) || 0), 0);
  const meetingBreakTime = breakLogs
    .filter((l) => (l.metadata as Record<string, unknown>)?.breakType === 'meeting')
    .reduce((a, l) => a + (((l.metadata as Record<string, unknown>)?.duration as number) || 0), 0);
  const totalBreak = coachingTime + meetingBreakTime;
  const totalIdle = idleLogs
    .reduce((a, l) => a + (((l.metadata as Record<string, unknown>)?.duration as number) || 0), 0);

  const shiftMinutes = shiftHours * 60;
  const activeTime = Math.max(0, shiftMinutes - totalBreak - totalIdle);
  const productivityPercent = shiftMinutes > 0 ? Math.round((activeTime / shiftMinutes) * 100) : 0;

  // Role-level performance target active on this day
  const performanceTarget = await prisma.performanceTarget.findFirst({
    where: { subCompanyId, role: user.role, effectiveFrom: { lte: startUTC } },
    orderBy: { effectiveFrom: 'desc' },
    select: { emailsTarget: true, callsTarget: true, meetingScheduleCountTarget: true },
  });

  return {
    user: { id: userId, firstName: user.firstName, lastName: user.lastName, role: getRoleLabel(user.role), email: user.email },
    calls: { total: callsTotal, answered: callsAnswered, totalDurationSeconds: callsDurationAgg._sum.duration ?? 0 },
    emailsSent,
    meetings: { total: meetingsTotal, completed: meetingsCompleted },
    tasks: { assigned: tasksAssigned, completed: tasksCompleted },
    followUps: { assigned: followUpsAssigned, completed: followUpsCompleted },
    meetingsScheduled,
    pipeline: { won: leadsWon, assigned: leadsAssigned },
    breakTime: { total: totalBreak, coaching: coachingTime, meeting: meetingBreakTime },
    idleTime: totalIdle,
    activeTime,
    productivityPercent,
    target: performanceTarget ?? null,
  };
}

// ─── Core logic ─────────────────────────────────────────────────────────────

async function checkAndSendReports(): Promise<void> {
  try {
    // Find all agencies with daily reports enabled
    const settings = await prisma.dailyReportSetting.findMany({
      where: { enabled: true },
      include: { subCompany: { select: { id: true, name: true, agencyLogoUrl: true, emailFooterText: true, emailFromAddress: true, emailFromName: true, emailSendAsDomain: true, emailInboundDomain: true, emailInboundLocalpart: true } } },
    });

    for (const setting of settings) {
      try {
        // Check if it's past send time in the agency's timezone
        const { hour, minute } = getCurrentTimeInTimezone(setting.timezone);
        if (hour < setting.sendHour || (hour === setting.sendHour && minute < setting.sendMinute)) {
          continue; // Not time yet
        }

        // Get day boundaries in UTC for this timezone
        const { startUTC, endUTC } = getDayBoundsUTC(setting.timezone);

        // Dedup: check if already sent today for this agency
        const alreadySent = await prisma.activityLog.count({
          where: {
            subCompanyId: setting.subCompanyId,
            type: 'daily_report_sent',
            timestamp: { gte: startUTC, lt: endUTC },
          },
        });
        if (alreadySent > 0) continue;

        const agencyBranding = {
          name: setting.subCompany.name?.trim() || 'Agency',
          logoUrl: setting.subCompany.agencyLogoUrl?.trim() || null,
          emailFooterText: setting.subCompany.emailFooterText,
          emailFromAddress: setting.subCompany.emailFromAddress ?? '',
          emailFromName: setting.subCompany.emailFromName ?? setting.subCompany.name ?? DEFAULT_BRAND_NAME,
          emailSendAsDomain: setting.subCompany.emailSendAsDomain ?? null,
          emailInboundDomain: setting.subCompany.emailInboundDomain ?? env.EMAIL_INBOUND_DOMAIN ?? null,
          emailInboundLocalpart: setting.subCompany.emailInboundLocalpart ?? env.EMAIL_INBOUND_LOCALPART ?? null,
        };
        const dateStr = formatDateForTimezone(setting.timezone);
        const appUrl = env.APP_URL ?? 'https://staffing.wudox.ca';
        let totalManagersSent = 0;
        let totalMembersReported = 0;

        // Users with team+ scope receive reports about their linked direct reports only
        const managerIds = await getUserIdsWithMinScope(setting.subCompanyId, 'team');
        const managers =
          managerIds.length === 0
            ? []
            : await prisma.user.findMany({
                where: { id: { in: managerIds }, isActive: true },
                select: { id: true, firstName: true, lastName: true, email: true, role: true },
              });

        for (const manager of managers) {
          try {
            const teamMembers = await prisma.user.findMany({
              where: {
                subCompanyId: setting.subCompanyId,
                isActive: true,
                reportingManagerIds: { has: manager.id },
              },
              select: { id: true, firstName: true, lastName: true, email: true, role: true },
            });
            if (teamMembers.length === 0) continue;

            const teamStats = await Promise.all(
              teamMembers.map((m) => gatherUserDailyStats(m.id, m, startUTC, endUTC, setting.shiftHours, setting.subCompanyId))
            );

            const sent = await sendDailyReportEmail({
              toEmail: manager.email, managerName: manager.firstName,
              date: dateStr, teamStats, appUrl, agency: agencyBranding,
            });
            if (sent) { totalManagersSent++; totalMembersReported += teamMembers.length; }
          } catch (err) {
            console.error(`[dailyReport] Error sending to manager ${manager.email}:`, err);
          }
        }

        // Log dedup entry for this agency (even if 0 sent — prevents re-checking)
        if (totalManagersSent > 0 || managers.length > 0) {
          await createActivityLog({
            userId: managers[0]?.id ?? 'system',
            userName: 'Daily Report System',
            subCompanyId: setting.subCompanyId,
            type: 'daily_report_sent',
            description: `Daily report sent to ${totalManagersSent} manager(s) covering ${totalMembersReported} team member(s)`,
            metadata: {
              managerCount: totalManagersSent,
              totalMembers: totalMembersReported,
              sendHour: setting.sendHour,
              timezone: setting.timezone,
            },
          });
        }

        console.log(`[dailyReport] ${setting.subCompany.name}: sent to ${totalManagersSent} managers (${totalMembersReported} members)`);
      } catch (err) {
        console.error(`[dailyReport] Error for agency ${setting.subCompanyId}:`, err);
      }
    }
  } catch (err) {
    console.error('[dailyReport] Fatal error:', err);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startDailyReportEmailer(): void {
  if (intervalTimer) return;
  intervalTimer = setInterval(checkAndSendReports, CHECK_INTERVAL_MS);
  console.log('📊 Daily report emailer started (5-min check interval)');
}

export function stopDailyReportEmailer(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
