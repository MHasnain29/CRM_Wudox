import { cn } from '@/lib/utils';
import { getCountryISO } from '@/lib/countries';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Fixed footprint — every filter chip shares the same box. */
const CHIP_BOX = 'w-[148px] h-9';

const base = cn(
  'inline-flex shrink-0 select-none cursor-pointer items-center justify-start text-left',
  'rounded-md border px-2.5',
  'transition-all duration-200 ease-out',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 focus-visible:ring-offset-1',
  CHIP_BOX,
);

function variant(active: boolean) {
  return active
    ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900';
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
            <span className="flex items-center justify-start gap-1.5 min-w-0 w-full text-left">
              {isoCode && (
                <span className="shrink-0 text-[13px] leading-none">
                  <FlagIcon isoCode={isoCode} />
                </span>
              )}
              <span className="truncate text-left text-[12.5px] font-medium leading-none">{label}</span>
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

/** User chip — same box as text chips; name + optional subtitle stacked, left-aligned */
export function TabChipUser({ firstName, lastName, roleTitle, country, active, onClick }: UserChipProps) {
  const isoCode = getCountryISO(country);
  const fullName = `${firstName} ${lastName}`;
  const subtitle = roleTitle?.trim() ?? '';
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onClick} className={cn(base, variant(active))}>
            <span className="flex flex-col items-start justify-center gap-0.5 min-w-0 w-full text-left">
              <span className="flex items-center justify-start gap-1 min-w-0 w-full">
                {isoCode && (
                  <span className="shrink-0 text-[12px] leading-none">
                    <FlagIcon isoCode={isoCode} />
                  </span>
                )}
                <span className="truncate text-left text-[12px] font-medium leading-none text-inherit">
                  {fullName}
                </span>
              </span>
              {subtitle ? (
                <span
                  className={cn(
                    'block w-full truncate text-left text-[10px] leading-none',
                    active ? 'text-white/75' : 'text-slate-500',
                  )}
                >
                  {subtitle}
                </span>
              ) : null}
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
