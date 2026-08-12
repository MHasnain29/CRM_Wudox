import { useCallback, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import {
  usePhoneSystemAgencyStore,
  createBundleUpdaters,
} from '@/lib/phoneSystemAgencyStore';
import type { AgencyPhoneBundle } from '@/lib/phoneSystemAgencyBundle';

export function useActivePhoneBundle() {
  const subCompanies = useStore((s) => s.subCompanies);
  const currentSubCompany = useStore((s) => s.currentSubCompany);

  const initialized = usePhoneSystemAgencyStore((s) => s.initialized);
  const loading = usePhoneSystemAgencyStore((s) => s.loading);
  const loadedFromApi = usePhoneSystemAgencyStore((s) => s.loadedFromApi);
  const loadError = usePhoneSystemAgencyStore((s) => s.loadError);
  const activeAgencyId = usePhoneSystemAgencyStore((s) => s.activeAgencyId);
  const agencyOptions = usePhoneSystemAgencyStore((s) => s.agencyOptions);
  const bundle = usePhoneSystemAgencyStore((s) =>
    s.activeAgencyId ? s.bundles[s.activeAgencyId] : null,
  );

  const ensureAgencies = usePhoneSystemAgencyStore((s) => s.ensureAgencies);
  const reloadAgencyBundle = usePhoneSystemAgencyStore((s) => s.reloadAgencyBundle);
  const setActiveAgencyId = usePhoneSystemAgencyStore((s) => s.setActiveAgencyId);
  const patchActiveBundle = usePhoneSystemAgencyStore((s) => s.patchActiveBundle);
  const saveActiveBundle = usePhoneSystemAgencyStore((s) => s.saveActiveBundle);
  const publishActiveFlow = usePhoneSystemAgencyStore((s) => s.publishActiveFlow);
  const restoreActiveDefaults = usePhoneSystemAgencyStore((s) => s.restoreActiveDefaults);
  const rebuildDraftFlowFromResources = usePhoneSystemAgencyStore((s) => s.rebuildDraftFlowFromResources);

  useEffect(() => {
    if (subCompanies.length === 0) return;
    ensureAgencies(
      subCompanies.map((s) => ({ id: s.id, name: s.name })),
      currentSubCompany?.id,
    );
  }, [subCompanies, currentSubCompany?.id, ensureAgencies]);

  const updaters = useMemo(() => createBundleUpdaters(patchActiveBundle), [patchActiveBundle]);

  const saveBundle = useCallback(async () => {
    return saveActiveBundle();
  }, [saveActiveBundle]);

  if (!initialized || !bundle || !activeAgencyId || loading) {
    return null;
  }

  const apiStatus = loadedFromApi[activeAgencyId];
  if (apiStatus !== true && apiStatus !== false) {
    return null;
  }

  return {
    bundle,
    activeAgencyId,
    agencyOptions,
    loadError,
    reloadAgencyBundle,
    setActiveAgencyId,
    saveBundle,
    publishActiveFlow,
    restoreActiveDefaults,
    rebuildDraftFlowFromResources,
    patchActiveBundle,
    ...updaters,
    config: bundle.config,
    phoneNumbers: bundle.phoneNumbers,
    menuRoutes: bundle.menuRoutes,
    ringGroups: bundle.ringGroups,
    staffExtensions: bundle.staffExtensions ?? [],
    voicemailBoxes: bundle.voicemailBoxes,
    audioClips: bundle.audioClips,
    businessHours: bundle.businessHours,
    readinessSteps: bundle.readinessSteps,
    draftFlow: bundle.draftFlow,
    publishedFlow: bundle.publishedFlow,
    flowTitle: bundle.flowTitle,
    twilio: bundle.twilio,
    setTwilio: updaters.setTwilio,
  };
}

export type ActivePhoneBundle = NonNullable<ReturnType<typeof useActivePhoneBundle>>;
