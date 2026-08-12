/**

 * Conference bridge for inbound/outbound calls — Twilio conferences enable hold,

 * swap, and mute via REST participant control.

 */

import twilio from 'twilio';

import {

  InboundCallOutcome,

  PhoneConferenceLegStatus,

  PhoneQueueEntryStatus,

  type PhoneConferenceLeg,

} from '@prisma/client';

import prisma from '../config/database';

import { getAgencyTwilioCredentials } from './agencyTwilioService';

import { callAgentIntoConference, callPstnIntoConference, toVoiceIdentity } from './twilioVoice';

import { publicWebhookBase, releaseByCallSid } from './callQueue';
import { getAgentInboundCapacity } from './agentPresence';

import { emitToUsers } from '../socket';



const VoiceResponse = twilio.twiml.VoiceResponse;



/** Default hold music when no agency clip URL is configured. */

export const DEFAULT_HOLD_MUSIC_URL = 'https://demo.twilio.com/docs/classic.mp3';



export type HoldFailureReason =

  | 'missing_twilio_call_sid'

  | 'missing_conference_sid'

  | 'missing_pstn_call_sid'

  | 'missing_credentials'

  | 'not_found'

  | 'twilio_error';



export type HoldResult = { ok: true } | { ok: false; reason: HoldFailureReason };



export function conferenceRoomFor(inboundCallId: string): string {

  return `conf-${inboundCallId}`;

}



export function outboundConferenceRoomFor(callRecordId: string): string {

  return `outbound-${callRecordId}`;

}



export interface ConferenceBridgeMeta {

  fromNumber: string;

  toNumber: string;

  departmentLabel?: string;

  callerName?: string;

}



export interface RingMemberInput {

  userId: string;

  userName: string;

  email: string | null;

}



/** Resolve hold music URL from agency call-flow queue nodes, else default. */

export async function resolveAgencyHoldMusicUrl(subCompanyId: string): Promise<string> {

  const config = await prisma.phoneAgencyConfig.findUnique({

    where: { subCompanyId },

    select: { publishedFlow: true },

  });

  const flow = config?.publishedFlow as { nodes?: Array<{ type?: string; data?: Record<string, unknown> }> } | null;

  if (flow?.nodes) {

    for (const node of flow.nodes) {

      if (node.type === 'connect_queue') {

        const url = node.data?.holdMusicUrl;

        if (typeof url === 'string' && url.trim()) return url.trim();

      }

    }

  }

  return DEFAULT_HOLD_MUSIC_URL;

}



/** Twilio webhook that returns looping hold-music TwiML for an agency. */

export function holdMusicWebhookUrl(webhookBase: string, subCompanyId: string): string {

  return `${webhookBase}/hold-music?subCompanyId=${encodeURIComponent(subCompanyId)}`;

}



export function buildHoldMusicTwiml(musicUrl: string): string {

  const vr = new VoiceResponse();

  const url = musicUrl.trim() || DEFAULT_HOLD_MUSIC_URL;

  vr.play({ loop: 0 }, url);

  return vr.toString();

}



/**

 * Append a conference dial verb to an existing VoiceResponse (PSTN caller parks here).

 */

export function appendCallerConference(

  vr: twilio.twiml.VoiceResponse,

  params: {

    conferenceRoom: string;

    inboundCallId: string;

    subCompanyId: string;

    webhookBase: string;

  },

): void {

  const waitUrl = holdMusicWebhookUrl(params.webhookBase, params.subCompanyId);

  const statusCallback =

    `${params.webhookBase}/inbound/conference` +

    `?inboundCallId=${encodeURIComponent(params.inboundCallId)}`;

  const actionUrl =

    `${params.webhookBase}/inbound/after-conference` +

    `?inboundCallId=${encodeURIComponent(params.inboundCallId)}`;



  const dial = vr.dial({ action: actionUrl, method: 'POST' });

  dial.conference(

    {

      waitUrl,

      waitMethod: 'GET',

      startConferenceOnEnter: false,

      endConferenceOnExit: true,

      beep: 'false',

      statusCallback,

      statusCallbackEvent: ['start', 'end', 'join', 'leave'],

      statusCallbackMethod: 'POST',

    },

    params.conferenceRoom,

  );

}



