import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { resolveReportDeliveryTarget, canReadReport, reportAudience } from '../services/dailyReportRecipients';
import { buildDailyReport } from '../services/dailyReportBuilder';
import { sendReportSnapshot } from '../services/dailyReportEmail';
import { localDateKey, reportDue, shiftDate } from '../services/reportMetrics';
import { REPORT_PROFILES, type DailyReportPayload } from '../services/dailyReportTypes';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function classifyReportFailure(error: unknown): 'failed' | 'unknown' {
  const value = (error ?? {}) as { definiteFailure?: boolean; code?: number; response?: { statusCode?: number } };
  const status = value.response?.statusCode ?? (typeof value.code === 'number' ? value.code : undefined);
  return value.definiteFailure || (status && status >= 400 && status < 600) ? 'failed' : 'unknown';
}

export async function queueDailyReports(now = new Date()): Promise<void> {
  const policies = await prisma.dailyReportPolicy.findMany({ where: { enabled: true } });
  for (const policy of policies) {
    try {
      if (!reportDue(policy, now)) continue;
      const today = localDateKey(now, policy.timezone);
      const date = shiftDate(today, policy.period === 'previous_day' ? -1 : 0);
      const target = await resolveReportDeliveryTarget(policy);
      if (!target) continue;
      const effectivePolicy = { ...policy, agencyIds: target.agencyIds ?? policy.agencyIds, profiles: [...REPORT_PROFILES] };
      if (!effectivePolicy.agencyIds.length) continue;
      const key = `${policy.id}:${date}`;
      // The policy owns one delivery per day, even when its destination changes.
      // Also recognize deliveries produced by the former per-user scheduler.
      if (await prisma.dailyReportDelivery.findFirst({ where: { OR: [
        { deliveryKey: key }, { snapshot: { policyId: policy.id, reportDate: date } },
      ] }, select: { id: true } })) continue;
      const report = await buildDailyReport(effectivePolicy, target.user, date, false, now);
      try {
        await prisma.$transaction(async tx => {
          const snapshot = await tx.dailyReportSnapshot.create({ data: { policyId: policy.id, recipientId: target.user.id, reportDate: date, payload: report as unknown as Prisma.InputJsonValue } });
          await tx.dailyReportDelivery.create({ data: { deliveryKey: key, snapshotId: snapshot.id, recipientId: target.user.id, recipientEmail: target.email } });
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    } catch (error) { console.error(`[dailyReport] Could not prepare policy ${policy.id}:`, error); }
  }
}

export async function processDailyReportDeliveries(now = new Date()): Promise<void> {
  // A worker may have died after provider acceptance. Do not blindly resend its message.
  await prisma.dailyReportDelivery.updateMany({ where: { status: 'sending', leaseUntil: { lt: now } }, data: { status: 'unknown', leaseUntil: null, lastError: 'Worker stopped during provider submission. Check provider delivery history before any resend.' } });
  const deliveries = await prisma.dailyReportDelivery.findMany({ where: { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now }, attempts: { lt: 5 } }, include: { snapshot: { include: { policy: true } } }, orderBy: { nextAttemptAt: 'asc' }, take: 100 });
  for (const delivery of deliveries) {
    const policy = delivery.snapshot.policy;
    const report = delivery.snapshot.payload as unknown as DailyReportPayload;
    const target = policy.enabled ? await resolveReportDeliveryTarget(policy) : null;
    const effectivePolicy = { ...policy, agencyIds: target?.agencyIds ?? policy.agencyIds, profiles: [...REPORT_PROFILES] };
    const sameAuthorization = target?.user.isActive && target.user.id === delivery.recipientId
      && report.recipient.id === target.user.id && (!report.authorizedById || report.authorizedById === target.user.id);
    const sameAddress = target?.email === delivery.recipientEmail && report.recipient.email === delivery.recipientEmail;
    const allowedAudience = target && sameAuthorization && sameAddress
      ? await reportAudience(target.user, effectivePolicy.agencyIds, false, false, policy.scope === 'organization') : null;
    const policyMatches = report.agencyIds.every(id => effectivePolicy.agencyIds.includes(id)) && report.profiles.every(profile => effectivePolicy.profiles.includes(profile as typeof REPORT_PROFILES[number]));
    const peopleStillIncluded = allowedAudience && report.userIds.every(id => allowedAudience.users.some(user => user.id === id));
    if (!target || !sameAuthorization || !sameAddress || !policyMatches || !peopleStillIncluded || !await canReadReport(target.user, report)) {
      await prisma.dailyReportDelivery.updateMany({ where: { id: delivery.id, status: { in: ['pending', 'failed'] } }, data: { status: 'cancelled', lastError: 'Report authorization, destination, policy or permissions changed; generate a new report.' } });
      continue;
    }
    const claim = await prisma.dailyReportDelivery.updateMany({ where: { id: delivery.id, status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now }, attempts: delivery.attempts }, data: { status: 'sending', attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 2 * 60000) } });
    if (!claim.count) continue;
    try {
      const providerId = await sendReportSnapshot(report, delivery.snapshotId);
      await prisma.dailyReportDelivery.update({ where: { id: delivery.id }, data: { status: 'accepted', acceptedAt: new Date(), providerId, leaseUntil: null, lastError: null } });
    } catch (error) {
      const status = classifyReportFailure(error);
      await prisma.dailyReportDelivery.update({ where: { id: delivery.id }, data: {
        status, leaseUntil: null, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Report submission failed',
        nextAttemptAt: new Date(Date.now() + Math.min(360, 5 * 2 ** delivery.attempts) * 60000),
      } });
    }
  }
}

export async function checkAndSendReports(): Promise<void> {
  if (running) return;
  running = true;
  try { await queueDailyReports(); await processDailyReportDeliveries(); }
  catch (error) { console.error('[dailyReport] Processing failed:', error); }
  finally { running = false; }
}
export function startDailyReportEmailer(): void {
  if (!timer) timer = setInterval(() => void checkAndSendReports(), 5 * 60000);
}
export function stopDailyReportEmailer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
