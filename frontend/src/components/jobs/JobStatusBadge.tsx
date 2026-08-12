import { Badge } from '@/components/ui/badge';
import { JobStatus } from '@/lib/jobTypes';

const statusConfig: Record<JobStatus, { label: string; className: string }> = {
  draft: {
    label: 'Draft',
    className: 'bg-muted text-muted-foreground',
  },
  open: {
    label: 'Open',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
  closed: {
    label: 'Closed',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  filled: {
    label: 'Filled',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
};

interface JobStatusBadgeProps {
  status: JobStatus;
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}