/**

 * TwiML string variant (queue connect redirect uses a standalone Response).

 */

export function callerConferenceTwiml(params: {

  conferenceRoom: string;

  inboundCallId: string;

  subCompanyId: string;

  webhookBase?: string;

}): string {

  const vr = new VoiceResponse();

  appendCallerConference(vr, {

    conferenceRoom: params.conferenceRoom,

    inboundCallId: params.inboundCallId,

    subCompanyId: params.subCompanyId,

    webhookBase: params.webhookBase ?? publicWebhookBase(),

  });

  return vr.toString();

}



/**

 * REST-dial each ringable agent into the conference and record legs for cancel/context lookup.

 */

export async function ringAgentsIntoConference(params: {

  inboundCallId: string;

  subCompanyId: string;

  conferenceRoom: string;

  members: RingMemberInput[];

  callerId: string;

  meta: ConferenceBridgeMeta;

  dialTimeoutSec?: number;

}): Promise<number> {

  if (params.members.length === 0) return 0;



  const webhookBase = publicWebhookBase();

  const timeout = params.dialTimeoutSec ?? 25;



  await prisma.inboundCall

    .update({

      where: { id: params.inboundCallId },

      data: { conferenceRoom: params.conferenceRoom },

    })

    .catch(() => undefined);



  let legsCreated = 0;

  for (const member of params.members) {

    const capacity = await getAgentInboundCapacity(member.userId);
    if (!capacity.canAcceptRing) continue;

    const identity = toVoiceIdentity(member.userId, member.email);

    const statusCallback =

      `${webhookBase}/inbound/agent-status` +

      `?inboundCallId=${encodeURIComponent(params.inboundCallId)}` +

      `&userId=${encodeURIComponent(member.userId)}`;



    try {

      const { sid } = await callAgentIntoConference(

        identity,

        params.conferenceRoom,

        params.callerId,

        params.subCompanyId,

        { statusCallback, timeout },

      );



      await prisma.phoneConferenceLeg.create({

        data: {

          agentCallSid: sid,

          inboundCallId: params.inboundCallId,

          subCompanyId: params.subCompanyId,

          conferenceRoom: params.conferenceRoom,

          userId: member.userId,

          status: PhoneConferenceLegStatus.ringing,

        },

      });

      legsCreated += 1;

    } catch (err) {

      console.error('[conferenceBridge] ringAgentsIntoConference leg failed:', err);

    }

  }

  return legsCreated;

}



/** Cancel all other ringing agent legs once one agent joins the conference. */

export async function cancelOtherAgentLegs(

  inboundCallId: string,

  winnerCallSid: string,

): Promise<void> {

  const legs = await prisma.phoneConferenceLeg.findMany({

    where: {

      inboundCallId,

      status: PhoneConferenceLegStatus.ringing,

      agentCallSid: { not: winnerCallSid },

    },

  });

  if (legs.length === 0) return;



  const subCompanyId = legs[0]!.subCompanyId;

  const creds = await getAgencyTwilioCredentials(subCompanyId);

  if (!creds) return;



  const client = twilio(creds.accountSid, creds.authToken);

  await Promise.all(

    legs.map(async (leg) => {

      try {

        await client.calls(leg.agentCallSid).update({ status: 'completed' });

      } catch {

        // Leg may already have ended.

      }

      await prisma.phoneConferenceLeg

        .update({

          where: { agentCallSid: leg.agentCallSid },

          data: { status: PhoneConferenceLegStatus.canceled },

        })

        .catch(() => undefined);

    }),

  );

}



type TwilioRestClient = ReturnType<typeof twilio>;



async function completeTwilioCall(client: TwilioRestClient, callSid: string): Promise<void> {

  try {

    await client.calls(callSid).update({ status: 'completed' });

  } catch {

    // Leg may already have ended.

  }

}



/** Cancel all ringing/joined agent legs for an inbound conference (full teardown). */

