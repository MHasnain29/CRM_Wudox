import prisma from '../config/database';
import { defaultReportProfile } from './reportMetrics';
import { REPORT_PROFILES, type ReportProfile } from './dailyReportTypes';

export async function profileResolver(mainOrgIds: string[], asOf = new Date()) {
  const rows = await prisma.reportProfileAssignment.findMany({
    where: { mainOrgId: { in: mainOrgIds }, effectiveFrom: { lte: asOf } }, orderBy: { effectiveFrom: 'desc' },
  });
  return (user: { id: string; role: string }, mainOrgId: string): ReportProfile => {
    const override = rows.find(r => r.mainOrgId === mainOrgId && r.subjectType === 'user' && r.subjectId === user.id);
    const assignment = override && override.profile !== 'default' ? override
      : rows.find(r => r.mainOrgId === mainOrgId && r.subjectType === 'role' && r.subjectId === user.role);
    return assignment && REPORT_PROFILES.includes(assignment.profile as ReportProfile)
      ? assignment.profile as ReportProfile : defaultReportProfile(user.role);
  };
}
