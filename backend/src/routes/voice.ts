import { Router, Request, Response } from 'express';
import { z } from 'zod';
import twilio from 'twilio';
import jwt from 'jsonwebtoken';
import { createVoiceTokenForAgency, ensureAgencyTwilioVoiceSigningCredentials } from '../services/twilioVoice';
import {
  buildInboundTwiML,
  handleInboundStatusCallback,
  buildQueueWaitTwiML,
  renderQueueAction,
  renderQueueConnect,
  renderQueueConnected,
} from '../services/twilioInboundTwiML';
import {
  getPresenceRow,
  computeEffectiveStatus,
  setManualPresence,
  markAgentOnCall,
  markAgentCallEnded,
  getAgentInboundCapacity,
} from '../services/agentPresence';
import { connectNextForAgent } from '../services/callQueue';
import { AgentPresenceStatus } from '@prisma/client';
import {
  getAgencyVoiceConfig,
  resolveAgencyOutboundCallerId,
  resolveOutboundCallFromWebhook,
} from '../services/phoneSystemService';
import { resolveWebhookAuthTokenCandidates, resolveTwilioRestAuth } from '../services/agencyTwilioService';
import { buildAgencyR2Key } from '../services/r2Storage';
import { pipeRecordingStream } from '../services/recordingStream';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { actAsMiddleware, effectiveActorId } from '../middleware/actAs';
import prisma from '../config/database';
import { env } from '../config/env';
import { CallOutcome } from '@prisma/client';
import { createActivityLog } from '../services/activityLog';
import { emitToUsers } from '../socket';
import { scheduleRecordingFetch } from '../jobs/recordingFetcher';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';
import { buildOwnerIdFilterForList } from '../services/listOwnerScope';
import { callsForClientDetail, resolveClientDetailScope } from '../services/clientAgencyAccess';
import { expandLinkedOwnerScope, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { invalidateClientListCache } from '../services/clientListCache';
import { placeEmployeeOutboundCall } from '../services/employeeVoiceCalls';
import {
  getIncomingContextForAgentCall,
  handleInboundAgentStatus,
  handleInboundConferenceStatus,
  handleOutboundConferenceCallback,
  handleOutboundPstnStatus,
  outboundConferenceRoomFor,
  resolveAgencyHoldMusicUrl,
  setCallerHold,
  setOutboundCalleeHold,
  storeOutboundConferenceMeta,
  buildHoldMusicTwiml,
  DEFAULT_HOLD_MUSIC_URL,
  terminateInboundConference,
  terminateOutboundConference,
} from '../services/conferenceBridge';

export const voiceRouter = Router();

/** Public origin (scheme + host) Twilio uses — must match Twilio Console webhook URL for signature validation. */
function publicApiOrigin(req: Request): string {
  const explicit = env.PUBLIC_API_URL?.replace(/\/$/, '').trim();
  if (explicit) return explicit;

  const xfProto = req.get('x-forwarded-proto');
  const xfHost = req.get('x-forwarded-host');
  const proto = (xfProto?.split(',')[0]?.trim() || req.protocol || 'http').replace(/:$/, '');
  const host = xfHost?.split(',')[0]?.trim() || req.get('host');
  if (host) {
    return `${proto}://${host}`;
  }
  return env.APP_URL.replace(/\/$/, '');
}

/** Full URL Twilio signed (same string Twilio used when posting). */
function publicWebhookUrl(req: Request): string {
  return `${publicApiOrigin(req)}${req.originalUrl}`;
}

const placeCallSchema = z.object({
  to: z.string().min(1, 'Missing "to" phone number'),
  clientId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  subCompanyId: z.string().uuid().optional(),
});

const placeEmployeeCallSchema = z.object({
  to: z.string().min(1, 'Missing "to" phone number'),
  employeeId: z.string().uuid(),
  subCompanyId: z.string().uuid().optional(),
});

/** Read Twilio webhook / Voice SDK custom params (multiple casings). */
function webhookParam(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Map Twilio CallStatus to our CallOutcome. Only called when status is final (completed, busy, no-answer, etc.). */
function twilioStatusToOutcome(status: string): CallOutcome {
  switch (status) {
    case 'completed':
      return CallOutcome.answered;
    case 'busy':
      return CallOutcome.busy;
    case 'no-answer':
      return CallOutcome.no_answer;
    case 'failed':
    case 'canceled':
    default:
      return CallOutcome.no_answer;
  }
}

/** Twilio plays a generic "application error" on any non-2xx Voice URL response — always return 200 + TwiML. */
function twimlSay(message: string): string {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<Response><Say>${safe}</Say></Response>`;
}

/** Candidate URLs Twilio may have signed (proxy / PUBLIC_API_URL mismatches). */
function webhookUrlCandidates(req: Request): string[] {
  const seen = new Set<string>();
  const add = (url: string) => {
    const trimmed = url.trim();
    if (trimmed) seen.add(trimmed);
  };

  add(publicWebhookUrl(req));

  const path = req.originalUrl || req.url || '';
  const explicit = env.PUBLIC_API_URL?.replace(/\/$/, '').trim();
  if (explicit) add(`${explicit}${path}`);

  const xfHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const xfProto = (req.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https').replace(/:$/, '');
  const host = xfHost || req.get('host');
  if (host) {
    add(`${xfProto}://${host}${path}`);
    if (xfProto !== 'https') add(`https://${host}${path}`);
  }

  const appUrl = env.APP_URL?.replace(/\/$/, '').trim();
  if (appUrl && !appUrl.includes('localhost')) add(`${appUrl}${path}`);

  return [...seen];
}

/** Validate Twilio webhook signature using per-agency or env auth token. */
async function validateTwilioWebhook(
  req: Request,
  body: Record<string, unknown>,
): Promise<boolean> {
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) return false;

  const tokens = await resolveWebhookAuthTokenCandidates(body);
  if (!tokens.length) return false;

  const urls = webhookUrlCandidates(req);
  for (const token of tokens) {
    for (const url of urls) {
      if (twilio.validateRequest(token, signature, url, req.body)) {
        return true;
      }
    }
  }

  console.warn(
    '[webhook] Invalid Twilio signature — tried',
    urls.length,
    'URL(s) and',
    tokens.length,
    'token(s). First URL:',
    urls[0],
  );
  return false;
}