export async function cancelAllAgentLegs(inboundCallId: string): Promise<void> {

  const legs = await prisma.phoneConferenceLeg.findMany({

    where: {

      inboundCallId,

      status: { in: [PhoneConferenceLegStatus.ringing, PhoneConferenceLegStatus.joined] },

    },

  });

  if (legs.length === 0) return;



  const subCompanyId = legs[0]!.subCompanyId;

  const creds = await getAgencyTwilioCredentials(subCompanyId);

  if (!creds) return;



  const client = twilio(creds.accountSid, creds.authToken);

  await Promise.all(

    legs.map(async (leg) => {

      await completeTwilioCall(client, leg.agentCallSid);

      await prisma.phoneConferenceLeg

        .update({

          where: { agentCallSid: leg.agentCallSid },

          data: { status: PhoneConferenceLegStatus.canceled },

        })

        .catch(() => undefined);

    }),

  );

}



async function releaseInboundQueueEntries(inboundCallId: string, twilioCallSid: string | null): Promise<void> {

  if (twilioCallSid) {

    await releaseByCallSid(twilioCallSid, PhoneQueueEntryStatus.abandoned);

  }

  await prisma.phoneQueueEntry

    .updateMany({

      where: {

        inboundCallId,

        status: { in: [PhoneQueueEntryStatus.waiting, PhoneQueueEntryStatus.connecting] },

      },

      data: { status: PhoneQueueEntryStatus.abandoned, endedAt: new Date() },

    })

    .catch(() => undefined);

}



async function notifyInboundRemoteHangup(inboundCallId: string): Promise<void> {

  const [legs, inbound] = await Promise.all([

    prisma.phoneConferenceLeg.findMany({

      where: { inboundCallId },

      select: { userId: true },

    }),

    prisma.inboundCall.findUnique({

      where: { id: inboundCallId },

      select: { answeredByUserId: true, subCompanyId: true },

    }),

  ]);

  const userIds = new Set(legs.map((leg) => leg.userId));

  if (inbound?.answeredByUserId) userIds.add(inbound.answeredByUserId);

  if (userIds.size === 0 || !inbound?.subCompanyId) return;

  emitToUsers([...userIds], 'voice:call-ended', {

    type: 'inbound',

    inboundCallId,

    subCompanyId: inbound.subCompanyId,

    reason: 'remote_hangup',

  });

}



async function notifyOutboundRemoteHangup(callRecordId: string): Promise<void> {

  const call = await prisma.call.findUnique({

    where: { id: callRecordId },

    select: { ownerId: true, subCompanyId: true },

  });

  if (!call) return;

  emitToUsers([call.ownerId], 'voice:call-ended', {

    type: 'outbound',

    callRecordId,

    subCompanyId: call.subCompanyId,

    reason: 'remote_hangup',

  });

}



/** Caller/callee hung up — tear down agent legs and notify browsers (listening side drop). */

export async function handleInboundCallerRemoteHangup(params: {

  callSid: string;

  inboundCallId?: string;

}): Promise<void> {

  let inboundCallId = params.inboundCallId;

  let twilioCallSid: string | null = null;

  if (!inboundCallId) {

    const inbound = await prisma.inboundCall.findFirst({

      where: {

        OR: [

          { twilioCallSid: params.callSid },

          { callerParticipantCallSid: params.callSid },

        ],

      },

      select: { id: true, twilioCallSid: true },

    });

    inboundCallId = inbound?.id;

    twilioCallSid = inbound?.twilioCallSid ?? null;

  } else {

    const inbound = await prisma.inboundCall.findUnique({

      where: { id: inboundCallId },

      select: { twilioCallSid: true },

    });

    twilioCallSid = inbound?.twilioCallSid ?? null;

  }

  if (!inboundCallId) return;



  await cancelAllAgentLegs(inboundCallId);

  await releaseInboundQueueEntries(inboundCallId, twilioCallSid ?? params.callSid);

  await notifyInboundRemoteHangup(inboundCallId);

}



/** End an inbound conference — disconnect caller PSTN leg and all agent legs. */

