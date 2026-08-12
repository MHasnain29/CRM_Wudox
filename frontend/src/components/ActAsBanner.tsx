import { useActAs } from '@/hooks/useActAs';
import { useSearchParams } from 'react-router-dom';

export function ActAsBanner() {
  const actAs = useActAs();
  const [, setSearchParams] = useSearchParams();

  if (!actAs.isActive) return null;

  function exit() {
    setSearchParams((p) => {
      p.delete('linkedUserId');
      p.delete('linkedScope');
      p.delete('leaderId');
      p.delete('managerId');
      p.delete('userId');
      return p;
    });
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1 mb-1 rounded-md border border-amber-200/70 bg-amber-50/60 text-xs">
      {/* Pulse dot */}
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
      </span>

      {/* Label */}
      <span className="text-amber-500 shrink-0">Acting as</span>

      {/* Name + Agency */}
      <span className="font-semibold text-amber-900">{actAs.firstName} {actAs.lastName}</span>
      <span className="text-amber-300">·</span>
      <span className="text-amber-600 truncate">{actAs.agencyName}</span>

      {/* Exit */}
      <button
        onClick={exit}
        className="ml-auto text-amber-500 hover:text-amber-800 transition-colors shrink-0"
      >
        Exit
      </button>
    </div>
  );
}
