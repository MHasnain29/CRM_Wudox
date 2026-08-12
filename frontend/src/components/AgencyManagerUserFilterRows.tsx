import { useEffect, useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TabChipText, TabChipUser } from '@/components/TabChip';
import { getUserRoleTitle } from '@/lib/roleLabels';
import type { Agency } from '@/hooks/useAgencyFilter';
import type { HierarchyFilterTier } from '@/lib/hierarchyFilter';

const EXPAND_EXIT_MS = 640;


interface Props {
  agencies: Agency[];
  agenciesLoading: boolean;
  selectedAgencyId: string;
  onSelectAgency: (id: string) => void;
  tiers: HierarchyFilterTier[];
  tierSelections: Record<'leaderId' | 'managerId' | 'userId', string>;
  onSelectTier: (paramKey: 'leaderId' | 'managerId' | 'userId', id: string) => void;
  onClearTier: (paramKey: 'leaderId' | 'managerId' | 'userId') => void;
  usersLoading?: boolean;
  hideUserRows?: boolean;
  /** When linked-account row already lists agencies, skip the hierarchy agency chips. */
  hideAgencyRow?: boolean;
  leaderParamInUrl?: boolean;
  managerParamInUrl?: boolean;
  userParamInUrl?: boolean;
  /** Shown when elevated user has no assigned agencies (e.g. OM without Settings assignments). */
  emptyAgenciesHint?: string;
  /** Show mini bar instead of full rows (set by ScopeFilterBar on scroll). */
  collapsed?: boolean;
  /** Show animated full rows below mini bar when Edit is clicked. */
  showExpandPanel?: boolean;
  /** Edit button callback. */
  onExpandClick?: () => void;
}

const TIER_PILL_LABEL: Record<string, string> = {
  leader: 'Authority',
  team: 'Manager',
  own: 'Team',
};

function MiniPill({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 shrink-0 rounded-md border px-2.5 h-7 text-xs font-medium whitespace-nowrap',
        'transition-colors duration-200',
        active
          ? 'bg-blue-50 border-blue-200 text-blue-700'
          : 'bg-white border-slate-200 text-slate-600',
      )}
    >
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="truncate max-w-[7rem]">{value}</span>
    </span>
  );
}

function tierParamInUrl(
  paramKey: 'leaderId' | 'managerId' | 'userId',
  flags: { leader: boolean; manager: boolean; user: boolean },
): boolean {
  if (paramKey === 'leaderId') return flags.leader;
  if (paramKey === 'managerId') return flags.manager;
  return flags.user;
}

/** "All …" chip is active only when explicitly selected in the URL (not implicit default). */
function isAllChipActive(
  paramKey: 'leaderId' | 'managerId' | 'userId',
  selected: string,
  flags: { leader: boolean; manager: boolean; user: boolean },
): boolean {
  if (selected !== 'all') return false;
  return tierParamInUrl(paramKey, flags);
}