// Webhook: TwiML voice URL — Twilio calls this when the browser Voice SDK connects (outgoing or TwiML app).
// Returns TwiML that bridges the agent WebRTC leg to the PSTN destination.
voiceRouter.post('/webhook/twiml', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const from = String(body.From ?? '');
    const direction = String(body.Direction ?? '');

    // PSTN inbound hits here when the DID still has voiceApplicationSid — Twilio uses the TwiML App URL instead of voiceUrl.
    if (direction === 'inbound' && !from.startsWith('client:')) {
      const startedAt = Date.now();
      console.warn(
        '[webhook/twiml] PSTN inbound misrouted to outbound TwiML URL — running IVR. Run npm run tunnel:sync to clear voiceApplicationSid on the DID.',
      );
      const { twiml, outcome } = await buildInboundTwiML(
        body,
        inboundWebhookBase(req),
        inboundWebhookQuery(req),
      );
      console.log(`[webhook/twiml→inbound] ${outcome} ${Date.now() - startedAt}ms`);
      return res.type('text/xml').send(twiml);
    }

    console.log('[webhook/twiml] Hit! Body:', JSON.stringify(req.body));
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature) {
      const ok = await validateTwilioWebhook(req, req.body as Record<string, unknown>);
      if (!ok) {
        const urlUsed = publicWebhookUrl(req);
        console.warn(
          '[webhook/twiml] Invalid Twilio signature. Twilio signed URL must match this server. tried=',
          urlUsed,
          '| Set PUBLIC_API_URL to your HTTPS API origin (same as Twilio webhook), or TRUST_PROXY=true with X-Forwarded-Proto/Host behind nginx.'
        );
        return res.type('text/xml').send(twimlSay('Call setup failed. Please contact your administrator.'));
      }
    }

    const toRaw = webhookParam(
      req.body as Record<string, unknown>,
      'To',
      'to',
      'PhoneNumber',
      'phoneNumber',
      'Called',
    );
    if (!toRaw) {
      const conferenceRoom = webhookParam(
        req.body as Record<string, unknown>,
        'ConferenceRoom',
        'conferenceRoom',
      );
      if (conferenceRoom) {
        const twiml = `<Response><Dial><Conference waitUrl="" startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${escapeXml(conferenceRoom)}</Conference></Dial></Response>`;
        console.log('[webhook/twiml] Joining conference:', conferenceRoom);
        return res.type('text/xml').send(twiml);
      }
      return res.type('text/xml').send(twimlSay('No destination number provided.'));
    }

    const conferenceRoom = webhookParam(
      req.body as Record<string, unknown>,
      'ConferenceRoom',
      'conferenceRoom',
    );
    if (conferenceRoom) {
      const { callRecordId } = await resolveOutboundCallFromWebhook(
        req.body as Record<string, unknown>,
      );
      const toNumber = toRaw.replace(/[^+0-9]/g, '');
      const parentSid = req.body?.CallSid;
      const prefix = env.API_PREFIX.replace(/^\//, '');
      const base = `${publicApiOrigin(req)}/${prefix}/${env.API_VERSION}/voice/webhook`;

      if (callRecordId && parentSid && typeof parentSid === 'string') {
        await storeOutboundConferenceMeta(callRecordId, {
          twilioCallSid: parentSid,
          conferenceRoom,
        });
      }

      const confQs = new URLSearchParams();
      if (callRecordId) confQs.set('callRecordId', callRecordId);
      if (toNumber) confQs.set('toNumber', toNumber);
      const confStatusUrl = `${base}/outbound/conference?${confQs.toString()}`;

      const twiml =
        `<Response><Dial><Conference waitUrl="" startConferenceOnEnter="true" endConferenceOnExit="false" beep="false" ` +
        `statusCallback="${escapeXml(confStatusUrl)}" statusCallbackEvent="start end join leave" statusCallbackMethod="POST">` +
        `${escapeXml(conferenceRoom)}</Conference></Dial></Response>`;
      console.log('[webhook/twiml] Outbound conference join:', conferenceRoom, callRecordId ?? '');
      return res.type('text/xml').send(twiml);
    }

    const safeNumber = toRaw.replace(/[^+0-9]/g, '');

    const { callRecordId, subCompanyId } = await resolveOutboundCallFromWebhook(
      req.body as Record<string, unknown>,
    );

    if (!subCompanyId) {
      console.warn(
        '[webhook/twiml] Cannot resolve agency — body:',
        JSON.stringify(req.body ?? {}),
      );
      return res
        .type('text/xml')
        .send(
          twimlSay(
            'Could not determine agency for this call. Place the call again from the app, or set the agency number in Settings, Phone System, Number.',
          ),
        );
    }

    const twilioCallerId = await resolveAgencyOutboundCallerId(subCompanyId);
    if (!twilioCallerId) {
      return res
        .type('text/xml')
        .send(twimlSay('Agency phone number not configured. Set it in Settings, Phone System, Number.'));
    }

    const prefix = env.API_PREFIX.replace(/^\//, '');
    const base = `${publicApiOrigin(req)}/${prefix}/${env.API_VERSION}/voice/webhook`;
    const qs = callRecordId ? `?callRecordId=${encodeURIComponent(callRecordId)}` : '';
    const statusUrl = `${base}/status${qs}`;
    const recordingUrl = `${base}/recording${qs}`;

    const parentSid = req.body?.CallSid;
    const twiml = `<Response><Dial callerId="${twilioCallerId}" record="record-from-answer" recordingStatusCallback="${recordingUrl}" recordingStatusCallbackEvent="completed"><Number statusCallback="${statusUrl}" statusCallbackEvent="completed">${safeNumber}</Number></Dial></Response>`;
    console.log('[webhook/twiml] Dialing:', safeNumber, callRecordId ? `(callRecord ${callRecordId})` : '(no callRecordId)');
    console.log('[webhook/twiml] recordingStatusCallback:', recordingUrl);
    console.log('[webhook/twiml] statusCallback:', statusUrl);
    if (callRecordId && parentSid && typeof parentSid === 'string') {
      try {
        await prisma.call.update({
          where: { id: callRecordId },
          data: { twilioCallSid: parentSid },
        });
      } catch (e) {
        console.error('[webhook/twiml] Failed to link CallSid to call record:', e);
      }
    }

    return res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[webhook/twiml] Unhandled error:', err);
    return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
  }
});

