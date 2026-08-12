import { Router, Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { resolveAgencyScope, resolveListAgencyScope } from '../config/agencyScope';
import { buildOwnerIdFilterForList } from '../services/listOwnerScope';
import { expandLinkedOwnerScope, ownerExactFromQuery } from '../services/linkedOwnerExpand';
import { env } from '../config/env';
import {
  getPhoneSystemBundle,
  putPhoneSystemBundle,
  listInboundCalls,
  publishCallFlow,
  restorePhoneSystemDefaults,
  uploadPhoneAudioClipFile,
  getPhoneAudioClipR2Key,
  type PutPhoneSystemBundleInput,
} from '../services/phoneSystemService';
import { getStaffExtensionForUser } from '../services/staffExtensions';
import {
  testAgencyTwilioConnection,
  syncPhoneNumbersFromTwilio,
} from '../services/agencyTwilioService';
import {
  assertInboundCallAccess,
  assertVoicemailBoxAccess,
  getUserRingGroups,
  InboundAccessError,
  resolveDefaultInbox,
} from '../services/inboundVoicemailAccess';
import { scopeAtLeast } from '../services/accessContext';
import { PhoneQueueEntryStatus } from '@prisma/client';
import { listWaiting, listConnectingForAgent, connectEntryToAgent, cancelEntry } from '../services/callQueue';
import { getAgentInboundCapacity } from '../services/agentPresence';
import { pipeRecordingStream } from '../services/recordingStream';
import { ensureAccessContext } from '../utils/requestPermission';
import {
  audioClipStreamUrl,
  verifyAudioClipStreamToken,
} from '../services/phoneSystemAudioClips';

export const phoneSystemRouter = Router();

/** Unauthenticated — JWT stream for inbound voicemail (mirrors voice.ts outbound pattern). */
phoneSystemRouter.get('/inbound-calls/:id/recording', async (req: Request, res: Response) => {
  const token = req.query.t as string | undefined;
  if (!token) return res.status(401).json({ error: 'Missing stream token' });

  let payload: { inboundCallId: string; subCompanyId: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as typeof payload;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired stream token' });
  }

  if (payload.inboundCallId !== req.params.id) {
    return res.status(403).json({ error: 'Token does not match call' });
  }

  const call = await prisma.inboundCall.findFirst({
    where: { id: payload.inboundCallId, subCompanyId: payload.subCompanyId },
    select: { recordingUrl: true },
  });

  if (!call?.recordingUrl) return res.status(404).json({ error: 'Recording not found' });

  await pipeRecordingStream(call.recordingUrl, req, res);
  return;
});

/** Unauthenticated — JWT stream for uploaded IVR audio clips (Twilio Play + settings preview). */
phoneSystemRouter.get('/audio-clips/:clipId/stream', async (req: Request, res: Response) => {
  const token = req.query.t as string | undefined;
  if (!token) return res.status(401).json({ error: 'Missing stream token' });

  const payload = verifyAudioClipStreamToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired stream token' });
  if (payload.clipId !== req.params.clipId) {
    return res.status(403).json({ error: 'Token does not match clip' });
  }

  const r2Key = await getPhoneAudioClipR2Key(payload.subCompanyId, payload.clipId);
  if (!r2Key) return res.status(404).json({ error: 'Audio clip not found' });

  await pipeRecordingStream(r2Key, req, res);
  return;
});

phoneSystemRouter.use(authenticate);

const phoneRead = requirePermission('phone_system:read', 'settings:read');
const phoneWrite = requirePermission('phone_system:write', 'settings:write');
const inboundRead = requirePermission('inbound_calls:read', 'calls:read');
const inboundWrite = requirePermission('voice:use', 'inbound_calls:read');
const myExtensionRead = requirePermission('calls:read', 'voice:use');

const bundleQuerySchema = z.object({
  subCompanyId: z.string().uuid().optional(),
});

const putBundleSchema = z.object({
  subCompanyId: z.string().uuid().optional(),
  flowTitle: z.string().max(200).optional(),
  config: z.record(z.unknown()).optional(),
  phoneNumbers: z.array(z.record(z.unknown())).optional(),
  menuRoutes: z.array(z.unknown()).optional(),
  ringGroups: z.array(z.unknown()).optional(),
  staffExtensions: z.array(z.unknown()).optional(),
  voicemailBoxes: z.array(z.unknown()).optional(),
  audioClips: z.array(z.unknown()).optional(),
  businessHours: z.array(z.unknown()).optional(),
  readinessSteps: z.array(z.unknown()).optional(),
  draftFlow: z.unknown().optional(),
  publishedFlow: z.unknown().nullable().optional(),
  twilio: z
    .object({
      accountSid: z.string().nullable().optional(),
      authToken: z.string().nullable().optional(),
      apiKeySid: z.string().nullable().optional(),
      apiKeySecret: z.string().nullable().optional(),
      twimlAppSid: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
    })
    .optional(),
});

async function resolveTargetAgencyId(req: Request, explicitId?: string): Promise<string | null> {
  if (explicitId) {
    const scope = await resolveListAgencyScope(req);
    if (!scope) return null;
    if (scope.allowedIds.includes(explicitId)) return explicitId;
    // Stale/mock client ids (e.g. `sub1`) — fall back like a missing param.
  }
  return resolveAgencyScope(req);
}

/** GET /phone-system/my-extension — current user's own PBX extension only (not full staff list). */
phoneSystemRouter.get('/my-extension', myExtensionRead, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // Always the effective user's home agency (act-as mutates subCompanyId). Ignore ?subCompanyId=
  // so viewing another agency does not hide or swap the user's own extension.
  const subCompanyId = req.user?.subCompanyId?.trim() || null;
  if (!subCompanyId) {
    return res.json({ extension: null });
  }

  const extension = await getStaffExtensionForUser(userId, subCompanyId);
  return res.json({ extension });
});

