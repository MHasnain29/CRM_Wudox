/**
 * Sync TWILIO_CALLER_ID from .env to the agency that has ring group members (for inbound DID match).
 * Run once: npx tsx scripts/sync-twilio-did.ts
 */
import '../src/loadEnv';
import prisma from '../src/config/database';
import { env } from '../src/config/env';
import { normalizeToE164, isValidE164 } from '../src/utils/phoneE164';

async function main() {
  const did = normalizeToE164(env.TWILIO_CALLER_ID);
  if (!did || !isValidE164(did)) {
    console.error('Set TWILIO_CALLER_ID in .env to your real Twilio number (E.164), e.g. +13653602614');
    process.exit(1);
  }

  const configs = await prisma.phoneAgencyConfig.findMany({
    select: { subCompanyId: true, ringGroups: true },
  });

  let targetId: string | null = null;
  let bestMembers = -1;
  for (const c of configs) {
    const rg = (Array.isArray(c.ringGroups) ? c.ringGroups : []) as Array<{ members?: unknown[] }>;
    const count = rg.reduce((sum, g) => sum + (g.members?.length ?? 0), 0);
    if (count > bestMembers) {
      bestMembers = count;
      targetId = c.subCompanyId;
    }
  }

  if (!targetId) {
    targetId = configs[0]?.subCompanyId ?? null;
  }
  if (!targetId) {
    console.error('No phone agency config found');
    process.exit(1);
  }

  const existing = await prisma.phoneNumber.findFirst({
    where: { subCompanyId: targetId },
    orderBy: { createdAt: 'asc' },
  });

  if (existing) {
    await prisma.phoneNumber.update({
      where: { id: existing.id },
      data: { e164: did, label: 'Main line', isActive: true },
    });
  } else {
    await prisma.phoneNumber.create({
      data: { subCompanyId: targetId, e164: did, label: 'Main line', isActive: true },
    });
  }

  await prisma.phoneAgencyConfig.update({
    where: { subCompanyId: targetId },
    data: { outboundCallerId: did, inboundEnabled: true, outboundEnabled: true },
  });

  await prisma.subCompany.update({
    where: { id: targetId },
    data: { agencyPhone: did },
  });

  console.log(`Synced DID ${did} to agency ${targetId} (${bestMembers} ring member(s))`);
  console.log('Twilio Console → this number → Voice webhook POST:');
  console.log(`  ${(env.PUBLIC_API_URL || env.APP_URL).replace(/\/$/, '')}/api/v1/voice/webhook/inbound`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