export async function terminateInboundConference(inboundCallId: string): Promise<{ ok: true }> {

  const inbound = await prisma.inboundCall.findUnique({ where: { id: inboundCallId } });

  if (!inbound) return { ok: true };



  const creds = await getAgencyTwilioCredentials(inbound.subCompanyId);

  if (creds) {

    const client = twilio(creds.accountSid, creds.authToken);

    const callerSids = new Set<string>();

    if (inbound.twilioCallSid) callerSids.add(inbound.twilioCallSid);

    if (inbound.callerParticipantCallSid) callerSids.add(inbound.callerParticipantCallSid);

    for (const sid of callerSids) {

      await completeTwilioCall(client, sid);

    }

  }



  await cancelAllAgentLegs(inboundCallId);

  await releaseInboundQueueEntries(inboundCallId, inbound.twilioCallSid);

  return { ok: true };

}



/** End an outbound conference — disconnect PSTN callee and agent browser leg. */

export async function terminateOutboundConference(callRecordId: string): Promise<{ ok: true }> {

  const call = await prisma.call.findUnique({ where: { id: callRecordId } });

  if (!call) return { ok: true };



  const creds = await getAgencyTwilioCredentials(call.subCompanyId);

  if (!creds) return { ok: true };



  const client = twilio(creds.accountSid, creds.authToken);

  if (call.pstnCallSid) {

    await completeTwilioCall(client, call.pstnCallSid);

  }

  if (call.twilioCallSid) {

    await completeTwilioCall(client, call.twilioCallSid);

  }

  return { ok: true };

}



/** Mark a leg joined and persist conference SID on the inbound call row. */

export async function markAgentLegJoined(params: {

  inboundCallId: string;

  agentCallSid: string;

  userId: string;

  conferenceSid?: string;

}): Promise<void> {

  await prisma.phoneConferenceLeg

    .updateMany({

      where: { agentCallSid: params.agentCallSid, inboundCallId: params.inboundCallId },

      data: { status: PhoneConferenceLegStatus.joined },

    })

    .catch(() => undefined);



  await cancelOtherAgentLegs(params.inboundCallId, params.agentCallSid);



  await prisma.inboundCall

    .update({

      where: { id: params.inboundCallId },

      data: {

        outcome: InboundCallOutcome.answered,

        answeredByUserId: params.userId,

        ...(params.conferenceSid ? { conferenceSid: params.conferenceSid } : {}),

      },

    })

    .catch(() => undefined);

}



/** Resolve inbound call + leg metadata for the browser incoming-call popup. */

export async function getIncomingContextForAgentCall(

  agentCallSid: string,

  forUserId?: string,

): Promise<{

  inboundCallId: string;

  conferenceRoom: string;

  fromNumber: string;

  toNumber: string;

  callerName?: string;

  departmentLabel?: string;

} | null> {

  const leg = await prisma.phoneConferenceLeg.findUnique({

    where: { agentCallSid },

    include: { inboundCall: true },

  });

  if (!leg?.inboundCall) return null;

  if (forUserId && leg.userId !== forUserId) return null;



  const call = leg.inboundCall;

  return {

    inboundCallId: call.id,

    conferenceRoom: leg.conferenceRoom,

    fromNumber: call.fromNumber,

    toNumber: call.toNumber,

    departmentLabel: call.departmentLabel ?? call.ringGroupName ?? undefined,

  };

}



function sleep(ms: number): Promise<void> {

  return new Promise((resolve) => setTimeout(resolve, ms));

}



function callerHoldTargetSid(inbound: {

  twilioCallSid: string | null;

  callerParticipantCallSid: string | null;

}): string | null {

  return inbound.callerParticipantCallSid ?? inbound.twilioCallSid;

}



async function resolveConferenceSidFromTwilio(

  subCompanyId: string,

  conferenceRoom: string,

): Promise<string | null> {

  const creds = await getAgencyTwilioCredentials(subCompanyId);

  if (!creds) return null;



  const client = twilio(creds.accountSid, creds.authToken);

  try {

    const conferences = await client.conferences.list({

      friendlyName: conferenceRoom,

      status: 'in-progress',

      limit: 1,

    });

    return conferences[0]?.sid ?? null;

  } catch (err) {

    console.error('[conferenceBridge] resolveConferenceSidFromTwilio failed:', err);

    return null;

  }

}



