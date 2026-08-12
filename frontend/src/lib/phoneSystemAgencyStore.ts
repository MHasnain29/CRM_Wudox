import { create } from 'zustand';
import {
  type AgencyPhoneBundle,
  createDefaultAgencyBundle,
  migrateBundle,
  buildPrimaryCallFlowGraph,
} from './phoneSystemAgencyBundle';
import { fetchPhoneSystemBundle, savePhoneSystemBundle, publishPhoneCallFlow, restorePhoneSystemDefaults } from './phoneSystemApi';
import type { CallFlowGraph } from './callFlowTypes';
import type {
  PhoneNumberRecord,
  MenuRoute,
  RingGroup,
  StaffExtension,
  VoicemailBox,
  AudioClip,
  BusinessHoursDay,
  PhoneSystemConfig,
  AgencyTwilioConfig,
} from './phoneSystemTypes';
import {
  alignStaffAndRingGroups,
  deriveMenuRoutesFromRingGroups,
  ensureExtensionDialInFlow,
  syncConnectGroupNodesInFlow,
} from './phoneSystemExtensions';

export interface AgencyOption {
  id: string;
  name: string;
}

const AGENCY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPersistedAgencyId(id: string): boolean {
  return AGENCY_UUID_RE.test(id);
}

interface PhoneSystemAgencyState {
  bundles: Record<string, AgencyPhoneBundle>;
  activeAgencyId: string | null;
  agencyOptions: AgencyOption[];
  initialized: boolean;
  loading: boolean;
  saving: boolean;
  /** Agency ids successfully loaded from GET /phone-system/bundle */
  loadedFromApi: Record<string, boolean>;
  loadError: string | null;
  /** Serialized agency id list — skip redundant API hydration when unchanged */
  agencyIdsKey: string | null;

  ensureAgencies: (agencies: AgencyOption[], preferredId?: string | null) => void;
  reloadAgencyBundle: (agencyId: string) => Promise<void>;
  setActiveAgencyId: (id: string) => void;
  getActiveBundle: () => AgencyPhoneBundle | null;
  patchActiveBundle: (updater: (bundle: AgencyPhoneBundle) => AgencyPhoneBundle) => void;
  saveActiveBundle: () => Promise<AgencyPhoneBundle | null>;
  publishActiveFlow: (draftFlowOverride?: CallFlowGraph) => Promise<void>;
  restoreActiveDefaults: () => Promise<void>;
  rebuildDraftFlowFromResources: () => void;
}

async function hydrateBundlesFromApi(agencyIds: string[]) {
  const ids = agencyIds.filter(isPersistedAgencyId);
  if (ids.length === 0) {
    usePhoneSystemAgencyStore.setState({ loading: false, loadError: null });
    return;
  }

  const updates: Record<string, AgencyPhoneBundle> = {};
  const loadedFromApi: Record<string, boolean> = {};
  const failures: string[] = [];

  await Promise.all(
    ids.map(async (id) => {
      try {
        const apiBundle = await fetchPhoneSystemBundle(id);
        if (apiBundle) {
          try {
            updates[id] = migrateBundle(apiBundle);
            loadedFromApi[id] = true;
          } catch (migrateErr) {
            console.warn('[phoneSystem] Failed to migrate bundle for', id, migrateErr);
            failures.push(id);
            loadedFromApi[id] = false;
          }
        } else {
          failures.push(id);
          loadedFromApi[id] = false;
        }
      } catch (err) {
        console.warn('[phoneSystem] Failed to load bundle for', id, err);
        failures.push(id);
        loadedFromApi[id] = false;
      }
    }),
  );

  usePhoneSystemAgencyStore.setState((state) => ({
    bundles: Object.keys(updates).length > 0 ? { ...state.bundles, ...updates } : state.bundles,
    loadedFromApi: { ...state.loadedFromApi, ...loadedFromApi },
    loading: false,
    loadError:
      failures.length > 0
        ? 'Could not load phone system settings from the server. Check your connection and permissions, then refresh.'
        : null,
  }));
}

