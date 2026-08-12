import { useEffect } from 'react';
import { useCallStore } from '@/lib/callStore';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { getVoiceConfig } from '@/lib/api';
import { resolveAgencyIdForApi } from '@/lib/resolveAgencyId';
import { onVoiceCallEnded } from '@/lib/socket';
import { IncomingCallDialog } from './IncomingCallDialog';
import { ActiveInboundCallWidget } from './ActiveInboundCallWidget';
import { AgentPhonePanel } from './AgentPhonePanel';

/**
 * Registers Twilio Voice Device for agents and shows Answer/Decline for live inbound PSTN calls.
 */
export function InboundCallRoot() {
  const user = useAuthStore((s) => s.user);
  const subCompanies = useStore((s) => s.subCompanies);
  const currentSubCompanyId = useStore((s) => s.currentSubCompany?.id);
  const viewedSubCompanyId = useStore((s) => s.viewedSubCompanyId);
  const agencyId = resolveAgencyIdForApi(subCompanies, {
    currentId: currentSubCompanyId,
    viewedId: viewedSubCompanyId,
  });
  const pendingInboundCall = useCallStore((s) => s.pendingInboundCall);
  const activeInboundCall = useCallStore((s) => s.activeInboundCall);
  const heldInboundCall = useCallStore((s) => s.heldInboundCall);
  const activeCall = useCallStore((s) => s.activeCall);
  const acceptInboundCall = useCallStore((s) => s.acceptInboundCall);
  const answerSecondCall = useCallStore((s) => s.answerSecondCall);
  const rejectInboundCall = useCallStore((s) => s.rejectInboundCall);
  const initDevice = useCallStore((s) => s.initDevice);
  const handleRemotePartyHangup = useCallStore((s) => s.handleRemotePartyHangup);
  const swapInProgress = useCallStore((s) => s.swapInProgress);
  const hasActiveInbound = Boolean(activeInboundCall);
  const isCallWaitingRing = Boolean(pendingInboundCall && hasActiveInbound && !heldInboundCall);
  const showFirstCallModal = Boolean(pendingInboundCall && !hasActiveInbound);
  const blockedByDualCall = Boolean(activeInboundCall && heldInboundCall);
  const blockedByOutbound = Boolean(
    activeCall && activeCall.status !== 'ended' && activeCall.status !== 'connecting',
  );

  useEffect(() => {
    if (!user?.id) return;
    getVoiceConfig(agencyId)
      .then((c) => {
        if (c.voiceEnabled) {
          void initDevice(agencyId);
        }
      })
      .catch(() => undefined);
  }, [user?.id, agencyId, initDevice]);

  useEffect(() => {
    if (!user?.id) return;
    return onVoiceCallEnded((payload) => {
      handleRemotePartyHangup(payload);
    });
  }, [user?.id, handleRemotePartyHangup]);

  if (!user) return null;

  return (
    <>
      {showFirstCallModal && pendingInboundCall && (
        <IncomingCallDialog
          fromNumber={pendingInboundCall.fromNumber}
          toNumber={pendingInboundCall.toNumber}
          callerName={pendingInboundCall.callerName}
          departmentLabel={pendingInboundCall.departmentLabel}
          callWaiting={false}
          blockedByDualCall={blockedByDualCall}
          blockedByOutbound={blockedByOutbound}
          answering={swapInProgress}
          onAccept={() => {
            if (blockedByOutbound || blockedByDualCall || swapInProgress) return;
            acceptInboundCall();
          }}
          onDecline={rejectInboundCall}
        />
      )}
      <ActiveInboundCallWidget
        callWaiting={
          isCallWaitingRing && pendingInboundCall
            ? {
                fromNumber: pendingInboundCall.fromNumber,
                toNumber: pendingInboundCall.toNumber,
                callerName: pendingInboundCall.callerName,
                departmentLabel: pendingInboundCall.departmentLabel,
                blockedByOutbound,
                blockedByDualCall,
                answering: swapInProgress,
                onAccept: () => {
                  if (blockedByOutbound || blockedByDualCall || swapInProgress) return;
                  void answerSecondCall();
                },
                onDecline: rejectInboundCall,
              }
            : null
        }
      />
      <AgentPhonePanel />
    </>
  );
}
