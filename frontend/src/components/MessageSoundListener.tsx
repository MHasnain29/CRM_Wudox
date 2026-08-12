import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useStore } from '@/lib/store';
import { onMessageNew } from '@/lib/socket';
import { unlockMessageAudio, playIncomingMessageSound } from '@/lib/messageSound';

function messagePreview(text: string | null, attachmentNames: string[]): string | undefined {
  const trimmed = text?.trim();
  if (trimmed) return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
  if (attachmentNames.length > 0) return attachmentNames.join(', ');
  return undefined;
}

/**
 * Plays a sound and shows a short toast when the user receives a new chat message.
 * Separate from the CRM notification bell — not controlled by Settings → Notifications.
 */
export function MessageSoundListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const unlock = () => unlockMessageAudio();
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('touchstart', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  useEffect(() => {
    const unsub = onMessageNew((payload) => {
      const currentUserId = useStore.getState().currentUser?.id;
      if (!currentUserId || payload.message.senderId === currentUserId) return;
      // Call history rows are not chat toasts / message chimes
      if (payload.message.type === 'call') return;

      void playIncomingMessageSound();

      if (payload.playSoundOnly) return;

      const { senderName, text, attachments } = payload.message;
      const conversationId = payload.conversationId;
      toast(senderName, {
        description: messagePreview(text, attachments.map((a) => a.name)),
        duration: 5000,
        action: {
          label: 'View',
          onClick: () =>
            navigate(`/messages?conversation=${encodeURIComponent(conversationId)}`),
        },
      });
    });
    return unsub;
  }, [navigate]);

  return null;
}