export const usePhoneSystemAgencyStore = create<PhoneSystemAgencyState>((set, get) => ({
  bundles: {},
  activeAgencyId: null,
  agencyOptions: [],
  initialized: false,
  loading: false,
  saving: false,
  loadedFromApi: {},
  loadError: null,
  agencyIdsKey: null,

  ensureAgencies: (agencies, preferredId) => {
    const fromList = agencies.filter((a) => isPersistedAgencyId(a.id));
    const realAgencies = [...fromList];
    if (
      preferredId &&
      isPersistedAgencyId(preferredId) &&
      !realAgencies.some((a) => a.id === preferredId)
    ) {
      realAgencies.push({
        id: preferredId,
        name: agencies.find((a) => a.id === preferredId)?.name ?? 'Agency',
      });
    }
    if (realAgencies.length === 0) return;

    const idsKey = realAgencies
      .map((a) => a.id)
      .sort()
      .join(',');
    const { bundles: existing, activeAgencyId, loadedFromApi, agencyIdsKey } = get();
    const allLoaded = realAgencies.every((a) => loadedFromApi[a.id] === true);

    if (agencyIdsKey === idsKey && allLoaded) {
      const preferred =
        (preferredId && realAgencies.some((a) => a.id === preferredId) ? preferredId : null) ??
        (activeAgencyId && realAgencies.some((a) => a.id === activeAgencyId) ? activeAgencyId : null) ??
        realAgencies[0]!.id;
      set({
        agencyOptions: realAgencies,
        activeAgencyId: preferred,
        initialized: true,
        bundles: Object.fromEntries(
          realAgencies.map((agency) => [
            agency.id,
            existing[agency.id]
              ? { ...existing[agency.id], agencyName: agency.name }
              : createDefaultAgencyBundle(agency.id, agency.name, 0),
          ]),
        ),
      });
      return;
    }

    const nextBundles: Record<string, AgencyPhoneBundle> = {};

    realAgencies.forEach((agency, index) => {
      if (existing[agency.id] && loadedFromApi[agency.id]) {
        nextBundles[agency.id] = { ...existing[agency.id], agencyName: agency.name };
        return;
      }
      nextBundles[agency.id] = createDefaultAgencyBundle(agency.id, agency.name, index);
    });

    const preferred =
      (preferredId && realAgencies.some((a) => a.id === preferredId) ? preferredId : null) ??
      (activeAgencyId && realAgencies.some((a) => a.id === activeAgencyId) ? activeAgencyId : null) ??
      realAgencies[0]!.id;

    set({
      bundles: nextBundles,
      agencyOptions: realAgencies,
      activeAgencyId: preferred,
      initialized: true,
      loading: true,
      loadError: null,
      agencyIdsKey: idsKey,
    });

    void hydrateBundlesFromApi(realAgencies.map((a) => a.id));
  },

  reloadAgencyBundle: async (agencyId) => {
    if (!isPersistedAgencyId(agencyId)) return;
    set({ loading: true, loadError: null });
    await hydrateBundlesFromApi([agencyId]);
  },

  setActiveAgencyId: (id) => {
    const { agencyOptions, loadedFromApi } = get();
    if (!agencyOptions.some((a) => a.id === id)) return;
    set({ activeAgencyId: id });
    if (!loadedFromApi[id]) {
      set({ loading: true, loadError: null });
      void hydrateBundlesFromApi([id]);
    }
  },

  getActiveBundle: () => {
    const { activeAgencyId, bundles } = get();
    if (!activeAgencyId) return null;
    return bundles[activeAgencyId] ?? null;
  },

  patchActiveBundle: (updater) => {
    const { activeAgencyId, bundles } = get();
    if (!activeAgencyId) return;
    const current = bundles[activeAgencyId];
    if (!current) return;
    const next = updater({ ...current, updatedAt: new Date().toISOString() });
    set({
      bundles: {
        ...bundles,
        [activeAgencyId]: next,
      },
    });
  },

  saveActiveBundle: async () => {
    const bundle = get().getActiveBundle();
    if (!bundle) return null;
    set({ saving: true });
    try {
      const saved = await savePhoneSystemBundle(bundle);
      set((state) => ({
        bundles: { ...state.bundles, [saved.subCompanyId]: migrateBundle(saved) },
        loadedFromApi: { ...state.loadedFromApi, [saved.subCompanyId]: true },
        loadError: null,
        saving: false,
      }));
      return saved;
    } catch (err) {
      set({ saving: false });
      throw err;
    }
  },

  publishActiveFlow: async (draftFlowOverride?: CallFlowGraph) => {
    const bundle = get().getActiveBundle();
    if (!bundle) return;
    set({ saving: true });
    try {
      const toSave =
        draftFlowOverride != null ? { ...bundle, draftFlow: draftFlowOverride } : bundle;
      await savePhoneSystemBundle(toSave);
      const published = await publishPhoneCallFlow(bundle.subCompanyId);
      set((state) => ({
        bundles: { ...state.bundles, [published.subCompanyId]: migrateBundle(published) },
        loadedFromApi: { ...state.loadedFromApi, [published.subCompanyId]: true },
        loadError: null,
        saving: false,
      }));
    } catch (err) {
      set({ saving: false });
      throw err;
    }
  },

  restoreActiveDefaults: async () => {
    const bundle = get().getActiveBundle();
    if (!bundle) return;
    set({ saving: true });
    try {
      const restored = await restorePhoneSystemDefaults(bundle.subCompanyId);
      set((state) => ({
        bundles: { ...state.bundles, [restored.subCompanyId]: migrateBundle(restored) },
        loadedFromApi: { ...state.loadedFromApi, [restored.subCompanyId]: true },
        loadError: null,
        saving: false,
      }));
    } catch (err) {
      set({ saving: false });
      throw err;
    }
  },

  rebuildDraftFlowFromResources: () => {
    get().patchActiveBundle((b) => ({
      ...b,
      draftFlow: buildPrimaryCallFlowGraph(b),
      flowTitle: `Incoming Call Flow · Ext ${b.config.autoAttendantExtension}`,
    }));
  },
}));

