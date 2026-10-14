import prisma from '../config/database';
import { crmTimeReportQuerySchema, resolveReportPeople } from './crmTimeReport';

export interface EmailActivityPerson {
  userId: string;
  name: string;
  role: string;
  agencyId: string | null;
  /** Messages the person composed and sent themselves (provider-accepted). */
  individual: { emails: number };
  /** Campaigns the person created, counted by what was actually sent in the period. */
  bulk: { campaigns: number; emails: number };
}

export interface EmailActivityReport {
  from: string;
  to: string;
  people: EmailActivityPerson[];
}

/** Postgres caps bind parameters at 32767; a long period can touch many campaigns. */
const CAMPAIGN_CHUNK = 5000;

/**
 * Individual and bulk email counts per person. Uses the same audience as the Measured CRM Time card, so the
 * agency / manager / user filters narrow both identically, and the same evidence as daily reports:
 *   - individual: Email rows classed `personal` that the provider accepted, by `sentAt`, credited to
 *     `activityActorId` (campaign copies in the Sent box have no kind or actor, so they are never counted here);
 *   - bulk: EmailCampaignRecipient rows with a `sentAt` in the period, credited to the campaign's creator.
 */
export async function buildEmailActivityReport(userId: string, rawQuery: unknown): Promise<EmailActivityReport> {
  const query = crmTimeReportQuerySchema.parse(rawQuery);
  const from = new Date(query.from);
  const to = new Date(query.to);
  const report: EmailActivityReport = { from: from.toISOString(), to: to.toISOString(), people: [] };
  const audience = await resolveReportPeople(userId, query);
  if (!audience?.people.length) return report;

  const { agencyIds, people } = audience;
  const userIds = people.map(person => person.id);
  const period = { gte: from, lte: to };

  const [individualRows, campaigns] = await Promise.all([
    prisma.email.groupBy({
      by: ['activityActorId'],
      where: {
        activityActorId: { in: userIds }, subCompanyId: { in: agencyIds },
        sendingKind: 'personal', sendStatus: 'accepted', sentAt: period,
      },
      _count: { _all: true },
    }),
    prisma.emailCampaign.findMany({
      where: { createdById: { in: userIds }, subCompanyId: { in: agencyIds }, recipients: { some: { sentAt: period } } },
      select: { id: true, createdById: true },
    }),
  ]);

  const individualByUser = new Map<string, number>();
  for (const row of individualRows) {
    if (row.activityActorId) individualByUser.set(row.activityActorId, row._count._all);
  }

  const creatorByCampaign = new Map<string, string>();
  const campaignsByUser = new Map<string, number>();
  for (const campaign of campaigns) {
    if (!campaign.createdById) continue;
    creatorByCampaign.set(campaign.id, campaign.createdById);
    campaignsByUser.set(campaign.createdById, (campaignsByUser.get(campaign.createdById) ?? 0) + 1);
  }

  const bulkEmailsByUser = new Map<string, number>();
  const campaignIds = [...creatorByCampaign.keys()];
  for (let i = 0; i < campaignIds.length; i += CAMPAIGN_CHUNK) {
    const sent = await prisma.emailCampaignRecipient.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds.slice(i, i + CAMPAIGN_CHUNK) }, sentAt: period },
      _count: { _all: true },
    });
    for (const row of sent) {
      const creator = creatorByCampaign.get(row.campaignId);
      if (creator) bulkEmailsByUser.set(creator, (bulkEmailsByUser.get(creator) ?? 0) + row._count._all);
    }
  }

  report.people = people.map(person => ({
    userId: person.id,
    name: `${person.firstName} ${person.lastName}`.trim() || person.email,
    role: person.role,
    agencyId: person.subCompanyId,
    individual: { emails: individualByUser.get(person.id) ?? 0 },
    bulk: { campaigns: campaignsByUser.get(person.id) ?? 0, emails: bulkEmailsByUser.get(person.id) ?? 0 },
  }));
  return report;
}
