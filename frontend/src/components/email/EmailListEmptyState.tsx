import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { emailListEmptyMessage, type EmailDateSummary } from '@/lib/emailDateRange';

interface EmailListEmptyStateProps {
  folder: string;
  searchQuery: string;
  hasNextPage: boolean;
  dateFilter: Pick<EmailDateSummary, 'isActive' | 'label' | 'clear'>;
  /** Smaller icon and text for the per-agency / per-person sections. */
  compact?: boolean;
}

/**
 * Empty mailbox list shared by the single view and the agency / team sections. With a date range active
 * (and no search) it names the range and offers to clear it, so "nothing in this period" never reads as
 * "no mail at all".
 */
export function EmailListEmptyState({ folder, searchQuery, hasNextPage, dateFilter, compact }: EmailListEmptyStateProps) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <Mail className={cn('mx-auto opacity-50', compact ? 'h-10 w-10 mb-2' : 'h-12 w-12 mb-3')} />
      <p className={compact ? 'text-sm' : undefined}>
        {emailListEmptyMessage({
          folder,
          searchQuery,
          hasNextPage,
          isDateActive: dateFilter.isActive,
          periodLabel: dateFilter.label,
        })}
      </p>
      {dateFilter.isActive && !searchQuery && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={dateFilter.clear}>
          Clear dates
        </Button>
      )}
    </div>
  );
}
