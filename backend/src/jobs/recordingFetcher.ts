/**
 * Post-call recording fetcher.
 * Polls Twilio REST API for a recording after a call ends, then downloads,
 * stores in R2, updates the DB, and emits a socket event.
 */
import prisma from '../config/database';
import { uploadToR2, buildAgencyR2Key } from '../services/r2Storage';
import { getAgencyTwilioCredentials } from '../services/agencyTwilioService';
import { emitToUsers } from '../socket';

const MAX_ATTEMPTS = 5;
const INITIAL_DELAY_MS = 60_000;
const RETRY_DELAY_MS = 30_000;

async function fetchRecordingForCall(
  callId: string,
  twilioCallSid: string,
  ownerId: string,
  subCompanyId: string,
  attempt: number
): Promise<void> {
  const creds = await getAgencyTwilioCredentials(subCompanyId);
  if (!creds) return;

  const { accountSid, authToken } = creds;

  try {
    const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings.json?CallSid=${encodeURIComponent(twilioCallSid)}`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const listRes = await fetch(listUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!listRes.ok) {
      console.error(`[recordingFetcher] Twilio list failed (attempt ${attempt}):`, listRes.status);
      scheduleRetry(callId, twilioCallSid, ownerId, subCompanyId, attempt);
      return;
    }

    type TwilioRecordingList = { recordings?: Array<{ sid: string; status: string; duration: string }> };
    const json = (await listRes.json()) as TwilioRecordingList;
    const completed = json.recordings?.find(r => r.status === 'completed');

    if (!completed) {
      console.log(`[recordingFetcher] No completed recording yet for ${twilioCallSid} (attempt ${attempt})`);
      scheduleRetry(callId, twilioCallSid, ownerId, subCompanyId, attempt);
      return;
    }

    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${completed.sid}.mp3`;
    const dlRes = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!dlRes.ok) {
      console.error(`[recordingFetcher] Download failed for ${completed.sid}:`, dlRes.status);
      scheduleRetry(callId, twilioCallSid, ownerId, subCompanyId, attempt);
      return;
    }

    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const key = buildAgencyR2Key(subCompanyId, 'recordings', twilioCallSid, `${completed.sid}.mp3`);
    const ourUrl = await uploadToR2(key, buffer, 'audio/mpeg');

    if (!ourUrl) {
      console.error(`[recordingFetcher] R2 upload failed for call ${callId}`);
      return;
    }

    await prisma.call.update({
      where: { id: callId },
      data: { recordingUrl: ourUrl, twilioCallSid },
    });

    emitToUsers([ownerId], 'call:refresh', { subCompanyId });
    console.log(`[recordingFetcher] Recording saved for call ${callId} (${completed.sid})`);
  } catch (err) {
    console.error(`[recordingFetcher] Error on attempt ${attempt} for call ${callId}:`, err);
    scheduleRetry(callId, twilioCallSid, ownerId, subCompanyId, attempt);
  }
}

function scheduleRetry(
  callId: string,
  twilioCallSid: string,
  ownerId: string,
  subCompanyId: string,
  attempt: number
): void {
  if (attempt >= MAX_ATTEMPTS) {
    console.warn(`[recordingFetcher] Giving up after ${MAX_ATTEMPTS} attempts for call ${callId}`);
    return;
  }
  setTimeout(
    () => fetchRecordingForCall(callId, twilioCallSid, ownerId, subCompanyId, attempt + 1),
    RETRY_DELAY_MS
  );
}

/** Schedule a recording fetch after call summary is saved. Non-blocking. */
export function scheduleRecordingFetch(
  callId: string,
  twilioCallSid: string,
  ownerId: string,
  subCompanyId: string
): void {
  console.log(`[recordingFetcher] Scheduled for call ${callId} (${twilioCallSid})`);
  setTimeout(
    () => fetchRecordingForCall(callId, twilioCallSid, ownerId, subCompanyId, 1),
    INITIAL_DELAY_MS
  );
}
