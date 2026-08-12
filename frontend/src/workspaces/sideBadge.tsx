import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { workspaceAccessFromPermissions } from './config';

const STYLES: Record<'marketing' | 'recruitment' | 'both', { label: string; className: string }> = {
  marketing: { label: 'Marketing', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  recruitment: { label: 'Recruiter', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  both: { label: 'Both', className: 'bg-violet-50 text-violet-700 border-violet-200' },
};

/** Small Marketing / Recruiter / Both badge from granted permission keys (Settings → Roles). */
export function RoleSideBadge({
  permissionKeys,
  className,
}: {
  permissionKeys: readonly string[];
  className?: string;
}) {
  const { side } = workspaceAccessFromPermissions(permissionKeys);
  if (side === 'none') return null;
  const { label, className: colors } = STYLES[side];
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1 py-0 font-normal', colors, className)}>
      {label}
    </Badge>
  );
}
