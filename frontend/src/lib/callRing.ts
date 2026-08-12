/**
 * Ringtone / dial tone for staff internal calls (Web Audio, no assets).
 */
import { unlockMessageAudio } from './messageSound';

let audioCtx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let dialTimer: ReturnType<typeof setInterval> | null = null;

function getCtx(): AudioContext | null {
  unlockMessageAudio();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!audioCtx && AudioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

async function resumeCtx(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') await ctx.resume();
}

function beep(freqs: number[], durationSec: number, gain = 0.18): void {
  const ctx = getCtx();
  if (!ctx) return;
  void resumeCtx(ctx);
  const now = ctx.currentTime;
  freqs.forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = freq;
    const t0 = now + i * 0.02;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + durationSec);
    o.start(t0);
    o.stop(t0 + durationSec);
  });
}

export function stopCallSounds(): void {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  if (dialTimer) {
    clearInterval(dialTimer);
    dialTimer = null;
  }
}

/** Looping dual-tone ring for incoming calls. */
export function startIncomingRing(): void {
  stopCallSounds();
  const play = () => beep([440, 480], 0.9, 0.22);
  play();
  ringTimer = setInterval(play, 2200);
}

/** Soft repeating dial tone while outgoing. */
export function startOutgoingDialTone(): void {
  stopCallSounds();
  const play = () => beep([350, 440], 0.45, 0.12);
  play();
  dialTimer = setInterval(play, 1600);
}
