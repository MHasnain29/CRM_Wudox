import { Briefcase, Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SIDE_LABELS, type WorkspaceSide } from './config';
import { useActiveSide } from './useActiveSide';

const TABS: Array<{ side: WorkspaceSide; icon: typeof Megaphone }> = [
  { side: 'marketing', icon: Megaphone },
  { side: 'recruitment', icon: Briefcase },
];

/** Marketing ↔ Recruitment segmented tabs at the top of the sidebar menu (super users only). */
export function WorkspaceSwitcher() {
  const { side, canSwitch, setSide } = useActiveSide();
  if (!canSwitch) return null;
  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-sidebar-accent/40 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.side}
          type="button"
          onClick={() => setSide(tab.side)}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            side === tab.side
              ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground',
          )}
        >
          <tab.icon className="h-3.5 w-3.5" />
          {SIDE_LABELS[tab.side]}
        </button>
      ))}
    </div>
  );
}