async function resolveCallerParticipantCallSidFromTwilio(

  subCompanyId: string,

  conferenceSid: string,

  inboundCallId: string,

  inbound: {

    twilioCallSid: string | null;

    callerParticipantCallSid: string | null;

  },

): Promise<string | null> {

  const known = callerHoldTargetSid(inbound);

  const creds = await getAgencyTwilioCredentials(subCompanyId);

  if (!creds) return known;



  const client = twilio(creds.accountSid, creds.authToken);

  try {

    const participants = await client.conferences(conferenceSid).participants.list();

    if (known && participants.some((p) => p.callSid === known)) return known;

    if (inbound.twilioCallSid) {

      const bySid = participants.find((p) => p.callSid === inbound.twilioCallSid);

      if (bySid?.callSid) return bySid.callSid;

    }

    const legs = await prisma.phoneConferenceLeg.findMany({

      where: { inboundCallId },

      select: { agentCallSid: true },

    });

    const agentSids = new Set(legs.map((l) => l.agentCallSid));

    const pstn = participants.find((p) => p.callSid && !agentSids.has(p.callSid));

    return pstn?.callSid ?? known;

  } catch (err) {

    console.error('[conferenceBridge] resolveCallerParticipantCallSidFromTwilio failed:', err);

    return known;

  }

}



async function updateConferenceParticipantHold(

  conferenceSid: string,

  participantCallSid: string,

  subCompanyId: string,

  hold: boolean,

): Promise<HoldResult> {

  const creds = await getAgencyTwilioCredentials(subCompanyId);

  if (!creds) return { ok: false, reason: 'missing_credentials' };



  const client = twilio(creds.accountSid, creds.authToken);

  const holdUrl = hold ? holdMusicWebhookUrl(publicWebhookBase(), subCompanyId) : undefined;



  try {

    await client

      .conferences(conferenceSid)

      .participants(participantCallSid)

      .update({

        hold,

        ...(hold && holdUrl ? { holdUrl, holdMethod: 'GET' } : {}),

      });

    return { ok: true };

  } catch (err) {

    console.error('[conferenceBridge] updateConferenceParticipantHold failed:', err);

    return { ok: false, reason: 'twilio_error' };

  }

}



/** Hold or un-hold the PSTN caller in their conference (plays hold music when held). */

export async function setCallerHold(

  inboundCallId: string,

  hold: boolean,

  _holdMusicUrl?: string,

): Promise<HoldResult> {

  let inbound = await prisma.inboundCall.findUnique({ where: { id: inboundCallId } });

  if (!inbound?.twilioCallSid) return { ok: false, reason: 'missing_twilio_call_sid' };



  if (!inbound.conferenceSid && inbound.conferenceRoom) {

    const deadline = Date.now() + 10000;

    while (!inbound.conferenceSid && Date.now() < deadline) {

      await sleep(200);

      inbound = await prisma.inboundCall.findUnique({ where: { id: inboundCallId } });

      if (!inbound?.twilioCallSid) return { ok: false, reason: 'missing_twilio_call_sid' };

    }

  }



  let conferenceSid = inbound?.conferenceSid ?? null;

  if (!conferenceSid && inbound?.conferenceRoom) {

    conferenceSid = await resolveConferenceSidFromTwilio(inbound.subCompanyId, inbound.conferenceRoom);

    if (conferenceSid) {

      await storeConferenceSid(inboundCallId, conferenceSid);

    }

  }



  let participantSid = inbound ? callerHoldTargetSid(inbound) : null;

  if (conferenceSid && inbound) {

    const resolved = await resolveCallerParticipantCallSidFromTwilio(

      inbound.subCompanyId,

      conferenceSid,

      inboundCallId,

      inbound,

    );

    if (resolved && resolved !== inbound.callerParticipantCallSid) {

      await storeCallerParticipantCallSid(inboundCallId, resolved);

    }

    participantSid = resolved ?? participantSid;

  }



  if (!conferenceSid || !participantSid) {

    console.error('[conferenceBridge] setCallerHold failed:', {

      inboundCallId,

      conferenceSid,

      participantSid,

      conferenceRoom: inbound?.conferenceRoom,

    });

    return { ok: false, reason: 'missing_conference_sid' };

  }



  return updateConferenceParticipantHold(

    conferenceSid,

    participantSid,

    inbound!.subCompanyId,

    hold,

  );

}



