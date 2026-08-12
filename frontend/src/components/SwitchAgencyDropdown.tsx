import { useState } from 'react';
import { ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { switchAgency } from '@/lib/switchAgency';
import { useStore } from '@/lib/store';
import { getRoleLabel } from '@/lib/roleLabels';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function AgencyAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const color = colorForName(name);
  const initials = initialsFor(name);
  const sizeClass = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-8 w-8 text-[11px]';
  return (
    <div
      className={`${sizeClass} ${color} rounded-full flex items-center justify-center text-white font-bold shrink-0 select-none`}
    >
      {initials}
    </div>
  );
}

export function SwitchAgencyDropdown() {
  const currentUser = useStore((s) => s.currentUser);
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const [switching, setSwitching] = useState<string | null>(null);

  const { data: linkedAccounts } = useLinkedAccounts();

  const activeLinked = linkedAccounts?.filter((a) => a.isActive) ?? [];
  if (activeLinked.length === 0) return null;

  async function handleSwitch(targetUserId: string) {
    if (switching) return;
    setSwitching(targetUserId);
    await switchAgency(targetUserId);
    setSwitching(null);
  }

  const currentAgencyName = currentSubCompany?.name ?? 'Current Agency';
  const isSwitching = !!switching;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={isSwitching}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-sidebar-accent/50 transition-colors group disabled:opacity-60 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <AgencyAvatar name={currentAgencyName} size="sm" />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-xs font-semibold text-sidebar-foreground/80 group-hover:text-sidebar-foreground truncate leading-none mb-0.5">
              {currentAgencyName}
            </p>
            <p className="text-[10px] text-sidebar-foreground/45 truncate leading-none">
              {isSwitching ? 'Switching…' : 'Switch agency'}
            </p>
          </div>
          {isSwitching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-sidebar-foreground/40" />
          ) : (
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/35 group-hover:text-sidebar-foreground/60 transition-colors" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-72 p-2">
        {/* Current agency card */}
        <div className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg bg-muted/60 mb-1.5">
          <AgencyAvatar name={currentAgencyName} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-sm font-semibold truncate leading-none">
                {currentAgencyName}
              </span>
              <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            </div>
            <span className="text-xs text-muted-foreground block truncate">
              {currentUser?.firstName} {currentUser?.lastName} ·{' '}
              {getRoleLabel(currentUser?.role ?? '')}
            </span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <p className="text-[10px] text-muted-foreground px-2.5 pt-1.5 pb-1 font-semibold uppercase tracking-widest">
          Switch to
        </p>

        {activeLinked.map((account) => (
          <DropdownMenuItem
            key={account.userId}
            onSelect={() => void handleSwitch(account.userId)}
            disabled={switching === account.userId}
            className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg cursor-pointer group"
          >
            <AgencyAvatar name={account.subCompanyName} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium block truncate leading-none mb-0.5">
                {account.subCompanyName}
              </span>
              <span className="text-xs text-muted-foreground block truncate">
                {account.firstName} {account.lastName} · {getRoleLabel(account.role)}
              </span>
            </div>
            {switching === account.userId ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
            ) : (
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
