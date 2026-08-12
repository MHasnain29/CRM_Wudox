import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Play, Pause, Headphones, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchCallStreamToken } from '@/lib/api';

interface CallRecordingPlayerProps {
  callId: string;
  fallbackDuration?: number;
  isActive: boolean;
  onPlay: (callId: string) => void;
  fetchStreamToken?: (callId: string, signal?: AbortSignal) => Promise<string | null>;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function CallRecordingPlayer({
  callId,
  fallbackDuration,
  isActive,
  onPlay,
  fetchStreamToken = fetchCallStreamToken,
}: CallRecordingPlayerProps) {
  const [isPlaying, setIsPlaying]   = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]     = useState(fallbackDuration ?? 0);
  const [hasError, setHasError]     = useState(false);

  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const rafRef       = useRef<number | null>(null);
  const streamUrlRef = useRef<string | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const mountedRef   = useRef(true);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── RAF progress loop ──────────────────────────────────────────────────────

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      setCurrentTime(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Deactivated by parent (another card started) ───────────────────────────

  useEffect(() => {
    if (!isActive) {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsFetching(false);
      if (audioRef.current) {
        audioRef.current.pause();
        stopLoop();
        setIsPlaying(false);
      }
    }
  }, [isActive, stopLoop]);

  // ── Unmount cleanup ────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      stopLoop();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, [stopLoop]);

  // ── Build Audio from stream URL ────────────────────────────────────────────

  const createAudio = useCallback((streamUrl: string): HTMLAudioElement => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = streamUrl;

    a.onloadedmetadata = () => {
      if (!mountedRef.current) return;
      if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
    };

    a.onended = () => {
      if (!mountedRef.current) return;
      stopLoop();
      setIsPlaying(false);
      setCurrentTime(0);
      a.onerror = null;
      a.src = '';
      audioRef.current = null;
      streamUrlRef.current = null;
    };

    a.onerror = () => {
      if (!mountedRef.current) return;
      stopLoop();
      setHasError(true);
      setIsPlaying(false);
      a.src = '';
      audioRef.current = null;
    };

    audioRef.current = a;
    return a;
  }, [stopLoop]);

  // ── Play / Pause ───────────────────────────────────────────────────────────

  const handleToggle = useCallback(async () => {
    if (hasError || isFetching) return;

    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        stopLoop();
        setIsPlaying(false);
      } else {
        onPlay(callId);
        audioRef.current.play().catch(() => {
          if (!mountedRef.current) return;
          setHasError(true);
          setIsPlaying(false);
          stopLoop();
        });
        startLoop();
        setIsPlaying(true);
      }
      return;
    }

    setIsFetching(true);
    onPlay(callId);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const streamUrl = streamUrlRef.current
        ?? await fetchStreamToken(callId, controller.signal);

      if (!mountedRef.current || controller.signal.aborted) {
        if (mountedRef.current) setIsFetching(false);
        return;
      }

      abortRef.current = null;

      if (!streamUrl) {
        setHasError(true);
        setIsFetching(false);
        return;
      }

      streamUrlRef.current = streamUrl;
      const a = createAudio(streamUrl);
      setIsFetching(false);

      a.play().catch(() => {
        if (!mountedRef.current) return;
        setHasError(true);
        setIsPlaying(false);
        stopLoop();
      });
      startLoop();
      setIsPlaying(true);
    } catch (err: any) {
      if (!mountedRef.current) return;
      if (err?.name === 'AbortError') {
        setIsFetching(false);
        return;
      }
      setHasError(true);
      setIsFetching(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [hasError, isFetching, isPlaying, callId, onPlay, createAudio, startLoop, stopLoop, fetchStreamToken]);

  // ── Seek ───────────────────────────────────────────────────────────────────

  const handleSeek = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a || !isFinite(a.duration) || a.duration === 0) return;
    const pct = Number(e.target.value);
    const newTime = (pct / 100) * a.duration;
    a.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mt-3 flex items-center gap-2 pl-10">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleToggle}
        disabled={hasError || isFetching}
        title={
          hasError   ? 'Recording unavailable' :
          isFetching ? 'Loading...' :
          isPlaying  ? 'Pause' : 'Play recording'
        }
      >
        {hasError ? (
          <Headphones className="h-3.5 w-3.5 text-destructive" />
        ) : isFetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : isPlaying ? (
          <Pause className="h-3.5 w-3.5 text-blue-500" />
        ) : (
          <Play className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </Button>

      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={progress}
        onChange={handleSeek}
        className="flex-1 h-1 accent-blue-500 cursor-pointer"
        aria-label="Seek recording"
      />

      <span className="text-xs text-muted-foreground tabular-nums w-24 text-right shrink-0">
        {hasError   ? 'Unavailable' :
         isFetching ? 'Loading...' :
         `${fmtTime(currentTime)} / ${fmtTime(duration)}`}
      </span>
    </div>
  );
}