export type BundleFieldUpdaters = {
  setConfig: (
    updater: PhoneSystemConfig | ((prev: PhoneSystemConfig) => PhoneSystemConfig),
  ) => void;
  setPhoneNumbers: (
    updater: PhoneNumberRecord[] | ((prev: PhoneNumberRecord[]) => PhoneNumberRecord[]),
  ) => void;
  setMenuRoutes: (updater: MenuRoute[] | ((prev: MenuRoute[]) => MenuRoute[])) => void;
  setRingGroups: (updater: RingGroup[] | ((prev: RingGroup[]) => RingGroup[])) => void;
  setStaffExtensions: (
    updater: StaffExtension[] | ((prev: StaffExtension[]) => StaffExtension[]),
  ) => void;
  setVoicemailBoxes: (
    updater: VoicemailBox[] | ((prev: VoicemailBox[]) => VoicemailBox[]),
  ) => void;
  setAudioClips: (updater: AudioClip[] | ((prev: AudioClip[]) => AudioClip[])) => void;
  setBusinessHours: (
    updater: BusinessHoursDay[] | ((prev: BusinessHoursDay[]) => BusinessHoursDay[]),
  ) => void;
  setFlowTitle: (title: string) => void;
  setDraftFlow: (flow: CallFlowGraph) => void;
  setTwilio: (
    updater: AgencyTwilioConfig | ((prev: AgencyTwilioConfig) => AgencyTwilioConfig),
  ) => void;
};

function resolve<T>(updater: T | ((prev: T) => T), prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
}

export function createBundleUpdaters(
  patch: (updater: (bundle: AgencyPhoneBundle) => AgencyPhoneBundle) => void,
): BundleFieldUpdaters {
  return {
    setConfig: (updater) => {
      patch((b) => {
        const config = resolve(updater, b.config);
        return {
          ...b,
          config,
          flowTitle: `Incoming Call Flow · Ext ${config.autoAttendantExtension}`,
        };
      });
    },
    setPhoneNumbers: (updater) => patch((b) => ({ ...b, phoneNumbers: resolve(updater, b.phoneNumbers) })),
    setMenuRoutes: (updater) => patch((b) => ({ ...b, menuRoutes: resolve(updater, b.menuRoutes) })),
    setRingGroups: (updater) =>
      patch((b) => {
        const ringGroups = resolve(updater, b.ringGroups);
        const { ringGroups: aligned } = alignStaffAndRingGroups(b.staffExtensions ?? [], ringGroups);
        const menuRoutes = deriveMenuRoutesFromRingGroups(
          aligned,
          b.voicemailBoxes,
          b.menuRoutes,
        );
        const syncedFlow = syncConnectGroupNodesInFlow(b.draftFlow, aligned, menuRoutes);
        return {
          ...b,
          ringGroups: aligned,
          menuRoutes,
          draftFlow: ensureExtensionDialInFlow(
            syncedFlow,
            b.staffExtensions ?? [],
            aligned,
            b.config.allowExtensionDialing !== false,
          ),
        };
      }),
    setStaffExtensions: (updater) =>
      patch((b) => {
        const staffExtensions = resolve(updater, b.staffExtensions ?? []);
        const { staffExtensions: alignedStaff, ringGroups } = alignStaffAndRingGroups(
          staffExtensions,
          b.ringGroups,
        );
        return {
          ...b,
          staffExtensions: alignedStaff,
          ringGroups,
          draftFlow: ensureExtensionDialInFlow(
            b.draftFlow,
            alignedStaff,
            ringGroups,
            b.config.allowExtensionDialing !== false,
          ),
        };
      }),
    setVoicemailBoxes: (updater) =>
      patch((b) => ({ ...b, voicemailBoxes: resolve(updater, b.voicemailBoxes) })),
    setAudioClips: (updater) => patch((b) => ({ ...b, audioClips: resolve(updater, b.audioClips) })),
    setBusinessHours: (updater) =>
      patch((b) => ({ ...b, businessHours: resolve(updater, b.businessHours) })),
    setFlowTitle: (title) => patch((b) => ({ ...b, flowTitle: title })),
    setDraftFlow: (flow) => patch((b) => ({ ...b, draftFlow: flow })),
    setTwilio: (updater) => patch((b) => ({ ...b, twilio: resolve(updater, b.twilio) })),
  };
}
