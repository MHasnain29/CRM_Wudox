import type { CallFlowGraph } from './callFlowRouter';
import {
  buildGatherDtmfTwiml,
  buildInboundTwiML,
  resolveConferenceNoAnswerTarget,
} from './twilioInboundTwiML';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    phoneNumber: { findFirst: jest.fn(), findMany: jest.fn() },
    phoneAgencyConfig: { findUnique: jest.fn() },
    phoneCallSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    inboundCall: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    inboundCallParticipant: { deleteMany: jest.fn(), createMany: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    phoneQueueEntry: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    agentPhonePresence: { findMany: jest.fn(), findUnique: jest.fn() },
    phoneConferenceLeg: { findMany: jest.fn(), findUnique: jest.fn() },
  },
}));

jest.mock('./agentPresence', () => ({
  orderRingableMembers: jest.fn(async (members: unknown[]) => members),
  filterMembersByInboundCapacity: jest.fn(async (members: unknown[]) => members),
}));

import { orderRingableMembers } from './agentPresence';

jest.mock('./conferenceBridge', () => ({
  appendCallerConference: jest.fn((vr: { dial: (opts?: unknown) => { conference: (a: unknown, b: string) => void } }) => {
    const dial = vr.dial({});
    dial.conference({}, 'conf-test');
  }),
  callerConferenceTwiml: jest.fn(() => '<Response></Response>'),
  conferenceRoomFor: jest.fn((id: string) => `conf-${id}`),
  ringAgentsIntoConference: jest.fn(async () => 1),
  handleInboundCallerRemoteHangup: jest.fn(),
}));

jest.mock('./callQueue', () => ({
  enqueueCaller: jest.fn(async () => ({ id: 'qe-1' })),
  queueNameFor: jest.fn(() => 'queue-1'),
  releaseByCallSid: jest.fn(),
}));

import prisma from '../config/database';
import { buildPrimaryCallFlowGraph } from './phoneSystemReferenceDefaults';
import { SYSTEM_CLIP_NAMES } from './phoneSystemSystemClips';

type PrismaMock = {
  phoneNumber: { findFirst: jest.Mock; findMany: jest.Mock };
  phoneAgencyConfig: { findUnique: jest.Mock };
  phoneCallSession: {
    findUnique: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
  };
  inboundCall: {
    upsert: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findUnique: jest.Mock;
  };
  user: { findMany: jest.Mock; findUnique: jest.Mock };
};

const prismaMock = prisma as unknown as PrismaMock;

const orderRingableMembersMock = orderRingableMembers as jest.MockedFunction<
  typeof orderRingableMembers
>;

const SUB_COMPANY_ID = 'sub-1';
const CALL_SID = 'CA-test-call';
const FROM = '+15551234567';
const TO = '+15559876543';
const WEBHOOK = 'https://api.example.com/api/v1/voice/webhook';

function defaultBundleFlow(): CallFlowGraph {
  return buildPrimaryCallFlowGraph({
    config: {
      gatherTimeoutSec: 5,
      greetingClipName: 'Greeting Options',
      allowExtensionDialing: true,
    },
    ringGroups: [
      {
        id: 'rg-1',
        extension: '1',
        name: 'Recruitment',
        dialTimeoutSec: 25,
        fallbackAction: 'voicemail',
        fallbackVoicemailBoxId: 'vm-1',
        fallbackForwardE164: '',
        members: [{ userId: 'user-1', userName: 'Agent One' }],
      },
    ],
    menuRoutes: [
      {
        key: 1,
        callerIdLabel: 'Recruitment',
        ringGroupId: 'rg-1',
        ringGroupName: 'Recruitment',
        dialTimeoutSec: 25,
        voicemailBoxId: 'vm-1',
        fallbackAction: 'voicemail',
        fallbackForwardE164: '',
      },
    ],
    audioClips: [
      {
        name: 'Greeting Options',
        scriptText: 'Thank you for calling. Press 1 for Recruitment.',
      },
      { name: SYSTEM_CLIP_NAMES.menuTimeout, scriptText: 'You did not enter a selection. Please try again.' },
      { name: 'Locations', scriptText: 'Our offices are open Monday through Friday.' },
      {
        name: SYSTEM_CLIP_NAMES.extensionNotFound,
        scriptText: 'Extension not found. Please try again.',
      },
      {
        name: SYSTEM_CLIP_NAMES.extensionNotAvailable,
        scriptText: 'That extension is not available. Returning to the main menu.',
      },
    ],
    staffExtensions: [{ userId: 'user-ext', userName: 'Ext User', extension: '105' }],
  });
}

