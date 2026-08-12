import { AgentPresenceStatus, PhoneConferenceLegStatus, type AgentPhonePresence } from '@prisma/client';
import {
  computeCanAcceptRing,
  computeEffectiveStatus,
  getAgentInboundCapacity,
  getInboundCapacityForUsers,
} from './agentPresence';

jest.mock('../config/database', () => ({
  __esModule: true,
  default: {
    agentPhonePresence: { findMany: jest.fn() },
    phoneConferenceLeg: { findMany: jest.fn(), updateMany: jest.fn() },
  },
}));

import prisma from '../config/database';

const prismaMock = prisma as unknown as {
  agentPhonePresence: { findMany: jest.Mock };
  phoneConferenceLeg: { findMany: jest.Mock; updateMany: jest.Mock };
};

function presence(overrides: Partial<AgentPhonePresence>): AgentPhonePresence {
  return {
    userId: 'u1',
    subCompanyId: null,
    manualStatus: null,
    activeCallCount: 0,
    lastCallEndedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('computeEffectiveStatus', () => {
  it('defaults to available when no presence row exists', () => {
    expect(computeEffectiveStatus(null)).toBe(AgentPresenceStatus.available);
  });

  it('is available with no manual status and no active calls', () => {
    expect(computeEffectiveStatus(presence({}))).toBe(AgentPresenceStatus.available);
  });

  it('is busy when the agent has one or more active calls', () => {
    expect(computeEffectiveStatus(presence({ activeCallCount: 1 }))).toBe(AgentPresenceStatus.busy);
  });

  it('manual status overrides auto-busy', () => {
    expect(
      computeEffectiveStatus(presence({ activeCallCount: 2, manualStatus: AgentPresenceStatus.away })),
    ).toBe(AgentPresenceStatus.away);
  });

  it('manual available wins even while on a call', () => {
    expect(
      computeEffectiveStatus(
        presence({ activeCallCount: 1, manualStatus: AgentPresenceStatus.available }),
      ),
    ).toBe(AgentPresenceStatus.available);
  });
});

describe('computeCanAcceptRing', () => {
  it('allows ring when agent has no joined or ringing legs', () => {
    expect(computeCanAcceptRing(0, 0)).toBe(true);
  });

  it('allows call-waiting ring when on one joined call and no pending ring', () => {
    expect(computeCanAcceptRing(1, 0)).toBe(true);
  });

  it('blocks when on one joined call and already ringing a second', () => {
    expect(computeCanAcceptRing(1, 1)).toBe(false);
  });

  it('blocks when two calls are already joined', () => {
    expect(computeCanAcceptRing(2, 0)).toBe(false);
  });
});

describe('getInboundCapacityForUsers', () => {
  beforeEach(() => {
    prismaMock.agentPhonePresence.findMany.mockReset();
    prismaMock.phoneConferenceLeg.findMany.mockReset();
    prismaMock.phoneConferenceLeg.updateMany.mockReset();
    prismaMock.phoneConferenceLeg.updateMany.mockResolvedValue({ count: 0 });
  });

  it('combines presence rows with conference leg counts', async () => {
    prismaMock.agentPhonePresence.findMany.mockResolvedValue([
      { userId: 'u1', activeCallCount: 1, manualStatus: null, subCompanyId: null, lastCallEndedAt: null, updatedAt: new Date() },
    ]);
    prismaMock.phoneConferenceLeg.findMany.mockResolvedValue([
      { userId: 'u1', status: PhoneConferenceLegStatus.joined, createdAt: new Date(), agentCallSid: 'CA-joined' },
      { userId: 'u1', status: PhoneConferenceLegStatus.ringing, createdAt: new Date(), agentCallSid: 'CA-ring' },
    ]);

    const map = await getInboundCapacityForUsers(['u1']);
    const cap = map.get('u1');
    expect(cap).toMatchObject({
      activeCallCount: 1,
      joinedLegs: 1,
      ringingLegs: 1,
      canAcceptRing: false,
      canPickupFromQueue: false,
    });
  });

  it('ignores stale ringing legs so call waiting can proceed', async () => {
    prismaMock.agentPhonePresence.findMany.mockResolvedValue([
      { userId: 'u1', activeCallCount: 1, manualStatus: null, subCompanyId: null, lastCallEndedAt: null, updatedAt: new Date() },
    ]);
    const stale = new Date(Date.now() - 60_000);
    prismaMock.phoneConferenceLeg.findMany.mockResolvedValue([
      { userId: 'u1', status: PhoneConferenceLegStatus.joined, createdAt: new Date(), agentCallSid: 'CA-joined' },
      { userId: 'u1', status: PhoneConferenceLegStatus.ringing, createdAt: stale, agentCallSid: 'CA-stale' },
    ]);

    const map = await getInboundCapacityForUsers(['u1']);
    const cap = map.get('u1');
    expect(cap).toMatchObject({
      joinedLegs: 1,
      ringingLegs: 0,
      canAcceptRing: true,
      canPickupFromQueue: true,
    });
    expect(prismaMock.phoneConferenceLeg.updateMany).toHaveBeenCalled();
  });
});

describe('getAgentInboundCapacity', () => {
  beforeEach(() => {
    prismaMock.agentPhonePresence.findMany.mockReset();
    prismaMock.phoneConferenceLeg.findMany.mockReset();
    prismaMock.phoneConferenceLeg.updateMany.mockReset();
    prismaMock.phoneConferenceLeg.updateMany.mockResolvedValue({ count: 0 });
  });

  it('defaults to accepting rings when no presence or legs exist', async () => {
    prismaMock.agentPhonePresence.findMany.mockResolvedValue([]);
    prismaMock.phoneConferenceLeg.findMany.mockResolvedValue([]);

    const cap = await getAgentInboundCapacity('u-new');
    expect(cap.canAcceptRing).toBe(true);
    expect(cap.canPickupFromQueue).toBe(true);
  });
});