export function AgencyManagerUserFilterRows({
  agencies,
  agenciesLoading,
  selectedAgencyId,
  onSelectAgency,
  tiers,
  tierSelections,
  onSelectTier,
  onClearTier,
  usersLoading = false,
  hideUserRows = false,
  hideAgencyRow = false,
  leaderParamInUrl = false,
  managerParamInUrl = false,
  userParamInUrl = false,
  emptyAgenciesHint,
  collapsed = false,
  showExpandPanel = false,
  onExpandClick,
}: Props) {
  const urlFlags = {
    leader: leaderParamInUrl,
    manager: managerParamInUrl,
    user: userParamInUrl,
  };

  // Keep panel mounted through the exit animation so Close feels smooth.
  const [panelMounted, setPanelMounted] = useState(showExpandPanel);
  const [panelOpen, setPanelOpen] = useState(showExpandPanel);

  useEffect(() => {
    if (showExpandPanel) {
      setPanelMounted(true);
      // Double rAF so the browser paints the closed state first, then eases open.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPanelOpen(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setPanelOpen(false);
    const t = window.setTimeout(() => setPanelMounted(false), EXPAND_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [showExpandPanel]);

  useEffect(() => {
    if (agencies.length !== 1 || agenciesLoading) return;
    if (selectedAgencyId === 'me') return;
    if (selectedAgencyId !== agencies[0]!.id) {
      onSelectAgency(agencies[0]!.id);
    }
  }, [agencies, agenciesLoading, selectedAgencyId, onSelectAgency]);

  useEffect(() => {
    if (usersLoading) return;
    for (const tier of tiers) {
      const selected = tierSelections[tier.paramKey];
      if (selected === 'all' || selected === 'me') continue;
      if (tier.viewerSelfChip?.id === selected) continue;
      const isStale = !tier.visibleUsers.some((u) => u.id === selected);
      if (isStale) onClearTier(tier.paramKey);
    }
  }, [tiers, tierSelections, usersLoading, onClearTier]);

  const agencyDrilledIn =
    selectedAgencyId !== 'all' && selectedAgencyId !== 'me' && selectedAgencyId.length > 0;
  const showHierarchyRows =
    agencyDrilledIn || (selectedAgencyId === 'all' && agencies.length > 1);

  const handleAllChipClick = (tier: HierarchyFilterTier) => {
    const selected = tierSelections[tier.paramKey];
    if (isAllChipActive(tier.paramKey, selected, urlFlags)) {
      onClearTier(tier.paramKey);
    } else {
      onSelectTier(tier.paramKey, 'all');
    }
  };

  const handlePersonChipClick = (tier: HierarchyFilterTier, userId: string) => {
    const selected = tierSelections[tier.paramKey];
    if (selected === userId) {
      onClearTier(tier.paramKey);
    } else {
      onSelectTier(tier.paramKey, userId);
    }
  };

  // Single-agency users have nothing to pick — hide the agency row so home agency
  // is not mistaken for an active filter (own-default = no chips selected).
  const showAgencyChips = !hideAgencyRow && agencies.length > 1;

  // Factory (not a component) so each call gets fresh elements — safe to render
  // in both the in-flow rows and the Edit overlay without sharing one element tree.
  const renderFullRows = () => (
    <>
      {showAgencyChips && (
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <TabChipText
          label="All Agencies"
          active={selectedAgencyId === 'all'}
          onClick={() => onSelectAgency(selectedAgencyId === 'all' ? 'me' : 'all')}
        />
        {agenciesLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-1 shrink-0" />
        ) : (
          agencies.map((agency) => (
            <TabChipText
              key={agency.id}
              label={agency.name}
              active={selectedAgencyId === agency.id}
              onClick={() =>
                onSelectAgency(selectedAgencyId === agency.id ? 'me' : agency.id)
              }
            />
          ))
        )}
      </div>
      )}

      {!hideUserRows &&
        showHierarchyRows &&
        tiers.map((tier) => {
          const selected = tierSelections[tier.paramKey];

          return (
            <div key={tier.id} className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <TabChipText
                label={tier.allLabel}
                active={isAllChipActive(tier.paramKey, selected, urlFlags)}
                onClick={() => handleAllChipClick(tier)}
              />
              {usersLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-1 shrink-0" />
              ) : (
                tier.visibleUsers.map((user) => (
                  <TabChipUser
                    key={user.id}
                    firstName={user.firstName}
                    lastName={user.lastName}
                    roleTitle={getUserRoleTitle(user)}
                    country={user.location?.country ?? user.country}
                    active={selected === user.id}
                    onClick={() => handlePersonChipClick(tier, user.id)}
                  />
                ))
              )}
            </div>
          );
        })}
    </>
  );

  // ── Empty agencies guard
  if (agencies.length === 0 && !agenciesLoading) {
    if (collapsed) return null;
    if (emptyAgenciesHint) {
      return <div className="px-1 py-1 text-sm text-muted-foreground">{emptyAgenciesHint}</div>;
    }
    return null;
  }

  const agencyLabel =
    selectedAgencyId === 'all'
      ? 'All Agencies'
      : !selectedAgencyId || selectedAgencyId === 'me'
        ? 'Own'
        : (agencies.find((a) => a.id === selectedAgencyId)?.name ?? '…');

  const isAgencyActive =
    selectedAgencyId === 'all' ||
    (!!selectedAgencyId && selectedAgencyId !== 'me');

  function getTierLabel(tier: HierarchyFilterTier): string {
    const selected = tierSelections[tier.paramKey];
    if (!tierParamInUrl(tier.paramKey, urlFlags) || !selected || selected === 'me') {
      return 'Own';
    }
    if (selected === 'all') return tier.allLabel;
    const user = tier.visibleUsers.find((u) => u.id === selected);
    return user ? `${user.firstName} ${user.lastName}` : 'Own';
  }

  // Soft dissolve between full rows ↔ mini bar (see .filter-morph* in index.css)
  return (
    <div className="relative z-[1]">
      {/* Full chip rows — fade out + collapse when scrolled */}
      <div
        className={cn(
          'grid filter-morph',
          collapsed ? 'filter-morph-out' : 'filter-morph-in',
          collapsed
            ? 'grid-rows-[0fr] opacity-0 -translate-y-2 scale-[0.985] blur-[2px] pointer-events-none'
            : 'grid-rows-[1fr] opacity-100 translate-y-0 scale-100 blur-0',
        )}
        aria-hidden={collapsed}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-1.5">{renderFullRows()}</div>
        </div>
      </div>

      {/* Mini bar — fades in a beat after full rows start dissolving */}
      <div
        className={cn(
          'grid filter-morph',
          collapsed ? 'filter-morph-in' : 'filter-morph-out',
          collapsed
            ? 'grid-rows-[1fr] opacity-100 translate-y-0 scale-100 blur-0'
            : 'grid-rows-[0fr] opacity-0 translate-y-2 scale-[0.985] blur-[2px] pointer-events-none',
        )}
        aria-hidden={!collapsed}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 py-1">
            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(agenciesLoading || usersLoading) && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
              )}
              {!agenciesLoading && showAgencyChips && (
                <MiniPill label="Agency" value={agencyLabel} active={isAgencyActive} />
              )}
              {!hideUserRows &&
                showHierarchyRows &&
                !usersLoading &&
                tiers.map((tier) => {
                  const selected = tierSelections[tier.paramKey];
                  const isActive =
                    isAllChipActive(tier.paramKey, selected, urlFlags) ||
                    (!!selected && selected !== 'all' && selected !== 'me');
                  return (
                    <MiniPill
                      key={tier.id}
                      label={TIER_PILL_LABEL[tier.id] ?? tier.allLabel}
                      value={getTierLabel(tier)}
                      active={isActive}
                    />
                  );
                })}
            </div>

            <button
              type="button"
              onClick={onExpandClick}
              className={cn(
                'relative z-[60] shrink-0 flex items-center gap-0.5 text-[11px] font-medium rounded-md px-1.5 py-0.5 border h-6',
                'transition-[color,background-color,border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
                panelOpen
                  ? 'border-blue-300 text-blue-600 bg-blue-50 shadow-sm scale-[1.02] hover:bg-blue-100'
                  : 'border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50',
              )}
            >
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform duration-[620ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
                  panelOpen && 'rotate-180',
                )}
              />
              <span className="relative inline-grid min-w-[2.25rem] text-center overflow-hidden leading-none">
                <span
                  className={cn(
                    'col-start-1 row-start-1 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    panelOpen ? 'opacity-0 -translate-y-2 scale-95' : 'opacity-100 translate-y-0 scale-100',
                  )}
                >
                  Edit
                </span>
                <span
                  className={cn(
                    'col-start-1 row-start-1 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    panelOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95',
                  )}
                >
                  Close
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/*
        Edit expand: absolute overlay so sticky height stays put.
        Mounted through exit so open/close can fade + slide smoothly.
      */}
      {panelMounted && (
        <div
          className={cn(
            'absolute top-full left-0 right-0 z-[50] origin-top',
            'bg-white border-b border-border pt-1.5 pb-2.5 space-y-1.5 px-0.5',
            'filter-expand-panel',
            panelOpen ? 'filter-expand-panel-open' : 'filter-expand-panel-closed',
          )}
          aria-hidden={!panelOpen}
        >
          {renderFullRows()}
        </div>
      )}
    </div>
  );
}