function mockAgencyBundle(flow: CallFlowGraph, overrides?: { allowExtensionDialing?: boolean }) {
  const allowExtensionDialing = overrides?.allowExtensionDialing ?? true;
  prismaMock.phoneNumber.findFirst.mockResolvedValue({
    subCompanyId: SUB_COMPANY_ID,
    e164: TO,
  } as never);
  prismaMock.phoneAgencyConfig.findUnique.mockResolvedValue({
    inboundEnabled: true,
    outboundCallerId: TO,
    gatherTimeoutSec: 5,
    allowExtensionDialing,
    greetingClipName: 'Greeting Options',
    publishedFlow: flow,
    ringGroups: [
      {
        id: 'rg-1',
        name: 'Recruitment',
        extension: '1',
        dialTimeoutSec: 25,
        ringStrategy: 'simultaneous',
        fallbackAction: 'voicemail',
        fallbackVoicemailBoxId: 'vm-1',
        fallbackForwardE164: '',
        members: [{ userId: 'user-1', userName: 'Agent One' }],
      },
    ],
    voicemailBoxes: [{ id: 'vm-1', name: 'Recruitment VM', extension: '11' }],
    staffExtensions: [{ userId: 'user-ext', userName: 'Ext User', extension: '105' }],
    audioClips: [
      {
        name: 'Greeting Options',
        scriptText: 'Thank you for calling. Press 1 for Recruitment.',
      },
      {
        name: SYSTEM_CLIP_NAMES.menuTimeout,
        scriptText: 'You did not enter a selection. Please try again.',
      },
      { name: SYSTEM_CLIP_NAMES.goodbye, scriptText: 'Thank you for calling. Goodbye.' },
      { name: 'Locations', scriptText: 'Our offices are open Monday through Friday.' },
      {
        name: SYSTEM_CLIP_NAMES.extensionNotFound,
        scriptText: 'Extension not found. Please try again.',
      },
      {
        name: SYSTEM_CLIP_NAMES.extensionNotAvailable,
        scriptText: 'That extension is not available. Returning to the main menu.',
      },
    ],
    businessHours: [{ dayOfWeek: 1, enabled: true, open: '09:00', close: '17:00', label: 'Monday' }],
    timezone: 'America/Toronto',
  } as never);
}

