import { cn } from '@/lib/utils';

/** Fullscreen builder shell (portaled to body). */
export const CALL_FLOW_FULLSCREEN_SHELL_Z = 'z-[300]';

/** Modals opened from the builder in fullscreen (dialogs, alert dialogs). */
export const CALL_FLOW_FULLSCREEN_MODAL_Z = 'z-[400]';

/** Popovers / selects portaled to body while fullscreen is active. */
export const CALL_FLOW_FULLSCREEN_POPOVER_Z = 'z-[450]';

export function callFlowPopoverClass(isFullscreen: boolean, className?: string) {
  return cn(isFullscreen && CALL_FLOW_FULLSCREEN_POPOVER_Z, className);
}
