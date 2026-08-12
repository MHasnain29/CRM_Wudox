import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

const PRESET_SWATCHES = [
  '#B81D5A',
  '#9D174D',
  '#C2185B',
  '#1d4ed8',
  '#0f766e',
  '#b45309',
  '#4c1d95',
  '#0c1222',
];

interface ColorSwatchPickerProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Hex-only agency color picker with swatches + native color input. */
export function ColorSwatchPicker({ value, onChange, disabled, className }: ColorSwatchPickerProps) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#B81D5A';

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            title={c}
            onClick={() => onChange(c)}
            className={cn(
              'h-7 w-7 rounded-md border border-black/10 shadow-sm transition ring-offset-background',
              hex.toLowerCase() === c.toLowerCase() && 'ring-2 ring-foreground ring-offset-1',
              disabled && 'opacity-50 pointer-events-none',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5 disabled:opacity-50"
        />
        <Input
          value={hex}
          disabled={disabled}
          maxLength={7}
          className="h-9 font-mono text-xs uppercase"
          onChange={(e) => {
            let next = e.target.value.trim();
            if (!next.startsWith('#')) next = `#${next}`;
            if (/^#[0-9a-fA-F]{0,6}$/.test(next)) {
              if (next.length === 7) onChange(next.toUpperCase());
            }
          }}
        />
      </div>
    </div>
  );
}