describe('buildGatherDtmfTwiml', () => {
  it('uses finishOnKey=# when extension dialing is enabled', () => {
    const twiml = buildGatherDtmfTwiml(
      {
        inboundEnabled: true,
        outboundCallerId: TO,
        config: {
          gatherTimeoutSec: 5,
          allowExtensionDialing: true,
          greetingClipName: 'Greeting Options',
        },
        ringGroups: [],
        voicemailBoxes: [],
        staffExtensions: [],
        audioClips: [
          { name: 'Greeting Options', scriptText: 'Thank you for calling. Press 1 for Recruitment.' },
        ],
        businessHours: [],
        timezone: 'America/Toronto',
        publishedFlow: {
          version: 1,
          nodes: [{ id: 'ext-dial', type: 'connect_extension', data: { enabled: true } }],
          edges: [],
        },
      },
      { data: { timeoutSec: 5 } },
      WEBHOOK,
    );

    expect(twiml).toContain('<Gather');
    expect(twiml).toContain('finishOnKey="#"');
    expect(twiml).not.toContain('numDigits="1"');
    expect(twiml).toContain('Thank you for calling. Press 1 for Recruitment.');
    expect(twiml).not.toContain('<Redirect');
  });

  it('uses numDigits=1 when extension dialing is disabled', () => {
    const twiml = buildGatherDtmfTwiml(
      {
        inboundEnabled: true,
        outboundCallerId: TO,
        config: {
          gatherTimeoutSec: 5,
          allowExtensionDialing: false,
          greetingClipName: 'Greeting Options',
        },
        ringGroups: [],
        voicemailBoxes: [],
        staffExtensions: [],
        audioClips: [
          { name: 'Greeting Options', scriptText: 'Thank you for calling. Press 1 for Recruitment.' },
        ],
        businessHours: [],
        timezone: 'America/Toronto',
        publishedFlow: { version: 1, nodes: [], edges: [] },
      },
      { data: { timeoutSec: 5 } },
      WEBHOOK,
    );

    expect(twiml).toContain('numDigits="1"');
    expect(twiml).not.toContain('finishOnKey="#"');
  });

  it('plays uploaded greeting clip inside Gather when subCompanyId is provided', () => {
    const twiml = buildGatherDtmfTwiml(
      {
        inboundEnabled: true,
        outboundCallerId: TO,
        config: {
          gatherTimeoutSec: 5,
          allowExtensionDialing: false,
          greetingClipName: 'Custom greeting',
        },
        ringGroups: [],
        voicemailBoxes: [],
        staffExtensions: [],
        audioClips: [
          {
            id: 'ac-upload-1',
            name: 'Custom greeting',
            sourceType: 'upload',
            scriptText: '',
            r2Key: 'agencies/sub-1/clips/ac-upload-1.mp3',
          },
        ],
        businessHours: [],
        timezone: 'America/Toronto',
        publishedFlow: { version: 1, nodes: [], edges: [] },
      },
      { data: { timeoutSec: 5 } },
      WEBHOOK,
      undefined,
      undefined,
      SUB_COMPANY_ID,
    );

    expect(twiml).toContain('<Play>');
    expect(twiml).toContain('/phone-system/audio-clips/ac-upload-1/stream?t=');
    expect(twiml).not.toContain('<Say>');
  });
});

describe('resolveConferenceNoAnswerTarget', () => {
  it('prefers no answer edge, then busy', () => {
    const flow: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: 'branch-1', type: 'connect_group', data: { ringGroupId: 'rg-1' } },
        { id: 'fallback-1', type: 'connect_group', data: { isFallback: true } },
        { id: 'queue-1', type: 'connect_queue', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'branch-1', target: 'fallback-1', label: 'no answer' },
        { id: 'e2', source: 'branch-1', target: 'queue-1', label: 'busy' },
      ],
    };

    expect(resolveConferenceNoAnswerTarget(flow, 'branch-1')).toBe('fallback-1');
  });
});

