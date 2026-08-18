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
    <div className="mb-4 flex gap-1 rounded-xl bg-sidebar-accent/30 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.side}
          type="button"
          onClick={() => setSide(tab.side)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all duration-150',
            side === tab.side
              ? 'bg-white text-sidebar-foreground shadow-[0_1px_3px_rgba(0,0,0,0.10),0_0_0_1px_rgba(0,0,0,0.04)] dark:bg-sidebar-accent dark:text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/45 hover:text-sidebar-foreground/75',
          )}
        >
          <tab.icon className="h-3 w-3" />
          {SIDE_LABELS[tab.side]}
        </button>
      ))}
    </div>
  );
}
