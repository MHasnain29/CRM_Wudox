import { cn } from '@/lib/utils';
import { getCountryISO } from '@/lib/countries';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Compact chip — every chip shares the same fixed box; long names truncate, full name in tooltip. */
const base = cn(
  'inline-flex shrink-0 select-none cursor-pointer items-center justify-start text-left',
  'h-7 w-[132px] rounded-md border px-2.5',
  'transition-all duration-200 ease-out',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 focus-visible:ring-offset-1',
);

function variant(active: boolean) {
  return active
    ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900';
}

/** Text-only "All X" / agency chip — same size as user chips, text left-aligned */
export function TabChipText({
  label,
  active,
  onClick,
  country,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  country?: string | null;
}) {
  const isoCode = getCountryISO(country);
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onClick} className={cn(base, variant(active))}>
            <span className="flex items-center gap-1.5 min-w-0 w-full">
              {isoCode && (
                <span className="shrink-0 text-[11px] leading-none">
                  <FlagIcon isoCode={isoCode} />
                </span>
              )}
              <span className="truncate text-[12px] font-semibold leading-none">{label}</span>
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface UserChipProps {
  firstName: string;
  lastName: string;
  roleTitle: string;
  country?: string | null;
  active: boolean;
  onClick: () => void;
}

/** User chip — compact single-line pill: flag + name; role shown in the tooltip. */
export function TabChipUser({ firstName, lastName, roleTitle, country, active, onClick }: UserChipProps) {
  const isoCode = getCountryISO(country);
  const fullName = `${firstName} ${lastName}`;
  const subtitle = roleTitle?.trim() ?? '';
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onClick} className={cn(base, variant(active))}>
            <span className="flex items-center gap-1 min-w-0 w-full">
              {isoCode && (
                <span className="shrink-0 text-[11px] leading-none">
                  <FlagIcon isoCode={isoCode} />
                </span>
              )}
              <span className="truncate text-[12px] font-medium leading-none">{fullName}</span>
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{fullName}{subtitle ? ` · ${subtitle}` : ''}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