function inboundWebhookBase(req: Request): string {
  const prefix = env.API_PREFIX.replace(/^\//, '');
  return `${publicApiOrigin(req)}/${prefix}/${env.API_VERSION}/voice/webhook`;
}

function inboundWebhookQuery(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      out[key] = value[0];
    }
  }
  return out;
}

// Webhook: Twilio inbound PSTN — agency DID → published call flow
voiceRouter.post('/webhook/inbound', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature) {
      const ok = await validateTwilioWebhook(req, req.body as Record<string, unknown>);
      if (!ok) {
        const ms = Date.now() - startedAt;
        console.warn(
          `[webhook/inbound] REJECT signature ${ms}ms tried=`,
          publicWebhookUrl(req),
          '| Set PUBLIC_API_URL to your HTTPS API origin (same as Twilio webhook), or run npm run tunnel:sync after ngrok restarts.',
        );
        return res.type('text/xml').send(twimlSay('Call setup failed. Please contact your administrator.'));
      }
    }

    const body = req.body as Record<string, string | undefined>;
    const { twiml, status, outcome } = await buildInboundTwiML(
      body,
      inboundWebhookBase(req),
      inboundWebhookQuery(req),
    );
    const ms = Date.now() - startedAt;
    console.log(
      `[webhook/inbound] ${outcome} ${ms}ms`,
      'From:', body.From,
      'To:', body.To ?? body.Called,
      'Digits:', body.Digits ?? '(none)',
      'DialCallStatus:', body.DialCallStatus ?? '(none)',
    );
    if (status >= 400) {
      console.warn('[webhook/inbound] flow issue (HTTP', status, '):', twiml.slice(0, 200));
    }
    // Twilio Voice requires HTTP 200 to execute TwiML — log status but always return 200.
    return res.type('text/xml').send(twiml);
  } catch (err) {
    const ms = Date.now() - startedAt;
    console.error(`[webhook/inbound] ERROR ${ms}ms`, err);
    return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
  }
});

voiceRouter.post('/webhook/inbound/status', async (req: Request, res: Response) => {
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature || !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
    console.warn('[webhook/inbound/status] Invalid Twilio signature — returning empty 200');
    return res.status(200).end();
  }
  const body = req.body as Record<string, string | undefined>;
  const inboundCallId = typeof req.query.inboundCallId === 'string' ? req.query.inboundCallId : undefined;

  // Legacy Dial action URLs pointed here — continue the IVR instead of hanging up on empty 200.
  if (body.DialCallStatus) {
    try {
      const { twiml } = await buildInboundTwiML(
        body,
        inboundWebhookBase(req),
        inboundWebhookQuery(req),
      );
      return res.type('text/xml').send(twiml);
    } catch (err) {
      console.error('[webhook/inbound/status] Dial action error:', err);
      return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
    }
  }

  await handleInboundStatusCallback(body, inboundCallId);
  return res.status(200).end();
});

voiceRouter.post('/webhook/inbound/recording', async (req: Request, res: Response) => {
  const body = req.body as Record<string, string | undefined>;
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature || !(await validateTwilioWebhook(req, body as Record<string, unknown>))) {
    return res.status(403).send('Forbidden');
  }

  const inboundCallId = typeof req.query.inboundCallId === 'string' ? req.query.inboundCallId : undefined;
  const recordingUrlFromTwilio = req.body?.RecordingUrl;
  const recordingStatus = req.body?.RecordingStatus;
  if (recordingStatus !== 'completed' || !recordingUrlFromTwilio || !inboundCallId) {
    return res.status(200).end();
  }

  const inboundCall = await prisma.inboundCall.findUnique({
    where: { id: inboundCallId },
    select: { subCompanyId: true },
  });
  const restAuth = await resolveTwilioRestAuth(body as Record<string, unknown>, inboundCall?.subCompanyId);
  if (!restAuth) return res.status(401).send('Unauthorized');

  const { uploadToR2 } = await import('../services/r2Storage');
  const mediaUrl = String(recordingUrlFromTwilio).endsWith('.mp3')
    ? recordingUrlFromTwilio
    : `${String(recordingUrlFromTwilio).replace(/\.json$/i, '')}.mp3`;
  const auth = Buffer.from(`${restAuth.accountSid}:${restAuth.authToken}`).toString('base64');
  try {
    const fetchRes = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!fetchRes.ok) return res.status(502).end();
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    const key = inboundCall?.subCompanyId
      ? buildAgencyR2Key(
          inboundCall.subCompanyId,
          'recordings',
          'inbound',
          inboundCallId,
          `${req.body?.RecordingSid ?? 'rec'}.mp3`,
        )
      : `recordings/inbound/${inboundCallId}/${req.body?.RecordingSid ?? 'rec'}.mp3`;
    const ourUrl = await uploadToR2(key, buffer, 'audio/mpeg');
    if (ourUrl) {
      await prisma.inboundCall.update({
        where: { id: inboundCallId },
        data: { recordingUrl: ourUrl, outcome: 'voicemail' },
      }).catch((e) => console.error('[webhook/inbound/recording] DB update failed:', e));
    }
  } catch (err) {
    console.error('[webhook/inbound/recording]', err);
    return res.status(500).end();
  }
  return res.status(200).end();
});

// Webhook: queue hold experience (Twilio <Enqueue waitUrl>). Loops with hold music /
// position and returns <Leave/> once max wait is exceeded.
voiceRouter.post('/webhook/queue/wait', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const maxWaitSec = Number(req.query.maxWaitSec) || 120;
    const musicUrl = typeof req.query.music === 'string' ? req.query.music : '';
    const queueTime = Number(body.QueueTime ?? '0') || 0;
    const position = typeof body.QueuePosition === 'string' ? body.QueuePosition : undefined;
    const twiml = buildQueueWaitTwiML({ maxWaitSec, musicUrl, queueTime, position });
    return res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[webhook/queue/wait] error:', err);
    return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
  }
});

// Webhook: <Enqueue> action — caller left the queue (max wait / hangup / bridged).
voiceRouter.post('/webhook/queue/action', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const entryId = typeof req.query.entryId === 'string' ? req.query.entryId : '';
    const twiml = await renderQueueAction(entryId, body, inboundWebhookBase(req));
    return res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[webhook/queue/action] error:', err);
    return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
  }
});

