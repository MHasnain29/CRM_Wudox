/**
 * Pixel-perfect snip via browser tab capture (getDisplayMedia, displaySurface: 'browser').
 *
 * Trade-off: Chrome shows a "Sharing this tab" indicator while the cached stream is alive.
 * The bar is browser-mandated and cannot be suppressed from page JS — the cost of pixel fidelity.
 * To minimise friction we cache ONE stream per session and refresh it lazily.
 *
 * Lifecycle:
 *   1st snip in session  → permission prompt → cached stream → grabFrame → crop
 *   Nth snip             → grabFrame from cached stream (no prompt)
 *   5-min idle           → stream stopped, sharing bar disappears
 *   "Stop sharing" in Chrome bar → track 'ended' fires → cache cleared
 *   displaySurface !== 'browser' (user picked Window/Screen) → rejected + re-prompt
 */

type DisplayMediaStreamOptions = MediaStreamConstraints & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
};

function debugEnabled(): boolean {
  return typeof window !== 'undefined' && (window as unknown as { __SNIP_DEBUG__?: boolean }).__SNIP_DEBUG__ === true;
}

export interface ViewportSnapshot {
  /** Pixel-perfect frame of the visible tab content at capture time. */
  canvas: HTMLCanvasElement;
  /** Always 0 — tab capture is viewport-relative, no scroll offset for crop. */
  scrollX: number;
  scrollY: number;
  /** Viewport CSS dims — denominator for the derived scale in cropViewportSnapshot. */
  captureRoot: { scrollWidth: number; scrollHeight: number };
  /**
   * Canvas y-pixel where viewport content starts. Non-zero when the capture includes
   * browser chrome above the content (e.g. Safari capturing a 'window' surface instead
   * of a pure tab surface). Derived from the x-axis scale which is never chrome-corrupted.
   */
  originY: number;
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
let cachedStream: MediaStream | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

type SessionListener = (active: boolean) => void;
const sessionListeners = new Set<SessionListener>();

function notifyListeners(): void {
  const active = hasCachedTabCapture();
  sessionListeners.forEach((l) => l(active));
}

export function subscribeTabCaptureSession(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  listener(hasCachedTabCapture());
  return () => sessionListeners.delete(listener);
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function resetIdleTimer(): void {
  clearIdleTimer();
  idleTimer = setTimeout(() => releaseTabCapture(), IDLE_TIMEOUT_MS);
}

function getLiveTrack(): MediaStreamTrack | null {
  const track = cachedStream?.getVideoTracks()[0];
  if (track && track.readyState === 'live') return track;
  return null;
}

export function hasCachedTabCapture(): boolean {
  return getLiveTrack() !== null;
}

export function releaseTabCapture(): void {
  clearIdleTimer();
  cachedStream?.getTracks().forEach((t) => t.stop());
  cachedStream = null;
  notifyListeners();
}

/**
 * Acquire (or reuse) the per-session tab-capture stream.
 * Returns true if a live tab-surface stream is ready, false on denial / wrong-surface / API missing.
 */
export type TabCaptureFailReason = 'not_supported' | 'wrong_surface' | 'denied' | 'no_track';

export async function ensureTabCaptureStream(): Promise<true | TabCaptureFailReason> {
  if (getLiveTrack()) {
    resetIdleTimer();
    return true;
  }

  releaseTabCapture();

  if (!navigator.mediaDevices?.getDisplayMedia) return 'not_supported';

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  // Chrome-specific top-level options (preferCurrentTab etc.) cause Safari to throw.
  // Safari 17+ supports displaySurface:'browser' as a video constraint — use that
  // without the non-standard top-level props. Fall back to plain video:true if it
  // still throws (Safari < 17).
  const safariConstraints: DisplayMediaStreamOptions = {
    video: {
      displaySurface: 'browser',
      width: { ideal: 4096 },
      height: { ideal: 2160 },
    } as MediaTrackConstraints,
    audio: false,
  };

  const chromeConstraints: DisplayMediaStreamOptions = {
    video: {
      displaySurface: 'browser',
      width: { ideal: 4096 },
      height: { ideal: 2160 },
    } as MediaTrackConstraints,
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      isSafari ? safariConstraints : chromeConstraints,
    );
  } catch {
    if (isSafari) {
      // Safari < 17 may not support the displaySurface video constraint — retry plain.
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch (err2) {
        console.warn('[snip] getDisplayMedia failed (Safari fallback):', err2);
        return 'denied';
      }
    } else {
      return 'denied';
    }
  }

  try {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return 'no_track';
    }

    const settings = track.getSettings?.() as { displaySurface?: string } | undefined;
    const surface = settings?.displaySurface;
    console.log('[snip] displaySurface:', surface, '| isSafari:', isSafari);

    // Reject Screen on all browsers — crop math only works for tab-surface captures.
    // Also reject Window on Chrome (Chrome correctly distinguishes tab vs window).
    // Safari reports 'window' even for Tab captures — only reject 'monitor' there.
    // undefined = browser didn't report it (allow through).
    const isWrongSurface = surface === 'monitor' || (!isSafari && surface === 'window');
    if (isWrongSurface) {
      stream.getTracks().forEach((t) => t.stop());
      return 'wrong_surface';
    }

    track.addEventListener('ended', releaseTabCapture);
    cachedStream = stream;
    resetIdleTimer();
    notifyListeners();
    return true;
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    console.warn('[snip] post-stream setup failed:', err);
    return 'denied';
  }
}

