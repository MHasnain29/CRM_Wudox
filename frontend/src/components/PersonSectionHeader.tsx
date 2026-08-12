import { TrendingUp } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PersonSectionUser = {
  id: string;
  firstName: string;
  lastName: string;
};

function initialsOf(user: PersonSectionUser) {
  return `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';
}

/**
 * Shared identity bar for All Managers / All Team people sections.
 * Makes each person block visually distinct so the next user is obvious.
 */
export function PersonSectionHeader({
  user,
  roleTitle,
  subtitle,
  onView,
  viewLabel = 'View',
  className,
}: {
  user: PersonSectionUser;
  roleTitle?: string;
  /** Extra line under the name (counts, agency, etc.) */
  subtitle?: string;
  onView?: () => void;
  viewLabel?: string;
  className?: string;
}) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 mb-3',
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="h-9 w-9 shrink-0 border border-border/60 shadow-sm">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
            {initialsOf(user)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-semibold text-sm text-foreground truncate">{fullName}</span>
            {roleTitle ? (
              <span className="inline-flex items-center rounded-full border border-border/80 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">
                {roleTitle}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {onView ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs shrink-0 bg-background"
          onClick={onView}
        >
          {viewLabel} <TrendingUp className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Compact identity strip for use inside a colored card header
 * (when the surrounding card already provides chrome).
 */
export function PersonCardIdentity({
  user,
  roleTitle,
  subtitle,
  accentClassName,
}: {
  user: PersonSectionUser;
  roleTitle?: string;
  subtitle?: string;
  /** Optional colored avatar bg when inside a tinted section card */
  accentClassName?: string;
}) {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const line = [roleTitle, subtitle].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar className="h-10 w-10 shrink-0 border border-white/20 shadow-sm">
        <AvatarFallback
          className={cn(
            'text-sm font-bold text-white',
            accentClassName ?? 'bg-primary text-primary-foreground',
          )}
        >
          {initialsOf(user)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <h3 className="font-semibold text-base leading-tight truncate">{fullName}</h3>
        {line ? <p className="text-xs text-muted-foreground truncate">{line}</p> : null}
      </div>
    </div>
  );
}