// Webhook: connect a waiting caller to a chosen agent (target of the REST redirect).
voiceRouter.post('/webhook/queue/connect', async (req: Request, res: Response) => {
  try {
    const entryId = typeof req.query.entryId === 'string' ? req.query.entryId : '';
    const agentIdentity = typeof req.query.agent === 'string' ? req.query.agent : '';
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    const twiml = await renderQueueConnect({
      entryId,
      agentIdentity,
      userId,
      webhookBase: inboundWebhookBase(req),
    });
    return res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[webhook/queue/connect] error:', err);
    return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
  }
});

// Webhook: dial action after connecting a queued caller (success → connected; else re-queue).
voiceRouter.post('/webhook/queue/connected', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const entryId = typeof req.query.entryId === 'string' ? req.query.entryId : '';
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    const twiml = await renderQueueConnected({
      entryId,
      userId,
      body,
      webhookBase: inboundWebhookBase(req),
    });
    return res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[webhook/queue/connected] error:', err);
    return res.type('text/xml').send(twimlSay('An error occurred. Please try again later.'));
  }
});

// Conference bridge webhooks (Twilio statusCallback).
voiceRouter.get('/webhook/hold-music', async (req: Request, res: Response) => {
  try {
    const subCompanyId = String(req.query.subCompanyId ?? '').trim();
    const musicUrl = subCompanyId
      ? await resolveAgencyHoldMusicUrl(subCompanyId)
      : DEFAULT_HOLD_MUSIC_URL;
    return res.type('text/xml').send(buildHoldMusicTwiml(musicUrl));
  } catch (err) {
    console.error('[webhook/hold-music] error:', err);
    return res.type('text/xml').send(buildHoldMusicTwiml(DEFAULT_HOLD_MUSIC_URL));
  }
});

voiceRouter.post('/webhook/inbound/conference', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature && !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
      return res.status(403).end();
    }
    const inboundCallId = String(req.query.inboundCallId ?? '');
    if (!inboundCallId) return res.status(200).end();
    await handleInboundConferenceStatus({
      inboundCallId,
      body: req.body as Record<string, string | undefined>,
    });
    return res.status(200).end();
  } catch (err) {
    console.error('[webhook/inbound/conference] error:', err);
    return res.status(200).end();
  }
});

voiceRouter.post('/webhook/inbound/agent-status', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature && !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
      return res.status(403).end();
    }
    const inboundCallId = String(req.query.inboundCallId ?? '');
    const userId = String(req.query.userId ?? '');
    const callSid = String(req.body?.CallSid ?? '');
    const callStatus = String(req.body?.CallStatus ?? '');
    if (!inboundCallId || !userId || !callSid) return res.status(200).end();
    await handleInboundAgentStatus({
      inboundCallId,
      userId,
      callSid,
      callStatus,
      conferenceSid: req.body?.ConferenceSid as string | undefined,
      webhookBase: inboundWebhookBase(req),
    });
    return res.status(200).end();
  } catch (err) {
    console.error('[webhook/inbound/agent-status] error:', err);
    return res.status(200).end();
  }
});

voiceRouter.post('/webhook/inbound/after-conference', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature && !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
      console.warn('[webhook/inbound/after-conference] Invalid Twilio signature — returning empty 200');
      return res.type('text/xml').send('<Response></Response>');
    }
    return res.type('text/xml').send('<Response></Response>');
  } catch (err) {
    console.error('[webhook/inbound/after-conference] error:', err);
    return res.type('text/xml').send('<Response></Response>');
  }
});

voiceRouter.post('/webhook/outbound/conference', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature && !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
      return res.status(403).end();
    }
    const callRecordId = String(req.query.callRecordId ?? '');
    const toNumber = String(req.query.toNumber ?? '');
    if (!callRecordId) return res.status(200).end();
    await handleOutboundConferenceCallback({
      callRecordId,
      toNumber,
      webhookBase: inboundWebhookBase(req),
      body: req.body as Record<string, string | undefined>,
    });
    return res.status(200).end();
  } catch (err) {
    console.error('[webhook/outbound/conference] error:', err);
    return res.status(200).end();
  }
});

voiceRouter.post('/webhook/outbound/pstn-status', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (signature && !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
      return res.status(403).end();
    }
    const callRecordId = String(req.query.callRecordId ?? '');
    const callSid = String(req.body?.CallSid ?? '');
    const callStatus = String(req.body?.CallStatus ?? '');
    if (!callRecordId || !callSid) return res.status(200).end();
    await handleOutboundPstnStatus({ callRecordId, callSid, callStatus });
    return res.status(200).end();
  } catch (err) {
    console.error('[webhook/outbound/pstn-status] error:', err);
    return res.status(200).end();
  }
});

// Webhook: Twilio status callback (no auth; validated by Twilio signature)
voiceRouter.post('/webhook/status', async (req: Request, res: Response) => {
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature || !(await validateTwilioWebhook(req, req.body as Record<string, unknown>))) {
    return res.status(403).send('Forbidden');
  }
  const callSid = req.body?.CallSid;
  const callStatus = req.body?.CallStatus;
  const callDuration = req.body?.CallDuration;
  if (!callSid) {
    return res.status(400).send('Missing CallSid');
  }
  const durationSeconds = callDuration ? parseInt(String(callDuration), 10) : null;
  const outcome = callStatus ? twilioStatusToOutcome(String(callStatus)) : CallOutcome.no_answer;
  const callRecordParsed = z.string().uuid().safeParse(req.query.callRecordId);

  try {
    if (callRecordParsed.success) {
      await prisma.call.updateMany({
        where: { id: callRecordParsed.data },
        data: {
          outcome,
          ...(durationSeconds !== null && !Number.isNaN(durationSeconds) && { duration: durationSeconds }),
        },
      });
    } else {
      await prisma.call.updateMany({
        where: { twilioCallSid: callSid },
        data: {
          outcome,
          ...(durationSeconds !== null && !Number.isNaN(durationSeconds) && { duration: durationSeconds }),
        },
      });
    }
    return res.status(200).end();
  } catch (err) {
    console.error('Voice webhook update failed:', err);
    return res.status(500).end();
  }
});