async function grabFrameFromTrack(track: MediaStreamTrack): Promise<HTMLCanvasElement | null> {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  // Safari's ImageCapture.grabFrame() throws "A MediaStreamTrack ended due to a capture
  // failure" when used with getDisplayMedia tracks — skip it and use the video fallback.
  const ImageCaptureCtor = !isSafari
    ? (window as unknown as {
        ImageCapture?: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> };
      }).ImageCapture
    : undefined;

  if (ImageCaptureCtor) {
    const capture = new ImageCaptureCtor(track);
    const bitmap = await capture.grabFrame();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  // Video element fallback — required for Safari (and older browsers).
  // Safari needs the video element attached to the DOM to play display-media streams.
  const video = document.createElement('video');
  video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.playsInline = true;
  document.body.appendChild(video);
  try {
    await video.play();
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= 2) return resolve();
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video load failed'));
    });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas;
  } finally {
    video.pause();
    video.srcObject = null;
    document.body.removeChild(video);
  }
}

async function waitForNextPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Pixel-perfect capture of the current viewport via the cached tab-capture stream.
 * Assumes ensureTabCaptureStream() has already resolved true for this session.
 * Returns null if the cached stream died (user clicked "Stop sharing" mid-snip).
 *
 * Caller (SnipRegionOverlay) is expected to hide the snip overlay UI via state change
 * BEFORE awaiting this — the internal `waitForNextPaint` gives the browser one composite
 * cycle to paint the page without the overlay, so the captured frame is clean.
 */
export async function captureViewportSnapshot(): Promise<ViewportSnapshot | null> {
  const track = getLiveTrack();
  if (!track) return null;

  await waitForNextPaint();

  const canvas = await grabFrameFromTrack(track);
  if (!canvas || canvas.width < 2 || canvas.height < 2) return null;

  resetIdleTimer();

  // Derive uniform scale from the x-axis (never corrupted by top chrome).
  // If the canvas is taller than viewport×scale, the excess is browser chrome pixels
  // at the top (Safari capturing 'window' surface includes tab strip + address bar).
  const uniformScale = canvas.width / window.innerWidth;
  const originY = Math.max(0, Math.round(canvas.height - window.innerHeight * uniformScale));

  const snapshot: ViewportSnapshot = {
    canvas,
    scrollX: 0,
    scrollY: 0,
    originY,
    captureRoot: {
      scrollWidth: window.innerWidth,
      scrollHeight: window.innerHeight,
    },
  };

  if (debugEnabled()) dumpFullCanvasToTab(canvas, snapshot);

  return snapshot;
}

