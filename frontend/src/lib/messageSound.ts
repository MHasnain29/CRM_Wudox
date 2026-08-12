let audioCtx: AudioContext | null = null;

/** Unlock audio on first user interaction (required by browsers). */
export function unlockMessageAudio(): void {
  if (audioCtx) return;
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (AudioCtx) audioCtx = new AudioCtx();
}

/** Short two-tone chime for incoming messages (no in-app notification). */
export async function playIncomingMessageSound(): Promise<void> {
  try {
    if (!audioCtx) unlockMessageAudio();
    const ctx = audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();

    [523, 784].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.35);
    });
  } catch {
    // ignore — audio not supported or blocked
  }
}