/** Hold or un-hold the PSTN callee on an outbound conference call. */

export async function setOutboundCalleeHold(

  callRecordId: string,

  hold: boolean,

  _holdMusicUrl?: string,

): Promise<HoldResult> {

  let call = await prisma.call.findUnique({ where: { id: callRecordId } });

  if (!call) return { ok: false, reason: 'not_found' };



  if (!call.conferenceSid && call.conferenceRoom) {

    const deadline = Date.now() + 10000;

    while (!call.conferenceSid && Date.now() < deadline) {

      await sleep(200);

      call = await prisma.call.findUnique({ where: { id: callRecordId } });

      if (!call) return { ok: false, reason: 'not_found' };

    }

  }



  if (!call?.conferenceSid || !call.pstnCallSid) {

    return { ok: false, reason: call?.conferenceSid ? 'missing_pstn_call_sid' : 'missing_conference_sid' };

  }



  return updateConferenceParticipantHold(

    call.conferenceSid,

    call.pstnCallSid,

    call.subCompanyId,

    hold,

  );

}



/**

 * True when every agent leg has ended and none joined (no-answer / busy for the group).

 */

export async function allAgentLegsTerminalWithoutJoin(inboundCallId: string): Promise<boolean> {

  const legs = await prisma.phoneConferenceLeg.findMany({ where: { inboundCallId } });

  if (legs.length === 0) return false;

  if (legs.some((l) => l.status === PhoneConferenceLegStatus.joined)) return false;

  if (legs.some((l) => l.status === PhoneConferenceLegStatus.ringing)) return false;

  return true;

}



export async function updateLegStatusFromCallback(

  agentCallSid: string,

  callStatus: string,

): Promise<PhoneConferenceLeg | null> {

  const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(

    callStatus.toLowerCase(),

  );

  if (!terminal) return null;



  const leg = await prisma.phoneConferenceLeg.findUnique({ where: { agentCallSid } });

  if (!leg || leg.status === PhoneConferenceLegStatus.joined) return leg;



  const nextStatus =

    callStatus === 'completed' && leg.status === PhoneConferenceLegStatus.ringing

      ? PhoneConferenceLegStatus.canceled

      : PhoneConferenceLegStatus.failed;



  return prisma.phoneConferenceLeg

    .update({

      where: { agentCallSid },

      data: { status: nextStatus },

    })

    .catch(() => null);

}



/** Redirect the caller's live PSTN leg to a new TwiML URL (no-answer fallback). */

export async function redirectCallerCall(

  inboundCallId: string,

  url: string,

): Promise<boolean> {

  const inbound = await prisma.inboundCall.findUnique({ where: { id: inboundCallId } });

  if (!inbound?.twilioCallSid) return false;



  const creds = await getAgencyTwilioCredentials(inbound.subCompanyId);

  if (!creds) return false;



  try {

    const client = twilio(creds.accountSid, creds.authToken);

    await client.calls(inbound.twilioCallSid).update({ method: 'POST', url });

    return true;

  } catch (err) {

    console.error('[conferenceBridge] redirectCallerCall failed:', err);

    return false;

  }

}



export async function storeConferenceSid(

  inboundCallId: string,

  conferenceSid: string,

): Promise<void> {

  await prisma.inboundCall

    .update({

      where: { id: inboundCallId },

      data: { conferenceSid },

    })

    .catch(() => undefined);

}



export async function storeCallerParticipantCallSid(

  inboundCallId: string,

  callSid: string,

): Promise<void> {

  await prisma.inboundCall

    .update({

      where: { id: inboundCallId },

      data: { callerParticipantCallSid: callSid },

    })

    .catch(() => undefined);

}