/** GET /phone-system/bundle?subCompanyId= */
phoneSystemRouter.get('/bundle', phoneRead, async (req: Request, res: Response) => {
  const parsed = bundleQuerySchema.safeParse(req.query);
  const subCompanyId = await resolveTargetAgencyId(
    req,
    parsed.success ? parsed.data.subCompanyId : undefined,
  );
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const bundle = await getPhoneSystemBundle(subCompanyId);
  if (!bundle) return res.status(404).json({ error: 'Agency not found' });
  return res.json(bundle);
});

/** PUT /phone-system/bundle */
phoneSystemRouter.put('/bundle', phoneWrite, async (req: Request, res: Response) => {
  const parsed = putBundleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const subCompanyId = await resolveTargetAgencyId(req, parsed.data.subCompanyId);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const { subCompanyId: _omit, ...payload } = parsed.data;
  void _omit;

  try {
    const bundle = await putPhoneSystemBundle(subCompanyId, payload as PutPhoneSystemBundleInput);
    return res.json(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save phone system';
    const isValidation =
      message.includes('Invalid') ||
      message.includes('E.164') ||
      message.includes('looks invalid') ||
      message.includes('must start with') ||
      message.includes('Region');
    return res.status(isValidation ? 400 : 500).json({ error: message });
  }
});

/** POST /phone-system/bundle/restore-defaults — reset IVR template (keeps numbers + staff) */
phoneSystemRouter.post('/bundle/restore-defaults', phoneWrite, async (req: Request, res: Response) => {
  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.body?.subCompanyId === 'string' ? req.body.subCompanyId : undefined,
  );
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  try {
    const bundle = await restorePhoneSystemDefaults(subCompanyId);
    return res.json(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to restore phone system defaults';
    return res.status(500).json({ error: message });
  }
});

/** POST /phone-system/call-flow/publish — copy draft → published with validation */
phoneSystemRouter.post('/call-flow/publish', phoneWrite, async (req: Request, res: Response) => {
  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.body?.subCompanyId === 'string' ? req.body.subCompanyId : undefined,
  );
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  try {
    const bundle = await publishCallFlow(subCompanyId);
    return res.json(bundle);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to publish call flow';
    const isValidation = message.includes('Published flow') || message.includes('references');
    return res.status(isValidation ? 400 : 500).json({ error: message });
  }
});

const patchInboundSchema = z.object({
  outcome: z.enum(['answered', 'no_answer', 'voicemail', 'abandoned', 'busy', 'failed']).optional(),
  durationSec: z.number().int().min(0).optional(),
});