describe('buildInboundTwiML', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.phoneCallSession.upsert.mockResolvedValue({} as never);
    prismaMock.phoneCallSession.update.mockResolvedValue({} as never);
    prismaMock.inboundCall.upsert.mockResolvedValue({ id: 'inbound-1' } as never);
    prismaMock.inboundCall.update.mockReturnValue({ catch: jest.fn() } as never);
    prismaMock.inboundCall.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user-1', email: 'agent@example.com' },
    ] as never);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-ext',
      email: 'ext@example.com',
    } as never);
  });

  it('routes conferenceNoAnswer to voicemail fallback instead of redialing connect_group', async () => {
    const flow = defaultBundleFlow();
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'branch-1',
      inboundCallId: 'inbound-1',
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO },
      WEBHOOK,
      { conferenceNoAnswer: '1', inboundCallId: 'inbound-1' },
    );

    expect(outcome).toBe('OK');
    expect(twiml).toContain('<Record');
    expect(twiml).not.toContain('conf-inbound-1');
  });

  it('follows gather timeout loop with retry clip and finishOnKey gather', async () => {
    const flow = defaultBundleFlow();
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'gather',
      inboundCallId: null,
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO },
      WEBHOOK,
    );

    expect(outcome).toBe('OK');
    expect(twiml).toContain('You did not enter a selection. Please try again.');
    expect(twiml).toContain('Thank you for calling. Press 1 for Recruitment.');
    expect(twiml).toContain('finishOnKey="#"');
    expect(twiml).not.toContain('numDigits="1"');
  });

  it('ends the call on gather timeout when timeoutBehavior is end', async () => {
    const flow = defaultBundleFlow();
    const gather = flow.nodes.find((n) => n.id === 'gather');
    if (gather) gather.data.timeoutBehavior = 'end';
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'gather',
      inboundCallId: null,
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO },
      WEBHOOK,
    );

    expect(outcome).toBe('OK');
    expect(twiml).toContain('Thank you for calling. Goodbye.');
    expect(twiml).toContain('<Hangup');
    expect(twiml).not.toContain('<Gather');
  });

  it('routes multi-digit extension 105 to connect_extension', async () => {
    orderRingableMembersMock.mockResolvedValueOnce([
      { userId: 'user-ext', userName: 'Ext User', email: 'ext@example.com' },
    ]);
    const flow = defaultBundleFlow();
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'gather',
      inboundCallId: null,
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO, Digits: '105' },
      WEBHOOK,
    );

    expect(outcome).toBe('OK');
    // Staff extension 105 → conference park (not menu voicemail Record)
    expect(twiml).toContain('<Conference');
    expect(twiml).not.toContain('<Record');
  });

  it('routes staff extension to queue when agent cannot be rung', async () => {
    orderRingableMembersMock.mockResolvedValueOnce([]);
    const flow = defaultBundleFlow();
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'gather',
      inboundCallId: 'inbound-1',
      metadata: {},
    } as never);
    prismaMock.inboundCall.upsert.mockResolvedValue({
      id: 'inbound-1',
      twilioCallSid: CALL_SID,
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO, Digits: '105' },
      WEBHOOK,
    );

    expect(outcome).toBe('OK');
    expect(twiml).toContain('<Enqueue');
    expect(twiml).not.toContain('<Conference');
  });

  it('routes conferenceNoAnswer on connect_extension through unavailable message', async () => {
    const flow = defaultBundleFlow();
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'ext-dial',
      inboundCallId: 'inbound-1',
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO },
      WEBHOOK,
      { conferenceNoAnswer: '1', inboundCallId: 'inbound-1' },
    );

    expect(outcome).toBe('OK');
    expect(twiml).toContain('That extension is not available');
    expect(twiml).toContain('<Gather');
  });

  it('routes unknown extension through not-found message once', async () => {
    const flow = defaultBundleFlow();
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'gather',
      inboundCallId: null,
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO, Digits: '999' },
      WEBHOOK,
    );

    expect(outcome).toBe('OK');
    const matches = twiml.match(/Extension not found/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(twiml).not.toContain('<Conference');
  });

  it('routes menu digit 2 to the matching branch', async () => {
    const flow = buildPrimaryCallFlowGraph({
      config: {
        gatherTimeoutSec: 5,
        greetingClipName: 'Greeting Options',
        allowExtensionDialing: true,
      },
      ringGroups: [
        {
          id: 'rg-2',
          extension: '2',
          name: 'Sales',
          dialTimeoutSec: 25,
          fallbackAction: 'voicemail',
          fallbackVoicemailBoxId: 'vm-2',
          fallbackForwardE164: '',
          members: [],
        },
      ],
      menuRoutes: [
        {
          key: 2,
          callerIdLabel: 'Sales',
          ringGroupId: 'rg-2',
          ringGroupName: 'Sales',
          dialTimeoutSec: 25,
          voicemailBoxId: 'vm-2',
          fallbackAction: 'voicemail',
          fallbackForwardE164: '',
        },
      ],
      audioClips: [
        { name: 'Greeting Options', scriptText: 'Press 2 for Sales.' },
      ],
      staffExtensions: [],
    });
    mockAgencyBundle(flow);

    prismaMock.phoneCallSession.findUnique.mockResolvedValue({
      callSid: CALL_SID,
      subCompanyId: SUB_COMPANY_ID,
      flowNodeId: 'gather',
      inboundCallId: null,
      metadata: {},
    } as never);

    const { twiml, outcome } = await buildInboundTwiML(
      { CallSid: CALL_SID, From: FROM, To: TO, Digits: '2' },
      WEBHOOK,
    );

    expect(outcome).toBe('OK');
    expect(twiml).toContain('<Record');
  });
});
