import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Phone,
  PhoneOff,
  Pause,
  Play,
  Mic,
  MicOff,
  Minimize2,
  Delete,
  X,
} from 'lucide-react';
import { useCallStore } from '@/lib/callStore';
import { getVoiceConfig } from '@/lib/api';
import { placeEmployeeOutboundCall } from '@/lib/employeeVoiceApi';
import { toast } from 'sonner';

export type EmployeeCallParty = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
};

interface EmployeePhoneDialerProps {
  employee: EmployeeCallParty;
  subCompanyId?: string;
  onMinimize?: () => void;
  onEndCall?: () => void;
  onClose?: () => void;
}

export function EmployeePhoneDialer({
  employee,
  subCompanyId,
  onMinimize,
  onEndCall,
  onClose,
}: EmployeePhoneDialerProps) {
  const {
    activeCall,
    startEmployeeCall,
    endCall,
    holdCall,
    resumeCall,
    muteCall,
    outboundMuted,
    minimizeCall,
    sendDigits,
    initDevice,
    connectOutboundCall,
  } = useCallStore();

  const partyName = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';
  const [dialedNumber, setDialedNumber] = useState(employee.phone || '');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [outboundEnabled, setOutboundEnabled] = useState(false);
  const [outboundCallerId, setOutboundCallerId] = useState<string | null>(null);
  const [placingCall, setPlacingCall] = useState(false);
  const [dtmfSent, setDtmfSent] = useState('');

  useEffect(() => {
    setDialedNumber(employee.phone || '');
  }, [employee.id, employee.phone]);

  useEffect(() => {
    getVoiceConfig(subCompanyId).then((c) => {
      setVoiceEnabled(c.voiceEnabled);
      setOutboundEnabled(c.outboundEnabled);
      setOutboundCallerId(c.outboundCallerId);
      if (c.voiceEnabled) {
        void initDevice(subCompanyId);
      }
    });
  }, [subCompanyId, initDevice]);

  const isCallActive = activeCall && activeCall.status !== 'ended';

  const handleKeypadPress = (key: string) => {
    if (isCallActive) {
      sendDigits(key);
      setDtmfSent((prev) => prev + key);
    } else {
      setDialedNumber((prev) => prev + key);
    }
  };

  const handleBackspace = () => {
    if (isCallActive) {
      setDtmfSent((prev) => prev.slice(0, -1));
    } else {
      setDialedNumber((prev) => prev.slice(0, -1));
    }
  };

  const handleCall = async () => {
    const rawInput = (dialedNumber || employee.phone || '').trim();
    const hadPlus = rawInput.startsWith('+');
    const toNumber = rawInput.replace(/\D/g, '');

    if (!voiceEnabled) {
      toast.error('Twilio Voice is not configured for this agency. Set it up in Settings → Phone System.');
      return;
    }
    if (!outboundEnabled) {
      toast.error('Outbound calling is disabled for this agency. Enable it in Settings → Phone System.');
      return;
    }
    if (!outboundCallerId) {
      toast.error('Agency phone number not configured. Set it in Settings → Phone System → Number.');
      return;
    }
    if (!toNumber || toNumber.length < 10) {
      toast.error('Enter a valid phone number to place a call.');
      return;
    }

    let formattedNumber: string;
    if (hadPlus) {
      formattedNumber = `+${toNumber}`;
    } else if (toNumber.length === 10) {
      formattedNumber = `+1${toNumber}`;
    } else if (toNumber.length === 11 && toNumber.startsWith('1')) {
      formattedNumber = `+${toNumber}`;
    } else {
      toast.error('Enter the number in international format, e.g. +1…, +92…, +44…');
      return;
    }

    setPlacingCall(true);
    try {
      const { callId } = await placeEmployeeOutboundCall({
        to: formattedNumber,
        employeeId: employee.id,
        subCompanyId,
      });

      // Spread keeps the full employee object (when provided) so the floating
      // bubble can restore the details sheet after minimize.
      startEmployeeCall({ ...employee, phone: formattedNumber }, callId);
      await connectOutboundCall(formattedNumber, callId, subCompanyId);
      setDtmfSent('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to place call');
      endCall();
    } finally {
      setPlacingCall(false);
    }
  };

  const handleEndCall = () => {
    endCall();
    setDtmfSent('');
    onEndCall?.();
  };

  const handleMinimize = () => {
    minimizeCall();
    onMinimize?.();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = () => {
    if (!activeCall) return null;
    const compact = 'text-[10px] px-1.5 py-0 h-5';
    switch (activeCall.status) {
      case 'connecting':
        return <Badge className={`${compact} bg-yellow-500/10 text-yellow-500 border-yellow-500/20`}>Connecting</Badge>;
      case 'active':
        return <Badge className={`${compact} bg-green-500/10 text-green-500 border-green-500/20`}>Active</Badge>;
      case 'on_hold':
        return <Badge className={`${compact} bg-orange-500/10 text-orange-500 border-orange-500/20`}>On Hold</Badge>;
      case 'ended':
        return <Badge variant="secondary" className={compact}>Ended</Badge>;
      default:
        return null;
    }
  };

  const keypadButtons = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['*', '0', '#'],
  ];

  return (
    <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col h-full min-h-0 shrink-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Phone className="h-4 w-4 shrink-0" />
          <span className="font-semibold text-sm">Phone</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {activeCall && activeCall.status !== 'ended' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
              onClick={handleMinimize}
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="px-3 py-2 border-b border-white/10 shrink-0 space-y-1.5">
        <div className="text-xs font-medium truncate">{partyName}</div>
        {activeCall && activeCall.status !== 'ended' && (
          <div className="flex items-center justify-between gap-1 text-[11px]">
            {getStatusBadge()}
            <span className="font-mono text-white/80">{formatDuration(activeCall.duration)}</span>
          </div>
        )}
      </div>

      <div className={`flex-1 min-h-0 flex flex-col items-center justify-center px-3 py-2 gap-1.5 overflow-y-auto ${isCallActive ? 'py-1 gap-1' : ''}`}>
        <div className="w-full">
          <div className="bg-white/5 rounded-md px-2 py-1.5 text-center min-h-[32px] flex items-center justify-center">
            {isCallActive ? (
              <span className="text-sm font-mono tracking-wide text-green-400 truncate">
                {dtmfSent || '—'}
              </span>
            ) : (
              <span className="text-sm font-mono tracking-wide truncate">
                {dialedNumber || employee.phone || 'No number'}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 w-full max-w-[168px]">
          {keypadButtons.flat().map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleKeypadPress(key)}
              className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center text-sm font-medium transition-colors mx-auto"
            >
              {key}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleBackspace}
          className="text-white/50 hover:text-white p-0.5"
          aria-label="Delete digit"
        >
          <Delete className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 shrink-0 border-t border-white/10 bg-slate-900/90 space-y-1.5">
        {!outboundCallerId && voiceEnabled && (
          <p className="text-[10px] text-center text-amber-400/90 leading-tight">
            Set agency number in Settings → Phone System
          </p>
        )}
        {!activeCall || activeCall.status === 'ended' ? (
          <Button
            onClick={handleCall}
            disabled={!employee.phone || placingCall || (voiceEnabled && !outboundEnabled)}
            className="w-full h-9 rounded-full bg-green-500 hover:bg-green-600 text-white text-sm font-semibold"
          >
            {placingCall ? (
              'Placing call…'
            ) : (
              <>
                <Phone className="h-4 w-4 mr-1.5" />
                Call
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-1.5 min-w-0">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs bg-white/10 border-white/20 text-white hover:bg-white/20"
                onClick={() => (activeCall.status === 'on_hold' ? resumeCall() : holdCall())}
              >
                {activeCall.status === 'on_hold' ? (
                  <><Play className="h-3.5 w-3.5 mr-1" /> Resume</>
                ) : (
                  <><Pause className="h-3.5 w-3.5 mr-1" /> Hold</>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs bg-white/10 border-white/20 text-white hover:bg-white/20"
                onClick={() => muteCall(!outboundMuted)}
              >
                {outboundMuted ? (
                  <><MicOff className="h-3.5 w-3.5 mr-1" /> Unmute</>
                ) : (
                  <><Mic className="h-3.5 w-3.5 mr-1" /> Mute</>
                )}
              </Button>
            </div>
            <Button
              onClick={handleEndCall}
              className="w-full h-9 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-semibold"
            >
              <PhoneOff className="h-4 w-4 mr-1.5" />
              End Call
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
