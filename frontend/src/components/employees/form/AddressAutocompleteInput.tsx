import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ParsedPlace = {
  address: string;
  city: string;
  province: string;
  postalCode: string;
};

const MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';

type Suggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

async function fetchAutocompleteSuggestions(input: string): Promise<Suggestion[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': MAPS_KEY,
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
      };
    }>;
  };
  return (data.suggestions ?? [])
    .map((s) => {
      const fullText = s.placePrediction?.text?.text ?? '';
      const commaIdx = fullText.indexOf(',');
      return {
        placeId: s.placePrediction?.placeId ?? '',
        text: fullText,
        mainText: commaIdx > -1 ? fullText.slice(0, commaIdx) : fullText,
        secondaryText: commaIdx > -1 ? fullText.slice(commaIdx + 2) : '',
      };
    })
    .filter((s) => s.placeId && s.text);
}

type AddressComponent = { longText?: string; shortText?: string; types: string[] };

async function fetchPlaceDetails(placeId: string): Promise<ParsedPlace | null> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        'X-Goog-Api-Key': MAPS_KEY,
        'X-Goog-FieldMask': 'addressComponents,formattedAddress',
      },
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    addressComponents?: AddressComponent[];
    formattedAddress?: string;
  };
  if (!data.addressComponents) return null;
  const get = (type: string, useShort = false) => {
    const c = data.addressComponents!.find((comp) => comp.types.includes(type));
    if (!c) return '';
    return (useShort ? c.shortText : c.longText) ?? c.longText ?? c.shortText ?? '';
  };
  return {
    address: [get('street_number'), get('route')].filter(Boolean).join(' ') || data.formattedAddress?.split(',')[0] || '',
    city: get('locality') || get('sublocality') || get('postal_town'),
    province: get('administrative_area_level_1'),
    postalCode: get('postal_code'),
  };
}

export function AddressAutocompleteInput({
  value,
  onChange,
  onPlaceSelected,
  className,
  placeholder = 'Start typing a street address…',
  maxLength = 500,
}: {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelected: (place: ParsedPlace) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const onPlaceRef = useRef(onPlaceSelected);
  onPlaceRef.current = onPlaceSelected;

  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const doFetch = (input: string) => {
    if (!MAPS_KEY || !input.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const seq = ++reqSeq.current;
    fetchAutocompleteSuggestions(input)
      .then((list) => {
        if (seq !== reqSeq.current) return;
        setSuggestions(list);
        setActiveIndex(-1);
        setOpen(list.length > 0);
      })
      .catch(() => {
        if (seq !== reqSeq.current) return;
        setSuggestions([]);
        setOpen(false);
      })
      .finally(() => {
        if (seq === reqSeq.current) setLoading(false);
      });
  };

  const handleInputChange = (next: string) => {
    onChange(next);
    if (!MAPS_KEY) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(next), 250);
  };

  const handleSelect = async (s: Suggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOpen(false);
    setSuggestions([]);
    onChange(s.text);
    const parsed = await fetchPlaceDetails(s.placeId);
    if (parsed) {
      onPlaceRef.current(parsed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      void handleSelect(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showDropdown = useMemo(
    () => open && (loading || suggestions.length > 0),
    [open, loading, suggestions.length],
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          className={cn(MAPS_KEY && 'pr-9', className)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
        />
        {MAPS_KEY && loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-[300] mt-1.5 w-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <ul className="max-h-72 overflow-y-auto py-1.5">
            {suggestions.map((s, i) => (
              <li key={s.placeId}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleSelect(s);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                    i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{s.mainText}</p>
                    {s.secondaryText && (
                      <p className="truncate text-xs text-muted-foreground leading-tight mt-0.5">{s.secondaryText}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
            {loading && suggestions.length === 0 && (
              <li className="flex items-center gap-3 px-3 py-3">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Searching addresses…</span>
              </li>
            )}
          </ul>
          <div className="flex items-center justify-end border-t px-3 py-1.5">
            <span className="text-[10px] text-muted-foreground/60">powered by Google</span>
          </div>
        </div>
      )}
    </div>
  );
}