export async function storeOutboundConferenceMeta(
  callRecordId: string,
  data: {
    conferenceSid?: string;
    conferenceRoom?: string;
    pstnCallSid?: string;
    twilioCallSid?: string;
  },
): Promise<void> {
  try {
    await prisma.call.update({ where: { id: callRecordId }, data });
  } catch (err) {
    console.error('[conferenceBridge] storeOutboundConferenceMeta failed:', callRecordId, err);
  }
}

function isConferenceJoinEvent(event: string): boolean {
  return event === 'participant-join' || event === 'join';
}

function isConferenceLeaveEvent(event: string): boolean {
  return event === 'participant-leave' || event === 'leave';
}

function isConferenceEndEvent(event: string): boolean {
  return event === 'conference-end' || event === 'end';
}

async function completeOutboundAgentLeg(callRecordId: string): Promise<void> {
  const call = await prisma.call.findUnique({ where: { id: callRecordId } });
  if (!call?.twilioCallSid) return;

  const creds = await getAgencyTwilioCredentials(call.subCompanyId);
  if (!creds) return;

  const client = twilio(creds.accountSid, creds.authToken);
  await completeTwilioCall(client, call.twilioCallSid);
}



/** Dial PSTN callee into outbound conference once agent has joined. */

export async function dialOutboundCalleeIntoConference(params: {

  callRecordId: string;

  subCompanyId: string;

  conferenceRoom: string;

  toNumber: string;

  callerId: string;

  webhookBase: string;

}): Promise<void> {

  const statusCallback =

    `${params.webhookBase}/outbound/pstn-status` +

    `?callRecordId=${encodeURIComponent(params.callRecordId)}`;



  try {

    const { sid } = await callPstnIntoConference(

      params.toNumber,

      params.conferenceRoom,

      params.callerId,

      params.subCompanyId,

      { statusCallback },

    );

    await storeOutboundConferenceMeta(params.callRecordId, { pstnCallSid: sid });

  } catch (err) {

    console.error('[conferenceBridge] dialOutboundCalleeIntoConference failed:', err);

  }

}

/** Outbound conference statusCallback — dial PSTN callee after agent joins. */
export async function handleOutboundConferenceCallback(params: {
  callRecordId: string;
  toNumber: string;
  webhookBase: string;
  body: Record<string, string | undefined>;
}): Promise<void> {
  const event = (params.body.StatusCallbackEvent ?? '').toLowerCase();
  const conferenceSid = params.body.ConferenceSid;
  const callSid = params.body.CallSid;

  if (conferenceSid) {
    await storeOutboundConferenceMeta(params.callRecordId, { conferenceSid });
  }

  if (isConferenceLeaveEvent(event) || isConferenceEndEvent(event)) {
    const call = await prisma.call.findUnique({ where: { id: params.callRecordId } });
    if (!call) return;

    const pstnLeft = Boolean(callSid && call.pstnCallSid && callSid === call.pstnCallSid);
    if (pstnLeft || isConferenceEndEvent(event)) {
      await completeOutboundAgentLeg(params.callRecordId);
      await notifyOutboundRemoteHangup(params.callRecordId);
    }
    return;
  }

  if (!isConferenceJoinEvent(event) || !callSid) return;

  const call = await prisma.call.findUnique({ where: { id: params.callRecordId } });
  if (!call?.conferenceRoom) return;

  const isAgentLeg =
    call.twilioCallSid == null || callSid === call.twilioCallSid;

  if (isAgentLeg && !call.pstnCallSid) {
    const { resolveAgencyOutboundCallerId } = await import('./phoneSystemService');
    const callerId = await resolveAgencyOutboundCallerId(call.subCompanyId);
    if (!callerId) {
      console.warn('[conferenceBridge] outbound join: no caller ID for', params.callRecordId);
      return;
    }
    await dialOutboundCalleeIntoConference({
      callRecordId: params.callRecordId,
      subCompanyId: call.subCompanyId,
      conferenceRoom: call.conferenceRoom,
      toNumber: params.toNumber,
      callerId,
      webhookBase: params.webhookBase,
    });
    return;
  }

  // PSTN leg joined — capture CallSid for hold API (never treat agent leg as PSTN).
  if (!isAgentLeg && callSid !== call.pstnCallSid) {
    await storeOutboundConferenceMeta(params.callRecordId, { pstnCallSid: callSid });
  }
}

