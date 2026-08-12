import prisma from '../config/database';
import {
  getRegistryEntry,
  getLegacyApprovalAliasKey,
  listRegistryEntries,
  type NotificationRegistryEntry,
} from './notificationRegistry';
import { renderNotificationTemplate } from './notificationTemplate';

const CACHE_TTL_MS = 60_000;

type AgencyRuleRow = {
  eventKey: string;
  enabled: boolean;
  titleTemplate: string | null;
  bodyTemplate: string | null;
};

type CachedAgencyRules = {
  expiresAt: number;
  rules: Map<string, AgencyRuleRow>;
};

const agencyRulesCache = new Map<string, CachedAgencyRules>();

export function invalidateAgencyNotificationRulesCache(subCompanyId: string): void {
  agencyRulesCache.delete(subCompanyId);
}

async function loadAgencyRules(subCompanyId: string): Promise<Map<string, AgencyRuleRow>> {
  const cached = agencyRulesCache.get(subCompanyId);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;

  if (!(prisma as any).agencyNotificationRule) return new Map();
  const rows = await prisma.agencyNotificationRule.findMany({
    where: { subCompanyId },
    select: {
      eventKey: true,
      enabled: true,
      titleTemplate: true,
      bodyTemplate: true,
    },
  });

  const rules = new Map(rows.map((r) => [r.eventKey, r]));
  agencyRulesCache.set(subCompanyId, {
    rules,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return rules;
}

/** Agency rule for eventKey, falling back to legacy approval_* key if configured there. */
function resolveAgencyRuleRow(
  rules: Map<string, AgencyRuleRow>,
  eventKey: string,
): AgencyRuleRow | undefined {
  const direct = rules.get(eventKey);
  if (direct) return direct;
  const legacyKey = getLegacyApprovalAliasKey(eventKey);
  if (legacyKey) return rules.get(legacyKey);
  return undefined;
}

export type ResolvedNotification = {
  title: string;
  body: string;
  storeAsType: string;
};

export function resolveNotificationContent(
  eventKey: string,
  context: Record<string, string>,
  agencyRule?: AgencyRuleRow | null,
): ResolvedNotification | null {
  const registry = getRegistryEntry(eventKey);
  if (!registry) {
    console.warn(`[notifications] Unknown eventKey: ${eventKey}`);
    return null;
  }

  if (agencyRule && agencyRule.enabled === false) return null;

  const titleTpl = agencyRule?.titleTemplate?.trim() || registry.defaultTitle;
  const bodyTpl = agencyRule?.bodyTemplate?.trim() || registry.defaultBody;

  const ctx = enrichContext(context, registry);
  return {
    title: renderNotificationTemplate(titleTpl, ctx),
    body: renderNotificationTemplate(bodyTpl, ctx),
    storeAsType: registry.storeAsType,
  };
}

function enrichContext(
  context: Record<string, string>,
  registry: NotificationRegistryEntry,
): Record<string, string> {
  const ctx = { ...context };
  if (ctx.reason !== undefined && ctx.reasonSuffix === undefined) {
    ctx.reasonSuffix = ctx.reason.trim() ? ` Reason: ${ctx.reason.trim()}` : '';
  }
  if (ctx.rejectionComment !== undefined && ctx.rejectionSuffix === undefined) {
    ctx.rejectionSuffix = ctx.rejectionComment.trim() ? `: ${ctx.rejectionComment.trim()}` : '';
  }
  if (ctx.guestCompany !== undefined && ctx.guestCompanyNote === undefined) {
    ctx.guestCompanyNote = ctx.guestCompany.trim() ? ` (${ctx.guestCompany.trim()})` : '';
  }
  if (ctx.meetingLinkNote === undefined && registry.eventKey.includes('meeting')) {
    ctx.meetingLinkNote = ctx.meetingLinkNote ?? '';
  }
  return ctx;
}

export async function filterEligibleRecipients(
  eventKey: string,
  subCompanyId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const registry = getRegistryEntry(eventKey);
  if (!registry) return [];

  const agencyRules = await loadAgencyRules(subCompanyId);
  const agencyRule = resolveAgencyRuleRow(agencyRules, eventKey);
  if (agencyRule?.enabled === false) return [];

  return userIds;
}

export async function getAgencyRule(
  subCompanyId: string,
  eventKey: string,
): Promise<AgencyRuleRow | undefined> {
  const rules = await loadAgencyRules(subCompanyId);
  return resolveAgencyRuleRow(rules, eventKey);
}

export type MergedNotificationRule = NotificationRegistryEntry & {
  enabled: boolean;
  titleTemplate: string | null;
  bodyTemplate: string | null;
  isCustomTitle: boolean;
  isCustomBody: boolean;
};

export async function listMergedAgencyRules(subCompanyId: string): Promise<MergedNotificationRule[]> {
  const agencyRules = await loadAgencyRules(subCompanyId);
  return listRegistryEntries().map((entry) => {
    const override = resolveAgencyRuleRow(agencyRules, entry.eventKey);
    const titleTemplate = override?.titleTemplate ?? null;
    const bodyTemplate = override?.bodyTemplate ?? null;
    return {
      ...entry,
      enabled: override?.enabled ?? entry.defaultEnabled,
      titleTemplate,
      bodyTemplate,
      isCustomTitle: !!titleTemplate?.trim(),
      isCustomBody: !!bodyTemplate?.trim(),
    };
  });
}

export async function upsertAgencyNotificationRules(
  subCompanyId: string,
  rules: Array<{
    eventKey: string;
    enabled?: boolean;
    titleTemplate?: string | null;
    bodyTemplate?: string | null;
  }>,
): Promise<void> {
  for (const rule of rules) {
    if (!getRegistryEntry(rule.eventKey)) {
      throw new Error(`Unknown notification event: ${rule.eventKey}`);
    }
    await prisma.agencyNotificationRule.upsert({
      where: {
        subCompanyId_eventKey: { subCompanyId, eventKey: rule.eventKey },
      },
      create: {
        subCompanyId,
        eventKey: rule.eventKey,
        enabled: rule.enabled ?? true,
        titleTemplate: rule.titleTemplate ?? null,
        bodyTemplate: rule.bodyTemplate ?? null,
      },
      update: {
        ...(rule.enabled !== undefined ? { enabled: rule.enabled } : {}),
        ...(rule.titleTemplate !== undefined ? { titleTemplate: rule.titleTemplate } : {}),
        ...(rule.bodyTemplate !== undefined ? { bodyTemplate: rule.bodyTemplate } : {}),
      },
    });
  }
  invalidateAgencyNotificationRulesCache(subCompanyId);
}

export function previewNotification(
  eventKey: string,
  context: Record<string, string>,
  titleTemplate?: string | null,
  bodyTemplate?: string | null,
): ResolvedNotification | null {
  const registry = getRegistryEntry(eventKey);
  if (!registry) return null;
  const titleTpl = titleTemplate?.trim() || registry.defaultTitle;
  const bodyTpl = bodyTemplate?.trim() || registry.defaultBody;
  const ctx = enrichContext(context, registry);
  return {
    title: renderNotificationTemplate(titleTpl, ctx),
    body: renderNotificationTemplate(bodyTpl, ctx),
    storeAsType: registry.storeAsType,
  };
}