/** PATCH /phone-system/inbound-calls/:id — agent answered/declined from softphone */
phoneSystemRouter.patch('/inbound-calls/:id', inboundWrite, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

  const parsed = patchInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const scope = await resolveListAgencyScope(req);
  if (!scope) return res.status(403).json({ error: 'Agency context required' });

  const call = await prisma.inboundCall.findFirst({
    where: { id: req.params.id, subCompanyId: { in: scope.allowedIds } },
  });
  if (!call) return res.status(404).json({ error: 'Inbound call not found' });

  const data: { outcome?: typeof parsed.data.outcome; durationSec?: number; answeredByUserId?: string } = {};
  if (parsed.data.outcome) data.outcome = parsed.data.outcome;
  if (parsed.data.durationSec !== undefined) data.durationSec = parsed.data.durationSec;
  if (parsed.data.outcome === 'answered') data.answeredByUserId = userId;

  const updated = await prisma.inboundCall.update({
    where: { id: call.id },
    data,
  });
  return res.json({ id: updated.id, outcome: updated.outcome });
});

const listInboundQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(50),
  subCompanyId: z.string().uuid().optional(),
  agencyIds: z.string().optional(),
  userId: z.string().uuid().optional(),
  ownerIds: z.string().optional(),
  outcome: z.enum(['answered', 'no_answer', 'voicemail', 'abandoned', 'busy', 'failed']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  inbox: z.enum(['mine', 'ring_group', 'all', 'answered']).optional(),
  ringGroupId: z.string().min(1).optional(),
  voicemailBoxId: z.string().min(1).optional(),
});

/** GET /phone-system/my-ring-groups?subCompanyId= — ring groups the current user belongs to */
phoneSystemRouter.get('/my-ring-groups', inboundRead, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId : undefined,
  );
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const groups = await getUserRingGroups(subCompanyId, userId);
  return res.json({ data: groups });
});

/** GET /phone-system/queue/live?subCompanyId= — callers currently waiting in the queue. */
phoneSystemRouter.get('/queue/live', inboundRead, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId : undefined,
  );
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const accessCtx = await ensureAccessContext(req);
  if (!accessCtx) return res.status(403).json({ error: 'Unauthorized' });

  const groups = await getUserRingGroups(subCompanyId, userId);
  const groupIds = groups.map((g) => g.id);
  // Members see their groups' queues; elevated roles (team+) or non-members see all.
  const ringGroupIds =
    groupIds.length && !scopeAtLeast(accessCtx.scopeLevel, 'team') ? groupIds : undefined;

  const entries = await listWaiting({ subCompanyId, ringGroupIds });
  const connecting = await listConnectingForAgent({ subCompanyId, userId, ringGroupIds });
  const merged = [...entries, ...connecting].sort(
    (a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime(),
  );
  return res.json({
    data: merged.map((e) => ({
      id: e.id,
      ringGroupId: e.ringGroupId,
      ringGroupName: e.ringGroupName,
      callerNumber: e.callerNumber,
      callerName: e.callerName,
      enqueuedAt: e.enqueuedAt,
      status: e.status,
    })),
  });
});

/** POST /phone-system/queue/:entryId/pickup — agent manually connects a waiting caller. */
phoneSystemRouter.post('/queue/:entryId/pickup', inboundWrite, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

  const scope = await resolveListAgencyScope(req);
  if (!scope) return res.status(403).json({ error: 'Agency context required' });

  const entry = await prisma.phoneQueueEntry.findUnique({ where: { id: req.params.entryId } });
  if (!entry) return res.status(404).json({ error: 'Queue entry not found' });
  if (!scope.allowedIds.includes(entry.subCompanyId)) {
    return res.status(403).json({ error: 'Not allowed for this agency' });
  }

  const capacity = await getAgentInboundCapacity(userId);
  if (!capacity.canPickupFromQueue) {
    return res.status(409).json({
      error: 'Agent at max capacity — end or swap a call first',
    });
  }

  const ok = await connectEntryToAgent(entry.id, userId);
  if (!ok) {
    const latest = await prisma.phoneQueueEntry.findUnique({ where: { id: entry.id } });
    if (
      latest?.status === PhoneQueueEntryStatus.connecting &&
      latest.connectedUserId &&
      latest.connectedUserId !== userId
    ) {
      return res.status(409).json({ error: 'Another agent is connecting this caller' });
    }
    return res.status(409).json({ error: 'Caller is no longer waiting — refresh the queue' });
  }
  return res.json({ ok: true });
});

