import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';

const DEFAULT_PAGE_SIZE = 10;

/** Safe date-fns format — never throws on null/invalid (real API gaps). */
export function formatSafeDate(
  value: string | Date | null | undefined,
  pattern: string,
  fallback = '—',
): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return format(d, pattern);
}

export function useClientPagination<T>(rows: T[], deps: unknown[] = [], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageRows = useMemo(
    () => rows.slice(startIndex, startIndex + pageSize),
    [rows, startIndex, pageSize],
  );

  return {
    pageSize,
    page: safePage,
    setPage,
    total,
    totalPages,
    startIndex,
    pageRows,
    showPagination: total > pageSize,
  };
}

/** Prev / page numbers / Next bar for section cards (agency + per-user). */
export function SectionPaginationBar({
  total,
  startIndex,
  pageLen,
  totalPages,
  page,
  onPageChange,
  pageSize = DEFAULT_PAGE_SIZE,
  className,
}: {
  total: number;
  startIndex: number;
  pageLen: number;
  totalPages: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  className?: string;
}) {
  if (total <= pageSize) return null;

  const maxButtons = 7;
  const start =
    totalPages <= maxButtons
      ? 1
      : Math.min(Math.max(1, page - 3), totalPages - maxButtons + 1);
  const end = Math.min(start + maxButtons - 1, totalPages);
  const buttons = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div className={`flex items-center justify-between pt-3 mt-2 border-t ${className ?? ''}`}>
      <div className="text-sm text-muted-foreground">
        Showing {startIndex + 1} to {Math.min(startIndex + pageLen, total)} of {total}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {buttons.map((p) => (
            <Button
              key={p}
              variant={page === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(p)}
              className="min-w-[36px]"
            >
              {p}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
