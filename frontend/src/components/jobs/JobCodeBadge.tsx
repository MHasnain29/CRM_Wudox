import { cn } from '@/lib/utils';

/**
 * Small, consistent chip that displays a job's unique sequential code
 * (e.g. 000001). Renders nothing when no code is available.
 */
export function JobCodeBadge({
  code,
  className,
}: {
  code?: string | null;
  className?: string;
}) {
  if (!code) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-blue-700 whitespace-nowrap',
        className,
      )}
    >
      {code}
    </span>
  );
}