// Webhook: Twilio recording ready — download, store in R2, update Call.recording_url
voiceRouter.post('/webhook/recording', async (req: Request, res: Response) => {
  const body = req.body as Record<string, string | undefined>;
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature || !(await validateTwilioWebhook(req, body as Record<string, unknown>))) {
    return res.status(403).send('Forbidden');
  }
  const callSid = req.body?.CallSid;
  const recordingSid = req.body?.RecordingSid;
  const recordingUrlFromTwilio = req.body?.RecordingUrl;
  const recordingStatus = req.body?.RecordingStatus;
  const callRecordParsed = z.string().uuid().safeParse(req.query.callRecordId);
  console.log('[webhook/recording] callSid:', callSid, '| recordingSid:', recordingSid, '| status:', recordingStatus, '| callRecordId:', req.query.callRecordId ?? '(none)');
  if (!callSid || !recordingSid || recordingStatus !== 'completed') {
    return res.status(200).end();
  }
  if (!recordingUrlFromTwilio || typeof recordingUrlFromTwilio !== 'string') {
    return res.status(400).send('Missing RecordingUrl');
  }

  let subCompanyId: string | null = null;
  if (callRecordParsed.success) {
    const row = await prisma.call.findUnique({
      where: { id: callRecordParsed.data },
      select: { subCompanyId: true },
    });
    subCompanyId = row?.subCompanyId ?? null;
  } else {
    const byCallSid = await prisma.call.findFirst({
      where: { twilioCallSid: callSid },
      select: { subCompanyId: true },
    });
    subCompanyId = byCallSid?.subCompanyId ?? null;
  }

  const restAuth = await resolveTwilioRestAuth(body as Record<string, unknown>, subCompanyId);
  if (!restAuth) return res.status(401).send('Unauthorized');

  const { uploadToR2 } = await import('../services/r2Storage');
  const mediaUrl = recordingUrlFromTwilio.endsWith('.mp3')
    ? recordingUrlFromTwilio
    : `${recordingUrlFromTwilio.replace(/\.json$/i, '')}.mp3`;
  const auth = Buffer.from(`${restAuth.accountSid}:${restAuth.authToken}`).toString('base64');
  try {
    const fetchRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!fetchRes.ok) {
      console.error('Twilio recording fetch failed:', fetchRes.status, await fetchRes.text());
      return res.status(502).send('Failed to fetch recording');
    }
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    const key = subCompanyId
      ? buildAgencyR2Key(subCompanyId, 'recordings', callSid, `${recordingSid}.mp3`)
      : `recordings/${callSid}/${recordingSid}.mp3`;
    const ourUrl = await uploadToR2(key, buffer, 'audio/mpeg');
    console.log('[webhook/recording] uploaded to R2:', ourUrl);
    if (ourUrl) {
      try {
        // First try by callRecordId (query param), then by twilioCallSid, then by recent call matching this callSid
        let updated: { ownerId: string; subCompanyId: string } | null = null;
        if (callRecordParsed.success) {
          updated = await prisma.call.update({
            where: { id: callRecordParsed.data },
            data: { recordingUrl: ourUrl, twilioCallSid: callSid },
            select: { ownerId: true, subCompanyId: true },
          });
          console.log('[webhook/recording] updated by callRecordId:', callRecordParsed.data);
        } else {
          // Fallback: find call by twilioCallSid
          const byCallSid = await prisma.call.findFirst({ where: { twilioCallSid: callSid }, select: { id: true, ownerId: true, subCompanyId: true } });
          if (byCallSid) {
            await prisma.call.update({ where: { id: byCallSid.id }, data: { recordingUrl: ourUrl }, select: { ownerId: true, subCompanyId: true } });
            updated = byCallSid;
            console.log('[webhook/recording] updated by twilioCallSid:', callSid);
          } else {
            console.error('[webhook/recording] no call found for callSid:', callSid, '— recording saved to R2 but DB not updated. Key:', key);
          }
        }
        if (updated) emitToUsers([updated.ownerId], 'call:refresh', { subCompanyId: updated.subCompanyId });
      } catch (e) {
        console.error('[webhook/recording] DB update failed:', e);
      }
    }
  } catch (err) {
    console.error('Recording webhook failed:', err);
    return res.status(500).end();
  }
  return res.status(200).end();
});

/** GET /voice/calls/:id/recording — stream recording audio via short-lived stream token (no session auth). */
voiceRouter.get('/calls/:id/recording', async (req: Request, res: Response) => {
  const token = req.query.t as string | undefined;
  if (!token) return res.status(401).json({ error: 'Missing stream token' });

  let payload: { callId: string; subCompanyId: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as typeof payload;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired stream token' });
  }

  if (payload.callId !== req.params.id) {
    return res.status(403).json({ error: 'Token does not match call' });
  }

  const call = await prisma.call.findFirst({
    where: { id: payload.callId, subCompanyId: payload.subCompanyId },
    select: { recordingUrl: true },
  });

  if (!call?.recordingUrl) return res.status(404).json({ error: 'Recording not found' });

  await pipeRecordingStream(call.recordingUrl, req, res);
  return;
});

voiceRouter.use(authenticate);

const callsRead = requirePermission('calls:read', 'voice:use');
const callsWrite = requirePermission('calls:write', 'voice:use');
const voiceUse = requirePermission('voice:use');

async function resolveAllowedVoiceAgencyIds(req: Request): Promise<string[] | null> {
  const scope = await resolveListAgencyScope(req);
  return scope?.allowedIds ?? null;
}

voiceRouter.get('/token', voiceUse, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const user = req.user;
  if (!user?.sub || !user?.email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await ensureAgencyTwilioVoiceSigningCredentials(subCompanyId);
    const token = await createVoiceTokenForAgency(subCompanyId, user.sub, user.email);
    return res.json({ token, subCompanyId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create voice token';
    console.error('[voice/token]', message);
    const misconfig =
      message.includes('Twilio') ||
      message.includes('TWILIO') ||
      message.includes('credentials') ||
      message.includes('API key') ||
      message.includes('not configured');
    return res.status(misconfig ? 503 : 500).json({
      error: misconfig ? 'Twilio Voice misconfigured' : 'Failed to create voice token',
      message,
    });
  }
});

const presenceSchema = z.object({
  status: z.enum(['available', 'busy', 'away', 'offline']).nullable(),
});

/** GET /voice/presence/me — current agent availability. */
voiceRouter.get('/presence/me', voiceUse, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });
  const row = await getPresenceRow(userId);
  const capacity = await getAgentInboundCapacity(userId);
  return res.json({
    manualStatus: row?.manualStatus ?? null,
    effective: computeEffectiveStatus(row),
    activeCallCount: row?.activeCallCount ?? 0,
    ringingLegs: capacity.ringingLegs,
    joinedLegs: capacity.joinedLegs,
    canAcceptRing: capacity.canAcceptRing,
    canPickupFromQueue: capacity.canPickupFromQueue,
  });
});

