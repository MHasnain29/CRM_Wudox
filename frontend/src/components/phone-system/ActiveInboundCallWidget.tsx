import { useState } from 'react';
import { Phone, PhoneOff, Pause, Play, Mic, MicOff, Minimize2, PhoneIncoming, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCallStore } from '@/lib/callStore';
import { useAgentPhoneDockLayout } from '@/lib/floatingActionDock';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { WaitingCallersStack } from './WaitingCallersStack';

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export interface CallWaitingProps {
  fromNumber: string;
  toNumber?: string;
  callerName?: string;
  departmentLabel?: string;
  blockedByOutbound?: boolean;
  blockedByDualCall?: boolean;
  answering?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

function CallWaitingBanner({ callWaiting }: { callWaiting: CallWaitingProps }) {
  const answerBlocked =
    callWaiting.blockedByOutbound || callWaiting.blockedByDualCall || callWaiting.answering;
  const displayName = callWaiting.callerName || callWaiting.fromNumber;

  return (
    <div className="rounded-lg border border-blue-500/50 bg-blue-50 dark:bg-blue-950/40 px-3 py-2.5 space-y-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">Call waiting</p>
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{callWaiting.fromNumber}</p>
        {callWaiting.blockedByOutbound && (
          <p className="text-[10px] text-muted-foreground mt-1">End outbound call before answering.</p>
        )}
        {callWaiting.blockedByDualCall && (
          <p className="text-[10px] text-muted-foreground mt-1">You already have two inbound calls.</p>
        )}
        {!answerBlocked && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Answering will place your current caller on hold.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={callWaiting.onDecline}>
          <PhoneOff className="h-3.5 w-3.5 mr-1" />
          Decline
        </Button>
        <Button
          size="sm"
          className="flex-1 bg-green-600 hover:bg-green-700"
          disabled={answerBlocked}
          onClick={callWaiting.onAccept}
        >
          <Phone className="h-3.5 w-3.5 mr-1" />
          {callWaiting.answering ? 'Connecting...' : 'Answer'}
        </Button>
      </div>
    </div>
  );
}

interface ActiveInboundCallWidgetProps {
  callWaiting?: CallWaitingProps | null;
}

export function ActiveInboundCallWidget({ callWaiting = null }: ActiveInboundCallWidgetProps) {
  const {
    activeInboundCall,
    heldInboundCall,
    isInboundCallPanelOpen,
    inboundCallDuration,
    inboundOnHold,
    inboundMuted,
    maximizeInboundCall,
    minimizeInboundCall,
    muteCall,
    holdInboundCall,
    resumeInboundCall,
    endInboundCall,
    swapCalls,
    swapInProgress,
  } = useCallStore();

  const { inbound } = useAgentPhoneDockLayout();
  const [notes, setNotes] = useState('');
  const [isHovered, setIsHovered] = useState(false);

  if (!activeInboundCall) return null;

  const displayName = activeInboundCall.callerName || activeInboundCall.fromNumber;
  const statusColor = inboundOnHold ? 'bg-orange-500' : 'bg-green-500';
  const holdAvailable = Boolean(activeInboundCall.inboundCallId?.trim());
  // Always expand the panel while a call-waiting ring is pending so Answer/Decline is visible.
  const showExpandedPanel = isInboundCallPanelOpen || Boolean(callWaiting);

  if (showExpandedPanel) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className={cn('fixed z-[250] w-80', inbound.left)}
        style={{ bottom: inbound.bottomPx }}
      >
        <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className={cn('px-4 py-3 text-white', statusColor)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <PhoneIncoming className="h-5 w-5 shrink-0" />
                <span className="font-medium truncate">
                  {inboundOnHold ? 'On Hold' : 'Inbound Call'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-sm">{formatDuration(inboundCallDuration)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={minimizeInboundCall}
                  aria-label="Minimize to bubble"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {callWaiting && <CallWaitingBanner callWaiting={callWaiting} />}

            <div>
              <p className="font-medium truncate">{displayName}</p>
              <p className="text-sm text-muted-foreground font-mono truncate">
                {activeInboundCall.fromNumber}
              </p>
              {activeInboundCall.toNumber && (
                <p className="text-xs text-muted-foreground mt-1">
                  Called: <span className="font-mono">{activeInboundCall.toNumber}</span>
                </p>
              )}
              {activeInboundCall.departmentLabel && (
                <p className="text-xs text-muted-foreground mt-1">
                  {activeInboundCall.departmentLabel}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => muteCall(!inboundMuted)}
              >
                {inboundMuted ? (
                  <MicOff className="h-4 w-4 mr-1" />
                ) : (
                  <Mic className="h-4 w-4 mr-1" />
                )}
                {inboundMuted ? 'Unmute' : 'Mute'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={!holdAvailable}
                onClick={inboundOnHold ? resumeInboundCall : holdInboundCall}
              >
                {inboundOnHold ? (
                  <Play className="h-4 w-4 mr-1" />
                ) : (
                  <Pause className="h-4 w-4 mr-1" />
                )}
                {inboundOnHold ? 'Resume' : 'Hold'}
              </Button>
            </div>

            {heldInboundCall && (
              <div className="rounded-lg border border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-orange-800 dark:text-orange-200">
                      On hold
                    </p>
                    <p className="text-sm truncate">
                      {heldInboundCall.callerName || heldInboundCall.fromNumber}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={swapCalls}
                    disabled={swapInProgress}
                  >
                    <ArrowLeftRight className="h-4 w-4 mr-1" />
                    {swapInProgress ? 'Swapping...' : 'Swap'}
                  </Button>
                </div>
              </div>
            )}

            <WaitingCallersStack compact />

            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Call notes (session only)..."
                className="mt-1 min-h-[72px] resize-none text-sm"
              />
            </div>

            <Button
              variant="destructive"
              className="w-full"
              onClick={endInboundCall}
            >
              <PhoneOff className="h-4 w-4 mr-2" />
              End Call
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        className={cn('fixed z-[250]', inbound.left)}
        style={{ bottom: inbound.bottomPx }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-full left-0 mb-3 w-72"
            >
              <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
                <div className={cn('px-4 py-3 text-white', statusColor)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {inboundOnHold ? (
                        <Pause className="h-5 w-5" />
                      ) : (
                        <Phone className="h-5 w-5" />
                      )}
                      <span className="font-medium">
                        {inboundOnHold ? 'On Hold' : 'Inbound'}
                      </span>
                    </div>
                    <span className="font-mono text-sm">
                      {formatDuration(inboundCallDuration)}
                    </span>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {callWaiting && <CallWaitingBanner callWaiting={callWaiting} />}
                  <p className="font-medium truncate">{displayName}</p>                  <p className="text-sm text-muted-foreground font-mono truncate">
                    {activeInboundCall.fromNumber}
                  </p>
                  {activeInboundCall.toNumber && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Called: <span className="font-mono">{activeInboundCall.toNumber}</span>
                    </p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => muteCall(!inboundMuted)}
                    >
                      {inboundMuted ? (
                        <MicOff className="h-4 w-4 mr-1" />
                      ) : (
                        <Mic className="h-4 w-4 mr-1" />
                      )}
                      {inboundMuted ? 'Unmute' : 'Mute'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={!holdAvailable}
                      onClick={inboundOnHold ? resumeInboundCall : holdInboundCall}
                    >
                      {inboundOnHold ? (
                        <Play className="h-4 w-4 mr-1" />
                      ) : (
                        <Pause className="h-4 w-4 mr-1" />
                      )}
                      {inboundOnHold ? 'Resume' : 'Hold'}
                    </Button>
                  </div>
                  {heldInboundCall && (
                    <div className="mt-3 rounded-lg border border-orange-500/40 bg-orange-50 dark:bg-orange-950/30 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-orange-800 dark:text-orange-200">
                            Held caller
                          </p>
                          <p className="text-xs truncate">
                            {heldInboundCall.callerName || heldInboundCall.fromNumber}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={swapCalls}
                          disabled={swapInProgress}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
                          {swapInProgress ? '...' : 'Swap'}
                        </Button>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={maximizeInboundCall}
                    className="w-full mt-3 py-2 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Open Call Panel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          onClick={maximizeInboundCall}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'relative h-16 w-16 rounded-full shadow-lg flex items-center justify-center text-white transition-colors cursor-pointer',
            statusColor,
          )}
          aria-label={callWaiting ? 'Inbound call in progress — call waiting' : 'Inbound call in progress'}
        >
          {callWaiting && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 border-2 border-background" />
          )}
          {!inboundOnHold && (            <>
              <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-25" />
              <span className="absolute inset-0 rounded-full bg-green-500 animate-pulse opacity-50" />
            </>
          )}
          <div className="relative z-10 flex flex-col items-center">
            {inboundOnHold ? (
              <Pause className="h-5 w-5" />
            ) : inboundMuted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <PhoneIncoming className="h-5 w-5" />
            )}
            <span className="text-[10px] font-mono mt-0.5">
              {formatDuration(inboundCallDuration)}
            </span>
          </div>
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}
