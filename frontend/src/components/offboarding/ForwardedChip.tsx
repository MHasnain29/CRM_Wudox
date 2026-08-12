import { cn } from '@/lib/utils';

interface ForwardedChipProps {
  name: string;
  className?: string;
}

export function ForwardedChip({ name, className }: ForwardedChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-px rounded-sm text-[10px] font-semibold whitespace-nowrap tracking-wide',
        'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-600 border border-indigo-200/60',
        'dark:from-indigo-950/40 dark:to-purple-950/40 dark:text-indigo-400 dark:border-indigo-700/40',
        className,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
      From {name}
    </span>
  );
}