function dumpFullCanvasToTab(canvas: HTMLCanvasElement, meta: ViewportSnapshot): void {
  try {
    const url = canvas.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (!win) {
      console.warn('[snip] popup blocked — could not open debug tab.');
      return;
    }
    win.document.title = 'snip-full-capture';
    win.document.body.style.cssText = 'background:#222;margin:0;padding:16px;color:#eee;font-family:system-ui,sans-serif;font-size:13px';
    win.document.body.innerHTML = `
      <div style="margin-bottom:12px;line-height:1.6">
        <strong>Pixel-perfect tab capture</strong><br/>
        Canvas: ${canvas.width} × ${canvas.height} px ·
        Viewport: ${meta.captureRoot.scrollWidth} × ${meta.captureRoot.scrollHeight} CSS px ·
        devicePixelRatio: ${window.devicePixelRatio} ·
        derived scale: ${(canvas.width / meta.captureRoot.scrollWidth).toFixed(3)} ×
        ${(canvas.height / meta.captureRoot.scrollHeight).toFixed(3)}
      </div>
      <a href="${url}" download="snip-full-capture.png" style="color:#7cf;display:inline-block;margin-bottom:12px">Download PNG</a>
      <div style="border:1px solid #555;display:inline-block;max-width:100%">
        <img src="${url}" style="display:block;max-width:100%;height:auto" />
      </div>
    `;
  } catch (e) {
    console.warn('[snip] failed to dump full canvas', e);
  }
}

/**
 * Crop a viewport-coords selection out of the captured frame.
 * Scale is DERIVED from canvas/viewport ratio — handles DPR, browser zoom, and any encoder
 * scaling automatically. No hardcoded devicePixelRatio.
 */
export function cropViewportSnapshot(
  snapshot: ViewportSnapshot,
  selection: { x: number; y: number; width: number; height: number },
): string | null {
  const { canvas, scrollX, scrollY, captureRoot, originY } = snapshot;

  if (selection.width < 4 || selection.height < 4) return null;

  // Use the x-axis scale for both dimensions — it's derived from the clean dimension
  // (no horizontal chrome). originY corrects for top chrome (Safari window captures).
  const scale = canvas.width / captureRoot.scrollWidth;

  const pageX = selection.x + scrollX;
  const pageY = selection.y + scrollY;

  let sx = Math.round(pageX * scale);
  let sy = Math.round(originY + pageY * scale);
  let sw = Math.round(selection.width * scale);
  let sh = Math.round(selection.height * scale);

  sx = Math.max(0, Math.min(sx, canvas.width - 1));
  sy = Math.max(0, Math.min(sy, canvas.height - 1));
  sw = Math.max(1, Math.min(sw, canvas.width - sx));
  sh = Math.max(1, Math.min(sh, canvas.height - sy));
  if (sw < 4 || sh < 4) return null;

  if (debugEnabled()) {
    console.log('[snip] crop pipeline', {
      rawSelection: selection,
      scrollX,
      scrollY,
      originY,
      devicePixelRatio: window.devicePixelRatio,
      captureRoot,
      canvas: { width: canvas.width, height: canvas.height },
      scale,
      pageCoords: { pageX, pageY },
      canvasCoords: { sx, sy, sw, sh },
    });
  }

  const cropped = document.createElement('canvas');
  cropped.width = sw;
  cropped.height = sh;
  const ctx = cropped.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return cropped.toDataURL('image/png');
}

/** Bug report flow: pixel-perfect viewport capture via tab capture. */
export async function captureScreenWithFallback(): Promise<{ dataUrl: string; usedFallback: boolean }> {
  const ok = await ensureTabCaptureStream();
  if (!ok) throw new Error('Tab capture denied');
  const snapshot = await captureViewportSnapshot();
  if (!snapshot) throw new Error('Failed to capture screen');
  return { dataUrl: snapshot.canvas.toDataURL('image/png'), usedFallback: false };
}

export interface ImageDisplayBounds {
  offsetX: number;
  offsetY: number;
  displayWidth: number;
  displayHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

export async function cropImageDataUrl(
  dataUrl: string,
  selection: { x: number; y: number; width: number; height: number },
  bounds: ImageDisplayBounds,
): Promise<string | null> {
  const { offsetX, offsetY, displayWidth, displayHeight, naturalWidth, naturalHeight } = bounds;
  if (displayWidth <= 0 || displayHeight <= 0 || selection.width < 2 || selection.height < 2) return null;

  const scaleX = naturalWidth / displayWidth;
  const scaleY = naturalHeight / displayHeight;

  const sx = Math.max(0, Math.round((selection.x - offsetX) * scaleX));
  const sy = Math.max(0, Math.round((selection.y - offsetY) * scaleY));
  const sw = Math.min(naturalWidth - sx, Math.round(selection.width * scaleX));
  const sh = Math.min(naturalHeight - sy, Math.round(selection.height * scaleY));
  if (sw < 2 || sh < 2) return null;

  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1] || 'image/png', base64: match[2] };
}
