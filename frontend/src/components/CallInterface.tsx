import { useState, useEffect } from 'react';
import { Client } from '@/lib/types';
import { useCallStore } from '@/lib/callStore';
import { CallEndDialog } from './CallEndDialog';
import { ClientDetailsSheet } from './ClientDetailsSheet';
import { PhoneDialer } from './PhoneDialer';
import { ScriptPanel } from './ScriptPanel';
import { updateCallSummary, logCall, addClientNote, createFollowUp, fetchCallById } from '@/lib/api';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';

interface FollowUpData {
  date: Date;
  time: string;
  contactId: string;
  notes: string;
}

interface CallInterfaceProps {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after call summary is saved with the client id so parent can refetch that client */
  onSummarySaved?: (clientId: string) => void;
}

function apiCallToStoreCall(api: { id: string; clientId: string; ownerId: string; ownerName: string; outcome: string; duration?: number; notes?: string; timestamp: string }): { id: string; clientId: string; ownerId: string; ownerName: string; outcome: 'answered' | 'no_answer' | 'voicemail' | 'busy'; duration?: number; notes: string; timestamp: Date } {
  return {
    id: api.id,
    clientId: api.clientId,
    ownerId: api.ownerId,
    ownerName: api.ownerName,
    outcome: api.outcome as 'answered' | 'no_answer' | 'voicemail' | 'busy',
    duration: api.duration,
    notes: api.notes ?? '',
    timestamp: new Date(api.timestamp),
  };
}

export function CallInterface({ client, open, onOpenChange, onSummarySaved }: CallInterfaceProps) {
  const { activeCall, closeCallInterface, minimizeCall } = useCallStore();
  const { addCall } = useStore();

  const [showEndDialog, setShowEndDialog] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);

  // Show summary dialog when remote party ends the call
  useEffect(() => {
    if (activeCall?.status === 'ended') {
      setShowEndDialog(true);
    }
  }, [activeCall?.status]);

  const handleMinimize = () => {
    minimizeCall();
    onOpenChange(false);
  };

  const handleEndCall = () => {
    setShowEndDialog(true);
  };

  const handleClose = () => {
    if (activeCall && activeCall.status !== 'ended') {
      handleMinimize();
    } else {
      closeCallInterface();
      onOpenChange(false);
    }
  };

  const outcome = (response: 'positive' | 'negative') => (response === 'positive' ? 'answered' : 'no_answer');

  const handleCallSummarySubmit = async (
    response: 'positive' | 'negative',
    comment: string,
    followUpData?: FollowUpData
  ) => {
    if (!activeCall) {
      closeCallInterface();
      onOpenChange(false);
      return;
    }

    setSavingSummary(true);
    try {
      const outcomeValue = outcome(response);

      if (activeCall.backendCallId) {
        await updateCallSummary(activeCall.backendCallId, {
          notes: comment || undefined,
          outcome: outcomeValue,
          duration: activeCall.duration,
          twilioCallSid: activeCall.twilioCallSid ?? undefined,
        });
        const updated = await fetchCallById(activeCall.backendCallId);
        if (updated) addCall(apiCallToStoreCall(updated));
      } else {
        const created = await logCall({
          clientId: client.id,
          outcome: outcomeValue,
          duration: activeCall.duration,
          notes: comment || undefined,
        });
        addCall(apiCallToStoreCall(created));
      }

      if (comment.trim()) {
        await addClientNote(client.id, {
          content: `📞 Call Summary (${response}): ${comment}`,
          isPublic: true,
        });
      }

      if (followUpData) {
        const followUpNotes = followUpData.notes?.trim() || comment?.trim() || `Follow-up from call with ${activeCall.contact?.name ?? 'contact'}`;
        await createFollowUp({
          clientId: client.id,
          contactId: followUpData.contactId,
          dueDate: followUpData.date.toISOString(),
          notes: followUpNotes,
        });
      }

      toast.success('Call summary and follow-up saved.');
      onSummarySaved?.(client.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save call summary');
      return;
    } finally {
      setSavingSummary(false);
    }

    closeCallInterface();
    onOpenChange(false);
  };

  return (
    <>
      {/* Client Details Sheet with Script Panel and Phone Dialer embedded */}
      <ClientDetailsSheet
        open={open}
        onOpenChange={handleClose}
        client={client}
        defaultTab="notes"
        phoneDialerSlot={
          <div className="flex h-full min-h-0 shrink-0">
            <ScriptPanel clientStatus={client.status} />
            <PhoneDialer
              client={client}
              onMinimize={handleMinimize}
              onEndCall={handleEndCall}
              onClose={handleClose}
            />
          </div>
        }
      />

      {/* Post-call summary dialog */}
      <CallEndDialog
        open={showEndDialog}
        onOpenChange={setShowEndDialog}
        clientName={client.name}
        contactName={activeCall?.contact?.name || ''}
        duration={activeCall?.duration || 0}
        contacts={client.contacts}
        onSubmit={handleCallSummarySubmit}
        isSubmitting={savingSummary}
      />
    </>
  );
}
