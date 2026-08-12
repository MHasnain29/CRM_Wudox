/**
 * Encrypt plaintext Google refresh tokens and Twilio secrets that were stored
 * before GOOGLE_TOKEN_ENCRYPTION_KEY was set. Idempotent — skips enc: values.
 *
 * Prerequisites: GOOGLE_TOKEN_ENCRYPTION_KEY in .env (64-char hex).
 *
 *   cd backend && npx tsx scripts/encrypt-stored-secrets.ts
 */
import '../src/loadEnv';
import prisma from '../src/config/database';
import { env } from '../src/config/env';
import { encryptSecret, hasEncryptionKey } from '../src/utils/secretsCrypto';

function isPlaintextSecret(value: string | null | undefined): value is string {
  return Boolean(value && !value.startsWith('enc:'));
}

async function main() {
  if (!hasEncryptionKey() || !env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    console.error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY is required (64-char hex). Generate with: openssl rand -hex 32',
    );
    process.exit(1);
  }

  let googleUpdated = 0;
  let twilioAuthUpdated = 0;
  let twilioApiUpdated = 0;

  const agencies = await prisma.subCompany.findMany({
    select: { id: true, name: true, googleRefreshToken: true },
  });

  for (const agency of agencies) {
    if (!isPlaintextSecret(agency.googleRefreshToken)) continue;
    await prisma.subCompany.update({
      where: { id: agency.id },
      data: { googleRefreshToken: encryptSecret(agency.googleRefreshToken) },
    });
    googleUpdated += 1;
    console.log('  Google token encrypted:', agency.name, `(${agency.id})`);
  }

  const phoneConfigs = await prisma.phoneAgencyConfig.findMany({
    select: {
      subCompanyId: true,
      twilioAuthTokenEnc: true,
      twilioApiKeySecretEnc: true,
    },
  });

  for (const row of phoneConfigs) {
    const data: { twilioAuthTokenEnc?: string; twilioApiKeySecretEnc?: string } = {};
    if (isPlaintextSecret(row.twilioAuthTokenEnc)) {
      data.twilioAuthTokenEnc = encryptSecret(row.twilioAuthTokenEnc);
      twilioAuthUpdated += 1;
    }
    if (isPlaintextSecret(row.twilioApiKeySecretEnc)) {
      data.twilioApiKeySecretEnc = encryptSecret(row.twilioApiKeySecretEnc);
      twilioApiUpdated += 1;
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.phoneAgencyConfig.update({
      where: { subCompanyId: row.subCompanyId },
      data,
    });
    console.log('  Twilio secrets encrypted for agency', row.subCompanyId);
  }

  console.log('\nDone.');
  console.log(`  Google refresh tokens encrypted: ${googleUpdated}`);
  console.log(`  Twilio auth tokens encrypted:    ${twilioAuthUpdated}`);
  console.log(`  Twilio API key secrets encrypted: ${twilioApiUpdated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