/** POST /phone-system/queue/:entryId/cancel — agent removes a waiting/stale caller. */
phoneSystemRouter.post('/queue/:entryId/cancel', inboundWrite, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

  const scope = await resolveListAgencyScope(req);
  if (!scope) return res.status(403).json({ error: 'Agency context required' });

  const entry = await prisma.phoneQueueEntry.findUnique({ where: { id: req.params.entryId } });
  if (!entry) return res.json({ ok: true });
  if (!scope.allowedIds.includes(entry.subCompanyId)) {
    return res.status(403).json({ error: 'Not allowed for this agency' });
  }

  await cancelEntry(entry.id);
  return res.json({ ok: true });
});

/** GET /phone-system/inbound-calls/:id/recording-token */
phoneSystemRouter.get('/inbound-calls/:id/recording-token', inboundRead, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Unauthorized' });

  const scope = await resolveListAgencyScope(req);
  if (!scope) return res.status(403).json({ error: 'Agency context required' });

  const call = await prisma.inboundCall.findFirst({
    where: { id: req.params.id, subCompanyId: { in: scope.allowedIds } },
    select: {
      id: true,
      subCompanyId: true,
      recordingUrl: true,
      answeredByUserId: true,
      ringGroupId: true,
      voicemailBoxId: true,
    },
  });
  if (!call) return res.status(404).json({ error: 'Inbound call not found' });
  if (!call.recordingUrl) return res.status(404).json({ error: 'No recording available' });

  const accessCtx = await ensureAccessContext(req);
  if (!accessCtx) return res.status(403).json({ error: 'Unauthorized' });

  try {
    await assertInboundCallAccess({
      call,
      userId,
      scopeLevel: accessCtx.scopeLevel,
      subCompanyId: call.subCompanyId,
    });
  } catch (err) {
    if (err instanceof InboundAccessError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
  }

  const streamToken = jwt.sign(
    { inboundCallId: call.id, subCompanyId: call.subCompanyId },
    env.JWT_SECRET,
    { expiresIn: '30m' },
  );

  const base = env.APP_URL.replace(/\/$/, '');
  const streamUrl = `${base}${env.API_PREFIX}/${env.API_VERSION}/phone-system/inbound-calls/${call.id}/recording?t=${streamToken}`;

  return res.json({ streamUrl });
});

const uploadAudioClipSchema = z.object({
  subCompanyId: z.string().uuid().optional(),
  fileBase64: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(128).optional(),
});

/** POST /phone-system/audio-clips/:clipId/upload — store voice file in R2 for an audio clip */
phoneSystemRouter.post('/audio-clips/:clipId/upload', phoneWrite, async (req: Request, res: Response) => {
  const parsed = uploadAudioClipSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  const subCompanyId = await resolveTargetAgencyId(req, parsed.data.subCompanyId);
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  try {
    const data = await uploadPhoneAudioClipFile(subCompanyId, req.params.clipId, parsed.data);
    return res.status(201).json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File upload failed';
    const status =
      message.includes('not configured') ||
      message.includes('Unsupported') ||
      message.includes('too large') ||
      message.includes('Invalid') ||
      message.includes('required') ||
      message.includes('empty')
        ? 400
        : 500;
    return res.status(status).json({ error: message });
  }
});

/** GET /phone-system/audio-clips/:clipId/stream-token — preview uploaded clip in settings */
phoneSystemRouter.get('/audio-clips/:clipId/stream-token', phoneRead, async (req: Request, res: Response) => {
  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.query.subCompanyId === 'string' ? req.query.subCompanyId : undefined,
  );
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }

  const r2Key = await getPhoneAudioClipR2Key(subCompanyId, req.params.clipId);
  if (!r2Key) return res.status(404).json({ error: 'Audio clip not found' });

  const streamUrl = audioClipStreamUrl(subCompanyId, req.params.clipId);
  return res.json({ streamUrl });
});

