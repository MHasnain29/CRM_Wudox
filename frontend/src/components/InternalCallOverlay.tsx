import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useInternalCallStore } from '@/lib/internalCallStore';
import { unlockMessageAudio } from '@/lib/messageSound';
import { getSocket } from '@/lib/socket';

/**
 * Global overlay for staff↔staff WebRTC calls (incoming ring + in-call controls).
 * Mounted once in the app shell so calls work outside /messages.
 */
/**
 * Global overlay for staff↔staff WebRTC calls (incoming ring + in-call controls).
 * Mounted once in the app shell so calls work outside /messages.
 */
export function InternalCallOverlay() {
  const status = useInternalCallStore((s) => s.status);
  const peerName = useInternalCallStore((s) => s.peerName);
  const mediaType = useInternalCallStore((s) => s.mediaType);
  const muted = useInternalCallStore((s) => s.muted);
  const cameraOff = useInternalCallStore((s) => s.cameraOff);
  const localStream = useInternalCallStore((s) => s.localStream);
  const remoteStream = useInternalCallStore((s) => s.remoteStream);
  const accept = useInternalCallStore((s) => s.accept);
  const reject = useInternalCallStore((s) => s.reject);
  const cancel = useInternalCallStore((s) => s.cancel);
  const bindListeners = useInternalCallStore((s) => s.bindListeners);

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const unbind = bindListeners();
    getSocket();
    return unbind;
  }, [bindListeners]);

  useEffect(() => {
    const unlock = () => unlockMessageAudio();
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (status === 'idle') return null;

  const title = peerName ?? 'Colleague';
  const isVideo = mediaType === 'video';
  const initials =
    title
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?';

  const isRinging = status === 'incoming' || status === 'outgoing';
  const inMedia = status === 'connecting' || status === 'in_call';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-label="Internal call"
      aria-modal="true"
    >
      <div
        className={cn(
          'w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl',
          isVideo && inMedia && 'max-w-md',
        )}
      >
        {isRinging && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary text-lg text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm text-muted-foreground">
                {status === 'incoming'
                  ? `Incoming ${isVideo ? 'video' : 'audio'} call`
                  : `Calling${isVideo ? ' (video)' : ''}…`}
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">{title}</p>
            </div>
            {status === 'incoming' ? (
              <div className="flex w-full items-center gap-2">
                <Button className="flex-1 gap-2" onClick={() => void accept()}>
                  <Phone className="h-4 w-4" />
                  Accept
                </Button>
                <Button variant="destructive" className="flex-1 gap-2" onClick={reject}>
                  <PhoneOff className="h-4 w-4" />
                  Decline
                </Button>
              </div>
            ) : (
              <Button variant="destructive" className="w-full gap-2" onClick={cancel}>
                <PhoneOff className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        )}

        {inMedia && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                {status === 'connecting'
                  ? 'Connecting…'
                  : isVideo
                    ? 'Video call'
                    : 'Audio call'}
              </p>
              <p className="text-lg font-semibold text-foreground">{title}</p>
            </div>

            {isVideo && (
              <div className="relative aspect-video overflow-hidden rounded-md bg-muted">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute bottom-2 right-2 h-20 w-28 rounded border border-border bg-background object-cover"
                />
              </div>
            )}

            {!isVideo && <audio ref={remoteAudioRef} autoPlay />}

            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant={muted ? 'secondary' : 'outline'}
                className="gap-2 px-3"
                onClick={() => useInternalCallStore.getState().toggleMute()}
                aria-pressed={muted}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                <span className="text-xs">{muted ? 'Unmute' : 'Mute'}</span>
              </Button>
              {isVideo && (
                <Button
                  type="button"
                  variant={cameraOff ? 'secondary' : 'outline'}
                  size="icon"
                  onClick={() => useInternalCallStore.getState().toggleCamera()}
                  aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                >
                  {cameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => useInternalCallStore.getState().hangup()}
                aria-label="Hang up"
              >
                <PhoneOff className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
