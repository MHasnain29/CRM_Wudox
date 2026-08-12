import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Phone, PhoneOff } from 'lucide-react';

interface IncomingCallDialogProps {
  fromNumber: string;
  toNumber?: string;
  callerName?: string;
  departmentLabel?: string;
  /** True when answering will hold the agent's current live inbound call. */
  callWaiting?: boolean;
  /** Outbound call blocks answering until it ends. */
  blockedByOutbound?: boolean;
  /** Agent already has active + held inbound calls. */
  blockedByDualCall?: boolean;
  /** True while connecting / holding for answer. */
  answering?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

/** Full-screen incoming ring UI — mount only while a call is pending (open is always true). */
export function IncomingCallDialog({
  fromNumber,
  toNumber,
  callerName,
  departmentLabel,
  callWaiting = false,
  blockedByOutbound = false,
  blockedByDualCall = false,
  answering = false,
  onAccept,
  onDecline,
}: IncomingCallDialogProps) {
  const answerBlocked = blockedByOutbound || blockedByDualCall || answering;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        className="sm:max-w-md z-[1000]"
        overlayClassName="z-[1000]"
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{callWaiting ? 'Call waiting' : 'Incoming call'}</DialogTitle>
          <DialogDescription>
            {blockedByOutbound
              ? 'End your outbound call before answering this inbound call.'
              : blockedByDualCall
                ? 'You already have two inbound calls. End or swap first before answering another.'
                : callWaiting
                  ? 'Answering will place your current caller on hold with music.'
                  : null}
            {!answerBlocked && callWaiting ? ' ' : ''}
            {departmentLabel ? `${departmentLabel} · ` : ''}
            {callerName || fromNumber}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center">
          <p className="text-2xl font-mono font-semibold">{fromNumber}</p>
          {callerName && callerName !== fromNumber && (
            <p className="text-sm text-muted-foreground mt-1">{callerName}</p>
          )}
          {toNumber && (
            <p className="text-sm text-muted-foreground mt-2">
              Called number: <span className="font-mono">{toNumber}</span>
            </p>
          )}
        </div>
        <DialogFooter className="flex gap-2 sm:justify-center">
          <Button variant="outline" onClick={onDecline} className="flex-1" disabled={answering}>
            <PhoneOff className="h-4 w-4 mr-2" />
            Decline
          </Button>
          <Button
            onClick={onAccept}
            disabled={answerBlocked}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            <Phone className="h-4 w-4 mr-2" />
            {answering ? 'Connecting...' : 'Answer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