/** PUT /voice/presence/me — agent sets Available / Busy / Away / Offline (null = auto). */
voiceRouter.put('/presence/me', voiceUse, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });
  const parsed = presenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const subCompanyId = await resolveAgencyScope(req);
  const manualStatus = parsed.data.status
    ? (parsed.data.status as AgentPresenceStatus)
    : null;
  const result = await setManualPresence(userId, subCompanyId ?? null, manualStatus);
  return res.json(result);
});

/** POST /voice/presence/call-started — softphone signals the agent is now on a call. */
voiceRouter.post('/presence/call-started', voiceUse, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });
  const subCompanyId = await resolveAgencyScope(req);
  await markAgentOnCall(userId, subCompanyId ?? null);
  return res.json({ ok: true });
});

/** POST /voice/presence/call-ended — softphone signals a call ended; auto-dequeues next caller. */
voiceRouter.post('/presence/call-ended', voiceUse, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });
  const { nowAvailable } = await markAgentCallEnded(userId);
  // Auto-dequeue only when the agent is fully idle (activeCallCount → 0), not while on one call.
  if (nowAvailable) {
    const subCompanyId = await resolveAgencyScope(req);
    void connectNextForAgent(userId, subCompanyId ?? null).catch((err) =>
      console.error('[presence/call-ended] auto-dequeue failed:', err),
    );
  }
  return res.json({ ok: true, nowAvailable });
});

voiceRouter.post('/call', voiceUse, async (req: Request, res: Response) => {
  const parsed = placeCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }
  const { to, clientId, leadId, subCompanyId: bodySubCompanyId } = parsed.data;
  const normalized = to.replace(/\D/g, '');
  if (normalized.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  const userId = effectiveActorId(req);
  let subCompanyId = await resolveAgencyScope(req);
  if (bodySubCompanyId) {
    const allowedIds = await resolveListAgencyScope(req);
    if (allowedIds?.allowedIds.includes(bodySubCompanyId)) {
      subCompanyId = bodySubCompanyId;
    }
  }
  if (!userId || !subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, clientId, subCompanyId },
      select: { id: true },
    });
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found or not in your agency' });
    }
  }

  const agencyVoice = await getAgencyVoiceConfig(subCompanyId);
  if (!agencyVoice.outboundEnabled) {
    return res.status(403).json({
      error: 'Outbound calling disabled',
      message: 'Enable outbound calling in Settings → Phone System → Number.',
    });
  }
  if (!agencyVoice.outboundCallerId) {
    return res.status(503).json({
      error: 'Agency phone number not configured',
      message: 'Set your agency number in Settings → Phone System → Number.',
    });
  }

  try {
    const [owner] = await prisma.user.findMany({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const userName = owner ? `${owner.firstName} ${owner.lastName}`.trim() || 'Unknown' : 'Unknown';

    const callRecord = await prisma.call.create({
      data: {
        clientId,
        leadId: leadId ?? null,
        subCompanyId,
        ownerId: userId,
        outcome: CallOutcome.initiated,
      },
    });

    await prisma.call.update({
      where: { id: callRecord.id },
      data: { conferenceRoom: outboundConferenceRoomFor(callRecord.id) },
    });

    await prisma.activityLog.create({
      data: {
        type: 'call',
        userId,
        userName,
        subCompanyId,
        description: 'Outbound call placed to client',
        metadata: { callId: callRecord.id, clientId, leadId: leadId ?? null, outcome: 'initiated' },
      },
    });

    emitToUsers([req.user!.sub], 'call:refresh', { subCompanyId });
    await invalidateClientListCache(subCompanyId);
    emitToUsers([req.user!.sub], 'client:refresh', { subCompanyId });

    return res.json({
      callId: callRecord.id,
      message: 'Call record created — connect from the app to join audio',
    });
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.message.includes('not configured')) {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to create call' });
  }
});

/** POST /voice/call/employee — place outbound call linked to an Employee. */
voiceRouter.post('/call/employee', voiceUse, async (req: Request, res: Response) => {
  const parsed = placeEmployeeCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }
  const { to, employeeId, subCompanyId: bodySubCompanyId } = parsed.data;

  const userId = effectiveActorId(req);
  let subCompanyId = await resolveAgencyScope(req);
  if (bodySubCompanyId) {
    const allowedIds = await resolveListAgencyScope(req);
    if (allowedIds?.allowedIds.includes(bodySubCompanyId)) {
      subCompanyId = bodySubCompanyId;
    }
  }
  if (!userId || !subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const [owner] = await prisma.user.findMany({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  const userName = owner ? `${owner.firstName} ${owner.lastName}`.trim() || 'Unknown' : 'Unknown';

  try {
    const result = await placeEmployeeOutboundCall({
      to,
      employeeId,
      subCompanyId,
      ownerId: userId,
      ownerName: userName,
    });
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        ...(result.message ? { message: result.message } : {}),
      });
    }

    emitToUsers([req.user!.sub], 'call:refresh', { subCompanyId });

    return res.json({
      callId: result.callId,
      message: 'Call record created — connect from the app to join audio',
    });
  } catch (err) {
    console.error(err);
    if (err instanceof Error && err.message.includes('not configured')) {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to create call' });
  }
});

voiceRouter.get('/config', voiceUse, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const config = await getAgencyVoiceConfig(subCompanyId);
  return res.json(config);
});

const holdBodySchema = z.object({ hold: z.boolean() });

voiceRouter.get('/inbound/incoming-context', voiceUse, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const agentCallSid = String(req.query.agentCallSid ?? '').trim();
  if (!agentCallSid) {
    return res.status(400).json({ error: 'agentCallSid required' });
  }
  const ctx = await getIncomingContextForAgentCall(agentCallSid, userId);
  if (!ctx) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.json({ data: ctx });
});

voiceRouter.post('/inbound/:inboundCallId/hold', voiceUse, async (req: Request, res: Response) => {
  const parsed = holdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const inbound = await prisma.inboundCall.findFirst({
    where: { id: req.params.inboundCallId, subCompanyId },
    select: { id: true },
  });
  if (!inbound) {
    return res.status(404).json({ error: 'Inbound call not found' });
  }
  const holdMusicUrl = await resolveAgencyHoldMusicUrl(subCompanyId);
  const result = await setCallerHold(req.params.inboundCallId, parsed.data.hold, holdMusicUrl);
  if (!result.ok) {
    return res.status(422).json({ error: 'Hold update failed', reason: result.reason });
  }
  return res.json({ ok: true });
});