/** PSTN leg status for outbound conference — persist answered CallSid for hold API. */
export async function handleOutboundPstnStatus(params: {
  callRecordId: string;
  callSid: string;
  callStatus: string;
}): Promise<void> {
  const status = params.callStatus.toLowerCase();
  if (status === 'answered' || status === 'in-progress') {
    await storeOutboundConferenceMeta(params.callRecordId, { pstnCallSid: params.callSid });
    return;
  }

  const terminalStatuses = ['completed', 'no-answer', 'busy', 'failed', 'canceled'];
  if (terminalStatuses.includes(status)) {
    await completeOutboundAgentLeg(params.callRecordId);
    await notifyOutboundRemoteHangup(params.callRecordId);
  }
}

/** Conference statusCallback for inbound caller parked in conf-{inboundCallId}. */
export async function handleInboundConferenceStatus(params: {
  inboundCallId: string;
  body: Record<string, string | undefined>;
}): Promise<void> {
  const event = (params.body.StatusCallbackEvent ?? '').toLowerCase();
  const conferenceSid = params.body.ConferenceSid;
  const callSid = params.body.CallSid;

  if (conferenceSid) {
    await storeConferenceSid(params.inboundCallId, conferenceSid);
  }

  if (isConferenceLeaveEvent(event) || isConferenceEndEvent(event)) {
    const inbound = await prisma.inboundCall.findUnique({ where: { id: params.inboundCallId } });
    if (!inbound) return;

    const callerLeft =
      isConferenceEndEvent(event) ||
      !callSid ||
      callSid === inbound.twilioCallSid ||
      callSid === inbound.callerParticipantCallSid;

    if (callerLeft) {
      await cancelAllAgentLegs(params.inboundCallId);
      await releaseInboundQueueEntries(params.inboundCallId, inbound.twilioCallSid);
      await notifyInboundRemoteHangup(params.inboundCallId);
    }
    return;
  }

  if (!isConferenceJoinEvent(event) || !callSid) return;

  const inbound = await prisma.inboundCall.findUnique({ where: { id: params.inboundCallId } });
  if (inbound?.twilioCallSid === callSid) {
    await storeCallerParticipantCallSid(params.inboundCallId, callSid);
  }
}

/** Agent REST-dial statusCallback while ringing into an inbound conference. */
export async function handleInboundAgentStatus(params: {
  inboundCallId: string;
  userId: string;
  callSid: string;
  callStatus: string;
  conferenceSid?: string;
  webhookBase: string;
}): Promise<void> {
  const status = params.callStatus.toLowerCase();

  if (status === 'in-progress' || status === 'answered') {
    await markAgentLegJoined({
      inboundCallId: params.inboundCallId,
      agentCallSid: params.callSid,
      userId: params.userId,
      conferenceSid: params.conferenceSid,
    });

    await prisma.phoneQueueEntry
      .updateMany({
        where: {
          inboundCallId: params.inboundCallId,
          status: PhoneQueueEntryStatus.waiting,
        },
        data: {
          status: PhoneQueueEntryStatus.connected,
          connectedUserId: params.userId,
          connectedAt: new Date(),
          endedAt: new Date(),
        },
      })
      .catch(() => undefined);
    return;
  }

  await updateLegStatusFromCallback(params.callSid, params.callStatus);

  if (await allAgentLegsTerminalWithoutJoin(params.inboundCallId)) {
    const inbound = await prisma.inboundCall.findUnique({ where: { id: params.inboundCallId } });
    if (!inbound?.twilioCallSid) return;
    const fallbackUrl =
      `${params.webhookBase}/inbound` +
      `?conferenceNoAnswer=1&inboundCallId=${encodeURIComponent(params.inboundCallId)}`;
    await redirectCallerCall(params.inboundCallId, fallbackUrl);
  }
}
