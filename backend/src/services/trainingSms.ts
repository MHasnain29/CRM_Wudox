/**
 * Outbound SMS for assignment training notes (Twilio Messaging).
 * Uses agency phone-system credentials + an active agency DID as From.
 */
import prisma from '../config/database';
import { env } from '../config/env';
import { normalizeToE164, isValidE164 } from '../utils/phoneE164';
import {
  getAgencyTwilioCredentials,
  getTwilioRestClient,
  isAgencyTwilioConfigured,
} from './agencyTwilioService';

export async function sendTrainingSms(params: {
  subCompanyId: string;
  toPhone: string;
  body: string;
}): Promise<void> {
  const to = normalizeToE164(params.toPhone);
  if (!to || !isValidE164(to)) {
    throw Object.assign(new Error('Candidate phone number is invalid for SMS'), { status: 400 });
  }

  const fromRow = await prisma.phoneNumber.findFirst({
    where: { subCompanyId: params.subCompanyId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { e164: true },
  });
  if (!fromRow?.e164) {
    throw Object.assign(
      new Error('No active agency phone number configured for SMS. Add one in Phone System settings.'),
      { status: 400 },
    );
  }

  const creds = await getAgencyTwilioCredentials(params.subCompanyId);
  if (!isAgencyTwilioConfigured(creds) || !creds) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Training SMS would send to ${to} from ${fromRow.e164}: ${params.body}`);
      return;
    }
    throw Object.assign(
      new Error('Twilio is not configured for this agency. Cannot send SMS.'),
      { status: 502 },
    );
  }

  try {
    const client = getTwilioRestClient(creds);
    await client.messages.create({
      to,
      from: fromRow.e164,
      body: params.body,
    });
  } catch (err) {
    console.error('[trainingSms] Twilio messages.create failed', err);
    throw Object.assign(new Error('Failed to send training SMS. Try again.'), { status: 502 });
  }
}