/** GET /phone-system/inbound-calls — agency-scoped inbound call history */
phoneSystemRouter.get('/inbound-calls', inboundRead, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) return res.status(403).json({ error: 'Agency context required' });

  const parsed = listInboundQuerySchema.safeParse(req.query);
  const q = parsed.success
    ? parsed.data
    : {
        page: 1,
        limit: 50,
        subCompanyId: undefined,
        agencyIds: undefined,
        userId: undefined,
        ownerIds: undefined,
        outcome: undefined,
        from: undefined,
        to: undefined,
        inbox: undefined,
        ringGroupId: undefined,
        voicemailBoxId: undefined,
      };

  const agencyScope = await resolveListAgencyScope(req, q.agencyIds ?? q.subCompanyId);
  if (!agencyScope) return res.status(403).json({ error: 'Agency context required' });

  const { primarySubCompanyId } = agencyScope;
  const subCompanyIds =
    'subCompanyId' in agencyScope.scopeFilter &&
    typeof agencyScope.scopeFilter.subCompanyId === 'string'
      ? [agencyScope.scopeFilter.subCompanyId]
      : agencyScope.allowedIds;

  const accessCtx = await ensureAccessContext(req);
  if (!accessCtx) return res.status(403).json({ error: 'Unauthorized' });

  const inbox = q.inbox ?? resolveDefaultInbox(accessCtx.scopeLevel);

  if (inbox === 'ring_group' && q.voicemailBoxId && primarySubCompanyId) {
    try {
      await assertVoicemailBoxAccess(primarySubCompanyId, userId, q.voicemailBoxId);
    } catch (err) {
      if (err instanceof InboundAccessError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      throw err;
    }
  }

  const ownerIdsList = q.ownerIds
    ? q.ownerIds.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    : [];
  const linked = ownerIdsList.length > 0 && !q.userId
    ? await expandLinkedOwnerScope(userId, req.user!.subCompanyId, ownerIdsList, { exact: ownerExactFromQuery(req.query) })
    : null;
  const effectiveSubCompanyIds = linked ? linked.subCompanyIds : subCompanyIds;
  const ownerIdFilter = linked ? null : await buildOwnerIdFilterForList(req, {
    userId,
    primarySubCompanyId,
    scope: 'all',
    ownerIdsList,
  });
  const ownerIds =
    q.userId
      ? [q.userId]
      : linked
        ? (linked.mode === 'agencies' || linked.userIds.length === 0 ? undefined : linked.userIds)
        : ownerIdFilter && typeof ownerIdFilter === 'object' && 'in' in ownerIdFilter
          ? (ownerIdFilter.in as string[])
          : undefined;

  const from = q.from ? new Date(q.from) : undefined;
  const to = q.to ? new Date(q.to) : undefined;

  const effectiveRequestingUserId =
    q.userId && accessCtx.scopeLevel !== 'own' ? q.userId : userId;

  try {
    const result = await listInboundCalls({
      subCompanyIds: effectiveSubCompanyIds,
      userId: q.userId,
      ownerIds: inbox === 'all' || inbox === 'answered' ? ownerIds : undefined,
      outcome: q.outcome,
      page: q.page,
      limit: q.limit,
      from: from && !isNaN(from.getTime()) ? from : undefined,
      to: to && !isNaN(to.getTime()) ? to : undefined,
      inbox,
      ringGroupId: q.ringGroupId,
      voicemailBoxId: q.voicemailBoxId,
      requestingUserId: effectiveRequestingUserId,
      scopeLevel: accessCtx.scopeLevel,
      primarySubCompanyId,
    });

    return res.json(result);
  } catch (err) {
    if (err instanceof InboundAccessError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
  }
});

/** POST /phone-system/twilio/test-connection */
phoneSystemRouter.post('/twilio/test-connection', phoneWrite, async (req: Request, res: Response) => {
  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.body?.subCompanyId === 'string' ? req.body.subCompanyId : undefined,
  );
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  const result = await testAgencyTwilioConnection(subCompanyId);
  return res.json(result);
});

/** POST /phone-system/twilio/sync-numbers */
phoneSystemRouter.post('/twilio/sync-numbers', phoneWrite, async (req: Request, res: Response) => {
  const subCompanyId = await resolveTargetAgencyId(
    req,
    typeof req.body?.subCompanyId === 'string' ? req.body.subCompanyId : undefined,
  );
  if (!subCompanyId) {
    return res.status(403).json({ error: 'Agency context required' });
  }
  try {
    const result = await syncPhoneNumbersFromTwilio(subCompanyId);
    const bundle = await getPhoneSystemBundle(subCompanyId);
    return res.json({ ...result, bundle });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to sync numbers';
    return res.status(500).json({ error: message });
  }
});
