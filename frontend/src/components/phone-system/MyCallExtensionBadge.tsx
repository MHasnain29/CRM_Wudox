import { useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { useAuthStore } from '@/lib/authStore';
import { fetchMyCallExtension } from '@/lib/phoneSystemApi';

/** Shows only the signed-in user's PBX extension on the Calls page. */
export function MyCallExtensionBadge() {
  const userId = useAuthStore((s) => s.user?.id);

  const { data: extension } = useQuery({
    queryKey: ['my-call-extension', userId],
    queryFn: fetchMyCallExtension,
    enabled: !!userId,
    staleTime: 60_000,
  });

  if (!extension) return null;

  return (
    <div
      className="inline-flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-sm"
      title="Your direct-dial PBX extension"
    >
      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Call extension</span>
      <span className="font-mono font-semibold tabular-nums tracking-wide text-foreground">
        {extension}
      </span>
    </div>
  );
}
