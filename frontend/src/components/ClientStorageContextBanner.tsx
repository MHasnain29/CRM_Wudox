import { useMemo } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const IMMEDIATE_GLOBAL_ROLES = new Set(['director', 'super_admin']);

export type ClientStorageContext = {
  agencyName: string;
  role: string;
  visibilityDays?: number | null;
  pending?: boolean;
};

export function getClientStorageMessage({
  agencyName,
  role,
  visibilityDays,
  pending = false,
}: ClientStorageContext): string {
  if (pending) {
    return `Will queue for approval (Settings → Approvals), then save to ${agencyName}. After approval, Client Visibility rules apply before org-wide sharing.`;
  }
  if (IMMEDIATE_GLOBAL_ROLES.has(role)) {
    return `Saving to ${agencyName}. Visible to all agencies immediately after create.`;
  }
  const days = visibilityDays ?? 7;
  if (days <= 0) {
    return `Saving to ${agencyName}. Visible to all agencies immediately after approval (Client Visibility days = 0).`;
  }
  const unit = days === 1 ? 'day' : 'days';
  return `Saving to ${agencyName}. After approval, agency-only for ${days} ${unit}, then shared org-wide (Client Visibility).`;
}

export function formatClientCreatedToast(
  clientName: string,
  ctx: ClientStorageContext,
): string {
  return `Client "${clientName}" added. ${getClientStorageMessage(ctx)}`;
}

export function ClientStorageContextBanner({
  agencyName,
  role,
  visibilityDays,
  pending = false,
  className,
}: ClientStorageContext & { className?: string }) {
  const message = useMemo(
    () => getClientStorageMessage({ agencyName, role, visibilityDays, pending }),
    [agencyName, role, visibilityDays, pending],
  );

  return (
    <Alert className={className}>
      <Info className="h-4 w-4" />
      <AlertDescription className="text-xs">{message}</AlertDescription>
    </Alert>
  );
}
