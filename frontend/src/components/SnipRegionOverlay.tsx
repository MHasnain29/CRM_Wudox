import { useCallback, useEffect, useRef, useState } from 'react';
import { DismissableLayerBranch } from '@radix-ui/react-dismissable-layer';
import { captureViewportSnapshot, cropViewportSnapshot } from '@/lib/captureScreen';
import { toast } from 'sonner';

interface SnipRegionOverlayProps {
  onComplete: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeRect(start: Point, end: Point): SelectionRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function SnipRegionOverlay({ onComplete, onCancel }: SnipRegionOverlayProps) {
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [cropping, setCropping] = useState(false);
  const dragRef = useRef<{ start: Point; current: Point } | null>(null);

  const completeSelection = useCallback(
    async (rect: SelectionRect) => {
      if (rect.width < 8 || rect.height < 8) {
        setSelection(null);
        return;
      }

      // Hide the dim layer + selection rect FIRST so the tab capture grabs a clean
      // viewport frame with no overlay baked into the pixels.
      // captureViewportSnapshot internally awaits two RAFs before grabFrame, giving
      // the browser one composite cycle to paint without the overlay.
      setCropping(true);
      try {
        const snapshot = await captureViewportSnapshot();
        if (!snapshot) {
          toast.error('Tab capture ended. Click Snip again to re-share this tab.');
          onCancel();
          return;
        }
        const cropped = cropViewportSnapshot(snapshot, rect);
        if (cropped) onComplete(cropped);
        else {
          toast.error('Could not capture that area. Please try again.');
          onCancel();
        }
      } catch {
        toast.error('Screenshot failed. Please try again.');
        onCancel();
      }
    },
    [onComplete, onCancel],
  );

  useEffect(() => {
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => { document.body.style.cursor = prev; };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cropping) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, cropping]);

  useEffect(() => {
    if (cropping) return;

    const getPoint = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const point = getPoint(e);
      dragRef.current = { start: point, current: point };
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const point = getPoint(e);
      dragRef.current.current = point;
      setSelection(normalizeRect(dragRef.current.start, point));
    };

    const finishDrag = (e: PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = normalizeRect(dragRef.current.start, dragRef.current.current);
      dragRef.current = null;
      setSelection(rect);
      void completeSelection(rect);
    };

    const listenerOpts: AddEventListenerOptions = { capture: true };
    window.addEventListener('pointerdown', onPointerDown, listenerOpts);
    window.addEventListener('pointermove', onPointerMove, listenerOpts);
    window.addEventListener('pointerup', finishDrag, listenerOpts);
    window.addEventListener('pointercancel', finishDrag, listenerOpts);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, listenerOpts);
      window.removeEventListener('pointermove', onPointerMove, listenerOpts);
      window.removeEventListener('pointerup', finishDrag, listenerOpts);
      window.removeEventListener('pointercancel', finishDrag, listenerOpts);
    };
  }, [cropping, completeSelection]);

  return (
    <DismissableLayerBranch>
      <div className="fixed inset-0 z-[9999] select-none pointer-events-none" data-snip-ignore>
        {/* When `cropping` is true we render NOTHING visible — tab capture grabs a clean
            frame with no dim layer or selection rect baked into the pixels. */}
        {!cropping && (
          <>
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-lg bg-background/95 border px-4 py-2 text-sm shadow-lg pointer-events-none"
              data-snip-ignore
            >
              Drag to select an area. Press{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">Esc</kbd> to cancel.
            </div>

            {selection && selection.width > 0 && selection.height > 0 && (
              <div
                className="absolute border-2 border-primary bg-transparent pointer-events-none"
                style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                }}
              />
            )}
          </>
        )}
      </div>
    </DismissableLayerBranch>
  );
}
