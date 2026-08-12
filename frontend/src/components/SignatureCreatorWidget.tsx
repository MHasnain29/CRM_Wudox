import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2, Upload, ImageIcon } from 'lucide-react';

const SIGNATURE_FONTS = [
  { id: 'dancing-script', label: 'Classic', family: "'Dancing Script', cursive" },
  { id: 'lobster', label: 'Bold', family: "'Lobster', cursive" },
  { id: 'caveat', label: 'Handwritten', family: "'Caveat', cursive" },
  { id: 'cormorant-garamond', label: 'Formal', family: "'Cormorant Garamond', serif" },
];

const FONT_LOAD_URL =
  'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Lobster&family=Caveat:wght@600&family=Cormorant+Garamond:ital,wght@1,600&display=swap';

// Normalised canvas dimensions — all three modes output at this size
const CANVAS_W = 560;
const CANVAS_H = 140;

let fontsInjected = false;
function ensureFontsLoaded() {
  if (fontsInjected) return;
  fontsInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_LOAD_URL;
  document.head.appendChild(link);
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function escapeXml(text: string) {
  return text.replace(/[&<>"]/g, (c) => XML_ESCAPES[c]);
}

function buildSvg(text: string, fontFamily: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80"><defs><style>@import url('${FONT_LOAD_URL}');</style></defs><text x="50%" y="58" text-anchor="middle" font-family="${fontFamily}" font-size="36" fill="#1a1a1a">${escapeXml(text)}</text></svg>`;
}

// Draws an image onto a fixed canvas (CANVAS_W × CANVAS_H), centred and
// scaled to fit, preserving aspect ratio. Returns a PNG data URL.
function normaliseImageToDataUrl(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.min(CANVAS_W / img.naturalWidth, CANVAS_H / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}

type Mode = 'type' | 'draw' | 'upload';

type Props = {
  initialName?: string;
  initialFontFamily?: string;
  onSave: (data: { name: string; signatureData: string; fontFamily: string }) => Promise<void>;
  onCancel: () => void;
  title?: string;
};

export function SignatureCreatorWidget({ initialName = '', initialFontFamily, onSave, onCancel, title = 'New Signing Authority' }: Props) {
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState<Mode>('type');
  const [selectedFont, setSelectedFont] = useState(
    SIGNATURE_FONTS.find((f) => f.family === initialFontFamily) ?? SIGNATURE_FONTS[0],
  );
  const [saving, setSaving] = useState(false);

  // Draw state
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  // Upload state
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { ensureFontsLoaded(); }, []);

  // ── Draw helpers ──────────────────────────────────────────────────────────

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    isDrawingRef.current = true;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (!hasDrawn) setHasDrawn(true);
  }

  function stopDraw() { isDrawingRef.current = false; }

  function clearCanvas() {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setHasDrawn(false);
  }

  // ── Upload helper ─────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      const img = new Image();
      img.onload = () => setUploadedDataUrl(normaliseImageToDataUrl(img));
      img.src = src;
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be re-selected after clearing
    e.target.value = '';
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    let signatureData: string;
    let fontFamily: string;

    if (mode === 'draw') {
      if (!hasDrawn || !canvasRef.current) return;
      signatureData = canvasRef.current.toDataURL('image/png');
      fontFamily = 'drawn';
    } else if (mode === 'upload') {
      if (!uploadedDataUrl) return;
      signatureData = uploadedDataUrl;
      fontFamily = 'drawn'; // same rendering path as hand-drawn
    } else {
      // Draw text directly to canvas — avoids cross-origin SVG/font restrictions that cause
      // canvas.toDataURL() to fail when the SVG imports Google Fonts externally.
      await document.fonts.ready;
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.font = `italic 500 38px ${selectedFont.family}, cursive`;
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(trimmed, CANVAS_W / 2, CANVAS_H * 0.68);
      signatureData = canvas.toDataURL('image/png');
      fontFamily = selectedFont.family;
    }

    setSaving(true);
    try {
      await onSave({ name: trimmed, signatureData, fontFamily });
    } finally {
      setSaving(false);
    }
  }

  const canSave =
    name.trim().length > 0 &&
    (mode === 'type' || (mode === 'draw' && hasDrawn) || (mode === 'upload' && !!uploadedDataUrl));

  const MODES: { key: Mode; label: string }[] = [
    { key: 'type', label: 'Type' },
    { key: 'draw', label: 'Draw' },
    { key: 'upload', label: 'Upload' },
  ];

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b">
        <p className="text-sm font-semibold">{title}</p>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="sig-name" className="text-sm">Name</Label>
          <Input
            id="sig-name"
            autoFocus
            placeholder="e.g. Sarah Mitchell"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 rounded-lg bg-muted w-fit">
          {MODES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={[
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                mode === key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Type mode ── */}
        {mode === 'type' && name.trim() && (
          <>
            <div className="space-y-2">
              <Label className="text-sm">Choose a signature style</Label>
              <div className="grid grid-cols-4 gap-2">
                {SIGNATURE_FONTS.map((font) => {
                  const active = selectedFont.id === font.id;
                  return (
                    <button
                      key={font.id}
                      onClick={() => setSelectedFont(font)}
                      className={[
                        'rounded-lg border-2 px-2 py-3 flex flex-col items-center gap-1 cursor-pointer transition-all',
                        active ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border bg-muted/30 hover:border-muted-foreground/40',
                      ].join(' ')}
                    >
                      <span style={{ fontFamily: font.family, fontSize: 20, lineHeight: 1.2 }} className="block truncate w-full text-center text-foreground/80">
                        {name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{font.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Preview</Label>
              <div className="rounded-xl border bg-white shadow-inner flex flex-col items-center justify-center py-5 gap-1 min-h-[96px]">
                <span style={{ fontFamily: selectedFont.family, fontSize: 36, lineHeight: 1 }} className="text-foreground/85 transition-all duration-200">
                  {name}
                </span>
                <div className="w-2/3 border-b border-foreground/20 mt-1" />
              </div>
            </div>
          </>
        )}

        {/* ── Draw mode ── */}
        {mode === 'draw' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Draw your signature</Label>
              <button onClick={clearCanvas} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </div>
            <div className="rounded-xl border bg-white shadow-inner overflow-hidden relative">
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="w-full touch-none cursor-crosshair block"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
              />
              {!hasDrawn && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-sm text-muted-foreground/50">Sign here</span>
                </div>
              )}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-2/3 border-b border-foreground/15 pointer-events-none" />
            </div>
            <p className="text-[11px] text-muted-foreground">Use mouse or touch to draw your signature</p>
          </div>
        )}

        {/* ── Upload mode ── */}
        {mode === 'upload' && (
          <div className="space-y-3">
            <Label className="text-sm">Upload signature image</Label>

            {uploadedDataUrl ? (
              /* Preview uploaded image */
              <div className="space-y-2">
                <div className="rounded-xl border bg-white shadow-inner flex flex-col items-center justify-center p-4 min-h-[96px] relative">
                  <img src={uploadedDataUrl} alt="Signature preview" className="max-h-[80px] max-w-full object-contain" />
                  <div className="w-2/3 border-b border-foreground/15 mt-3" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-primary hover:underline"
                  >
                    Replace image
                  </button>
                  <span className="text-muted-foreground/40 text-xs">·</span>
                  <button
                    onClick={() => setUploadedDataUrl(null)}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              /* Drop zone */
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/40 hover:bg-primary/5 transition-all px-6 py-8 flex flex-col items-center gap-2 cursor-pointer"
              >
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium flex items-center gap-1.5 justify-center">
                    <Upload className="w-3.5 h-3.5" /> Click to upload
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, SVG — any size, auto-scaled to fit</p>
                </div>
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-3.5 border-t bg-muted/20">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
          {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Save Authority
        </Button>
      </div>
    </div>
  );
}
