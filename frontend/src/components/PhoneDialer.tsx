import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Client, ClientContact } from '@/lib/types';
import { useCallStore } from '@/lib/callStore';
import { getVoiceConfig, placeOutboundCall } from '@/lib/api';
import { toast } from 'sonner';

interface PhoneDialerProps {
  client: Client;
  onMinimize?: () => void;
  onEndCall?: () => void;
  onClose?: () => void;
}

export function PhoneDialer({ client, onMinimize, onEndCall, onClose }: PhoneDialerProps) {
  const {
    activeCall,
    startCall,
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

  const [selectedContact, setSelectedContact] = useState<ClientContact | null>(
    client.contacts.find(c => c.isPrimary) || client.contacts[0] || null
  );
  const [dialedNumber, setDialedNumber] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [outboundEnabled, setOutboundEnabled] = useState(false);
  const [outboundCallerId, setOutboundCallerId] = useState<string | null>(null);
  const [placingCall, setPlacingCall] = useState(false);
  const [dtmfSent, setDtmfSent] = useState('');

  useEffect(() => {
    const agencyId = client.subCompanyId;
    getVoiceConfig(agencyId).then((c) => {
      setVoiceEnabled(c.voiceEnabled);
      setOutboundEnabled(c.outboundEnabled);
      setOutboundCallerId(c.outboundCallerId);
      if (c.voiceEnabled) {
        void initDevice(agencyId);
      }
    });
  }, [client.subCompanyId, initDevice]);

  // Update dialed number when contact changes
  useEffect(() => {
    if (selectedContact) {
      setDialedNumber(selectedContact.phone);
    }
  }, [selectedContact]);

  const isCallActive = activeCall && activeCall.status !== 'ended';

  const handleKeypadPress = (key: string) => {
    if (isCallActive) {
      // During active call — send DTMF tone
      sendDigits(key);
      setDtmfSent(prev => prev + key);
    } else {
      // Before call — build phone number
      setDialedNumber(prev => prev + key);
    }
  };

  const handleBackspace = () => {
    if (isCallActive) {
      setDtmfSent(prev => prev.slice(0, -1));
    } else {
      setDialedNumber(prev => prev.slice(0, -1));
    }
  };

  const handleCall = async () => {
    if (!selectedContact) return;
    const rawInput = (dialedNumber || selectedContact.phone || '').trim();
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
      const { callId } = await placeOutboundCall({
        to: formattedNumber,
        clientId: client.id,
        subCompanyId: client.subCompanyId,
      });

      startCall(client, selectedContact, callId);
      await connectOutboundCall(formattedNumber, callId, client.subCompanyId);
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
      {/* Header */}
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

      {/* Contact + active-call status (compact) */}
      <div className="px-3 py-2 border-b border-white/10 shrink-0 space-y-1.5">
        <Select
          value={selectedContact?.id || ''}
          onValueChange={(id) => {
            const contact = client.contacts.find(c => c.id === id);
            setSelectedContact(contact || null);
          }}
          disabled={!!isCallActive}
        >
          <SelectTrigger className="h-8 text-xs bg-white/10 border-white/20 text-white">
            <SelectValue placeholder="Choose contact" />
          </SelectTrigger>
          <SelectContent>
            {client.contacts.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                <span className="text-xs">{contact.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeCall && activeCall.status !== 'ended' && (
          <div className="flex items-center justify-between gap-1 text-[11px]">
            {getStatusBadge()}
            <span className="font-mono text-white/80">{formatDuration(activeCall.duration)}</span>
          </div>
        )}
      </div>

      {/* Keypad */}
      <div className={`flex-1 min-h-0 flex flex-col items-center justify-center px-3 py-2 gap-1.5 overflow-y-auto ${isCallActive ? 'py-1 gap-1' : ''}`}>
        <div className="w-full">
          <div className="bg-white/5 rounded-md px-2 py-1.5 text-center min-h-[32px] flex items-center justify-center">
            {isCallActive ? (
              <span className="text-sm font-mono tracking-wide text-green-400 truncate">
                {dtmfSent || '—'}
              </span>
            ) : (
              <span className="text-sm font-mono tracking-wide truncate">
                {dialedNumber || selectedContact?.phone || 'No number'}
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

      {/* Actions */}
      <div className="px-3 py-2 shrink-0 border-t border-white/10 bg-slate-900/90 space-y-1.5">
        {!outboundCallerId && voiceEnabled && (
          <p className="text-[10px] text-center text-amber-400/90 leading-tight">
            Set agency number in Settings → Phone System
          </p>
        )}
        {!activeCall || activeCall.status === 'ended' ? (
          <Button
            onClick={handleCall}
            disabled={!selectedContact || placingCall || (voiceEnabled && !outboundEnabled)}
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
                onClick={() => muteCall(!outboundMuted)}
                variant="secondary"
                className="flex-1 min-w-0 h-9 rounded-full text-xs px-2"
                disabled={activeCall.status === 'connecting'}
              >
                {outboundMuted ? (
                  <MicOff className="h-3.5 w-3.5 shrink-0 mr-1" />
                ) : (
                  <Mic className="h-3.5 w-3.5 shrink-0 mr-1" />
                )}
                <span className="truncate">{outboundMuted ? 'Unmute' : 'Mute'}</span>
              </Button>
              {activeCall.status === 'on_hold' ? (
                <Button
                  onClick={resumeCall}
                  className="flex-1 min-w-0 h-9 rounded-full bg-green-500 hover:bg-green-600 text-xs px-2"
                >
                  <Play className="h-3.5 w-3.5 shrink-0 mr-1" />
                  <span className="truncate">Resume</span>
                </Button>
              ) : (
                <Button
                  onClick={holdCall}
                  variant="secondary"
                  className="flex-1 min-w-0 h-9 rounded-full text-xs px-2"
                  disabled={activeCall.status === 'connecting'}
                >
                  <Pause className="h-3.5 w-3.5 shrink-0 mr-1" />
                  <span className="truncate">Hold</span>
                </Button>
              )}
            </div>
            <Button
              onClick={handleEndCall}
              className="w-full h-9 rounded-full bg-red-500 hover:bg-red-600 text-sm font-semibold"
            >
              <PhoneOff className="h-4 w-4 mr-1.5 shrink-0" />
              End Call
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
