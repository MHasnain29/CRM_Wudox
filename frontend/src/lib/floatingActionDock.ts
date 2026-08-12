import { useCallStore } from '@/lib/callStore';

const DOCK_INSET_PX = 24;

/** Bottom-right: snip tool only. */
export function useFloatingActionDockLayout() {
  const outboundVisible = useCallStore(
    (s) => Boolean(s.activeCall && s.isMinimized && s.activeCall.status !== 'ended'),
  );

  return {
    snip: {
      bottomPx: DOCK_INSET_PX,
      right: 'right-6' as const,
    },
    outboundVisible,
  };
}

const LEFT_DOCK_GAP_PX = 12;
const OUTBOUND_FAB_HEIGHT_PX = 64;
const INBOUND_FAB_HEIGHT_PX = 64;

/**
 * Phone widgets on the left (past w-64 sidebar) so they stay visible beside the version footer.
 * Use inline `bottom` styles — dynamic Tailwind classes are not generated reliably.
 */
export function useAgentPhoneDockLayout() {
  const outboundVisible = useCallStore(
    (s) => Boolean(s.activeCall && s.isMinimized && s.activeCall.status !== 'ended'),
  );
  const inboundVisible = useCallStore((s) => Boolean(s.activeInboundCall));

  const left = 'left-72' as const;

  const outbound = {
    left,
    bottomPx: DOCK_INSET_PX,
  };

  const inboundBottomPx =
    DOCK_INSET_PX + (outboundVisible ? OUTBOUND_FAB_HEIGHT_PX + LEFT_DOCK_GAP_PX : 0);

  const inbound = {
    left,
    bottomPx: inboundBottomPx,
  };

  const agentBottomPx =
    inboundBottomPx + (inboundVisible ? INBOUND_FAB_HEIGHT_PX + LEFT_DOCK_GAP_PX : 0);

  const agent = {
    left,
    bottomPx: agentBottomPx,
  };

  return { agent, outbound, inbound, outboundVisible, inboundVisible };
}