voiceRouter.post('/call/:callRecordId/hold', voiceUse, async (req: Request, res: Response) => {
  const parsed = holdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }
  const subCompanyId = await resolveAgencyScope(req);
  const userId = req.user?.sub;
  if (!subCompanyId || !userId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const call = await prisma.call.findFirst({
    where: { id: req.params.callRecordId, subCompanyId, ownerId: userId },
    select: { id: true },
  });
  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }
  const holdMusicUrl = await resolveAgencyHoldMusicUrl(subCompanyId);
  const result = await setOutboundCalleeHold(req.params.callRecordId, parsed.data.hold, holdMusicUrl);
  if (!result.ok) {
    return res.status(422).json({ error: 'Hold update failed', reason: result.reason });
  }
  return res.json({ ok: true });
});

voiceRouter.post('/inbound/:inboundCallId/end', voiceUse, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const inbound = await prisma.inboundCall.findFirst({
    where: { id: req.params.inboundCallId, subCompanyId },
    select: { id: true },
  });
  if (!inbound) {
    return res.status(404).json({ error: 'Inbound call not found' });
  }
  await terminateInboundConference(req.params.inboundCallId);
  return res.json({ ok: true });
});

voiceRouter.post('/call/:callRecordId/end', voiceUse, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  const userId = req.user?.sub;
  if (!subCompanyId || !userId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const call = await prisma.call.findFirst({
    where: { id: req.params.callRecordId, subCompanyId, ownerId: userId },
    select: { id: true },
  });
  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }
  await terminateOutboundConference(req.params.callRecordId);
  return res.json({ ok: true });
});

const listCallsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(50),
  scope: z.enum(['mine', 'all']).default('mine'),
  clientId: z.string().uuid().optional(),
  agencyIds: z.string().optional(), // multi-select: comma-separated UUIDs
  ownerIds: z.string().optional(),  // multi-user filter: comma-separated UUIDs
  from: z.string().optional(),      // ISO date string — filter calls on or after this timestamp
  to: z.string().optional(),        // ISO date string — filter calls on or before this timestamp
});

/** GET /voice/calls — list calls. Elevated roles see across all agencies with optional agencyIds filter. */
voiceRouter.get('/calls', callsRead, actAsMiddleware, async (req: Request, res: Response) => {
  const userId = effectiveActorId(req);
  if (!userId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const parsed = listCallsQuerySchema.safeParse(req.query);
  const { page, limit, scope, clientId, agencyIds: agencyIdsRaw, ownerIds: ownerIdsRaw, from, to } = parsed.success
    ? parsed.data
    : {
        page: 1,
        limit: 50,
        scope: (req.query.scope === 'all' ? 'all' : 'mine') as 'mine' | 'all',
        clientId: undefined,
        agencyIds: typeof req.query.agencyIds === 'string' ? req.query.agencyIds : undefined,
        ownerIds: typeof req.query.ownerIds === 'string' ? req.query.ownerIds : undefined,
        from: undefined,
        to: undefined,
      };

  const agencyScope = await resolveListAgencyScope(req, agencyIdsRaw);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const { scopeFilter, primarySubCompanyId } = agencyScope;
  const ownerIdsList = ownerIdsRaw ? ownerIdsRaw.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  const linked = ownerIdsList.length > 0
    ? await expandLinkedOwnerScope(userId, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) })
    : null;
  const ownerIdFilter = linked ? null : await buildOwnerIdFilterForList(req, {
    userId,
    primarySubCompanyId,
    scope: scope === 'all' ? 'all' : 'mine',
    ownerIdsList,
  });
  const ownerFilter = linked
    ? (linked.mode === 'agencies' || linked.userIds.length === 0
        ? {}
        : { ownerId: { in: linked.userIds } })
    : ownerIdFilter !== undefined ? { ownerId: ownerIdFilter } : {};
  const effectiveScopeFilter = linked ? { subCompanyId: { in: linked.subCompanyIds } } : scopeFilter;

  // Build server-side timestamp filter so we only fetch calls within the requested date range
  const timestampFilter: Record<string, Date> = {};
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) timestampFilter.gte = d; }
  if (to)   { const d = new Date(to);   if (!isNaN(d.getTime())) timestampFilter.lte = d; }

  const detailScope = await resolveClientDetailScope(req, primarySubCompanyId);

  const where: Record<string, unknown> = clientId
    ? {
        AND: [
          { clientId },
          callsForClientDetail(detailScope),
          ...(Object.keys(ownerFilter).length ? [ownerFilter] : []),
          ...(Object.keys(timestampFilter).length ? [{ timestamp: timestampFilter }] : []),
        ],
      }
    : {
        ...effectiveScopeFilter,
        ...ownerFilter,
        ...(Object.keys(timestampFilter).length ? { timestamp: timestampFilter } : {}),
      };

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        client: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        owner: { select: { id: true, firstName: true, lastName: true } },
        subCompany: { select: { id: true, name: true } },
      },
    }),
    prisma.call.count({ where }),
  ]);

  const data = calls.map((c) => ({
    id: c.id,
    clientId: c.clientId ?? undefined,
    clientName: c.client?.name ?? undefined,
    employeeId: c.employeeId ?? undefined,
    employeeName: c.employee
      ? `${c.employee.firstName} ${c.employee.lastName}`.trim() || undefined
      : undefined,
    leadId: c.leadId ?? undefined,
    subCompanyId: c.subCompanyId,
    ownerId: c.ownerId,
    ownerName: [c.owner.firstName, c.owner.lastName].filter(Boolean).join(' ') || 'Unknown',
    outcome: c.outcome,
    duration: c.duration ?? undefined,
    notes: c.notes ?? undefined,
    recordingUrl: c.recordingUrl ?? undefined,
    transcription: c.transcription ?? undefined,
    twilioCallSid: c.twilioCallSid ?? undefined,
    subCompanyName: (c as any).subCompany?.name ?? null,
    timestamp: c.timestamp,
    createdAt: c.createdAt,
  }));

  return res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const updateCallSummarySchema = z.object({
  notes: z.string().max(10000).optional(),
  outcome: z.nativeEnum(CallOutcome).optional(),
  duration: z.number().int().min(0).optional(),
  twilioCallSid: z.string().max(100).optional(),
});

