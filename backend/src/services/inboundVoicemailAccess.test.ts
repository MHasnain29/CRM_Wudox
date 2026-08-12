import {
  buildInboundInboxWhere,
  InboundAccessError,
  type UserRingGroup,
} from './inboundVoicemailAccess';

const userRingGroups: UserRingGroup[] = [
  {
    id: 'group-a',
    name: 'Sales',
    voicemailBoxId: 'vm-box-a',
    voicemailBoxName: 'Sales VM',
  },
  {
    id: 'group-b',
    name: 'Recruiting',
    voicemailBoxId: null,
    voicemailBoxName: null,
  },
];

describe('buildInboundInboxWhere', () => {
  it('ring_group inbox OR-filters ringGroupId and fallback voicemailBoxId', () => {
    const where = buildInboundInboxWhere({
      inbox: 'ring_group',
      userId: 'user-1',
      scopeLevel: 'own',
      ringGroupId: 'group-a',
      userRingGroups,
    });

    expect(where).toEqual({
      OR: [{ ringGroupId: 'group-a' }, { voicemailBoxId: 'vm-box-a' }],
    });
  });

  it('ring_group inbox uses ringGroupId only when group has no mailbox', () => {
    const where = buildInboundInboxWhere({
      inbox: 'ring_group',
      userId: 'user-1',
      scopeLevel: 'own',
      ringGroupId: 'group-b',
      userRingGroups,
    });

    expect(where).toEqual({ ringGroupId: 'group-b' });
  });

  it('rejects ring_group inbox for non-member group', () => {
    expect(() =>
      buildInboundInboxWhere({
        inbox: 'ring_group',
        userId: 'user-1',
        scopeLevel: 'own',
        ringGroupId: 'unknown-group',
        userRingGroups,
      }),
    ).toThrow(InboundAccessError);
  });

  it('answered inbox filters calls the user answered', () => {
    const where = buildInboundInboxWhere({
      inbox: 'answered',
      userId: 'user-1',
      scopeLevel: 'own',
      userRingGroups,
    });

    expect(where).toEqual({
      answeredByUserId: 'user-1',
      outcome: 'answered',
    });
  });

  it('answered inbox shows all answered for team scope', () => {
    const where = buildInboundInboxWhere({
      inbox: 'answered',
      userId: 'user-1',
      scopeLevel: 'team',
      userRingGroups,
    });

    expect(where).toEqual({ outcome: 'answered' });
  });

  it('mine inbox filters personal calls only (no ring groups)', () => {
    const where = buildInboundInboxWhere({
      inbox: 'mine',
      userId: 'user-1',
      scopeLevel: 'own',
      userRingGroups,
    });

    expect(where).toEqual({
      ringGroupId: null,
      NOT: { voicemailBoxId: { in: ['vm-box-a'] } },
      OR: [
        { answeredByUserId: 'user-1' },
        { participants: { some: { userId: 'user-1' } } },
      ],
    });
  });
});