const logCallSchema = z.object({
  clientId: z.string().uuid(),
  leadId: z.string().uuid().optional().nullable(),
  outcome: z.nativeEnum(CallOutcome),
  duration: z.number().int().min(0).optional(),
  notes: z.string().max(10000).optional(),
});

/** POST /voice/calls/log — create a call log without placing a call (e.g. simulated or manual entry). */
voiceRouter.post('/calls/log', callsWrite, actAsMiddleware, async (req: Request, res: Response) => {
  const subCompanyId = await resolveAgencyScope(req);
  const userId = effectiveActorId(req);
  if (!subCompanyId || !userId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = logCallSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  const { clientId, leadId, outcome, duration, notes } = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, clientId, subCompanyId },
      select: { id: true },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found or not in your agency' });
  }

  const call = await prisma.call.create({
    data: {
      clientId,
      leadId: leadId ?? null,
      subCompanyId,
      ownerId: userId,
      outcome,
      duration: duration ?? null,
      notes: notes?.trim() || null,
    },
    include: {
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const ownerName = [call.owner.firstName, call.owner.lastName].filter(Boolean).join(' ') || req.user!.email;
  await createActivityLog({
    userId,
    userName: ownerName,
    subCompanyId,
    type: 'call_made',
    description: `Called ${call.client?.name ?? 'client'}`,
    metadata: {
      clientId: call.client?.id ?? call.clientId,
      clientName: call.client?.name,
      callId: call.id,
      outcome,
      duration: call.duration ?? undefined,
    },
    timestamp: call.timestamp,
  });

  emitToUsers([call.ownerId], 'call:refresh', { subCompanyId: call.subCompanyId });
  await invalidateClientListCache(call.subCompanyId);
  emitToUsers([call.ownerId], 'client:refresh', { subCompanyId: call.subCompanyId });

  return res.status(201).json({
    id: call.id,
    clientId: call.clientId,
    clientName: call.client?.name,
    leadId: call.leadId ?? undefined,
    subCompanyId: call.subCompanyId,
    ownerId: call.ownerId,
    ownerName: [call.owner.firstName, call.owner.lastName].filter(Boolean).join(' ') || 'Unknown',
    outcome: call.outcome,
    duration: call.duration ?? undefined,
    notes: call.notes ?? undefined,
    timestamp: call.timestamp,
    createdAt: call.createdAt,
  });
});

/** GET /voice/calls/:id — get one call (agency-scoped). */
voiceRouter.get('/calls/:id', callsRead, async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedVoiceAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const call = await prisma.call.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    include: {
      client: { select: { id: true, name: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
      lead: { select: { id: true, stage: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!call) return res.status(404).json({ error: 'Call not found' });

  return res.json({
    id: call.id,
    clientId: call.clientId ?? undefined,
    clientName: call.client?.name ?? undefined,
    employeeId: call.employeeId ?? undefined,
    employeeName: call.employee
      ? `${call.employee.firstName} ${call.employee.lastName}`.trim() || undefined
      : undefined,
    leadId: call.leadId ?? undefined,
    subCompanyId: call.subCompanyId,
    ownerId: call.ownerId,
    ownerName: [call.owner.firstName, call.owner.lastName].filter(Boolean).join(' ') || 'Unknown',
    outcome: call.outcome,
    duration: call.duration ?? undefined,
    notes: call.notes ?? undefined,
    recordingUrl: call.recordingUrl ?? undefined,
    transcription: call.transcription ?? undefined,
    twilioCallSid: call.twilioCallSid ?? undefined,
    timestamp: call.timestamp,
    createdAt: call.createdAt,
  });
});

/** GET /voice/calls/:id/recording-token — issue a short-lived stream token for a recording (JWT auth). */
voiceRouter.get('/calls/:id/recording-token', callsRead, async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedVoiceAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const call = await prisma.call.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    select: { id: true, subCompanyId: true, recordingUrl: true },
  });

  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!call.recordingUrl) return res.status(404).json({ error: 'No recording available' });

  const streamToken = jwt.sign(
    { callId: call.id, subCompanyId: call.subCompanyId },
    env.JWT_SECRET,
    { expiresIn: '30m' }
  );

  // Use APP_URL as the authoritative base — it has the correct scheme (https://) in production.
  // Building the URL from request headers is unreliable behind a reverse proxy: without
  // trust proxy enabled, req.protocol is always "http", producing an http:// URL that the
  // browser rejects as mixed content when the page is served over HTTPS.
  const base = env.APP_URL.replace(/\/$/, '');
  const streamUrl = `${base}${env.API_PREFIX}/${env.API_VERSION}/voice/calls/${call.id}/recording?t=${streamToken}`;

  return res.json({ streamUrl });
});

/** PATCH /voice/calls/:id — update call with summary (notes, outcome, duration). Used after call ends. */
voiceRouter.patch('/calls/:id', callsWrite, async (req: Request, res: Response) => {
  const allowedSubCompanyIds = await resolveAllowedVoiceAgencyIds(req);
  if (!allowedSubCompanyIds) return res.status(403).json({ error: 'Agency context required' });

  const parsed = updateCallSummarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });

  const call = await prisma.call.findFirst({
    where: { id: req.params.id, subCompanyId: { in: allowedSubCompanyIds } },
    select: { id: true, twilioCallSid: true },
  });
  if (!call) return res.status(404).json({ error: 'Call not found' });

  const update: { notes?: string | null; outcome?: CallOutcome; duration?: number; twilioCallSid?: string } = {};
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes.trim() || null;
  if (parsed.data.outcome !== undefined) update.outcome = parsed.data.outcome;
  if (parsed.data.duration !== undefined) update.duration = parsed.data.duration;
  if (parsed.data.twilioCallSid !== undefined) update.twilioCallSid = parsed.data.twilioCallSid;

  const updated = await prisma.call.update({
    where: { id: call.id },
    data: update,
    select: { ownerId: true, subCompanyId: true },
  });

  emitToUsers([updated.ownerId], 'call:refresh', { subCompanyId: updated.subCompanyId });

  // Use twilioCallSid from request body, or fall back to what the TwiML webhook already saved in DB
  const effectiveSid = parsed.data.twilioCallSid || call.twilioCallSid;
  if (effectiveSid && parsed.data.outcome === 'answered') {
    scheduleRecordingFetch(call.id, effectiveSid, updated.ownerId, updated.subCompanyId);
  }

  return res.status(200).json({ ok: true });
});
