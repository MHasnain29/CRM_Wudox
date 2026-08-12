export type ClientDestinationConfig = {
  userFlow: 'database_manager' | 'super_user';
  destination: 'global' | 'agency' | 'both';
  globalManualAddMode: 'bypass' | 'route';
  globalImportMode: 'bypass' | 'route';
  agencyManualAddPath: 'pending' | 'direct';
};

/** Normal agency roles — Settings → Approvals (per agency). */
export type AgencyClientFlowConfig = {
  userFlow: 'agency';
  agencyName: string;
  visibilityDays: number | null;
  manualAddMode: 'bypass' | 'route';
  importMode: 'bypass' | 'route';
  /** Own-scope roles queue manual add before agency workflow runs. */
  manualAddRequiresPending: boolean;
  /** Own-scope associates need approval unless agency import policy bypasses. */
  importRequiresApproval: boolean;
  dataScopeLevel: string;
};

export type ClientFlowConfig = ClientDestinationConfig | AgencyClientFlowConfig;

/** @deprecated Use ClientFlowConfig */
export type DatabaseManagerImportConfig = ClientDestinationConfig;

export function isElevatedClientFlowConfig(
  config: ClientFlowConfig | null | undefined,
): config is ClientDestinationConfig {
  return config?.userFlow === 'database_manager' || config?.userFlow === 'super_user';
}

export function isAgencyClientFlowConfig(
  config: ClientFlowConfig | null | undefined,
): config is AgencyClientFlowConfig {
  return config?.userFlow === 'agency';
}

export function normalizeClientDestinationConfig(
  raw: Partial<ClientDestinationConfig> & {
    destination: ClientDestinationConfig['destination'];
    userFlow?: ClientDestinationConfig['userFlow'];
  },
): ClientDestinationConfig {
  return {
    userFlow:
      raw.userFlow === 'super_user' ? 'super_user' : 'database_manager',
    destination: raw.destination,
    globalManualAddMode: raw.globalManualAddMode === 'bypass' ? 'bypass' : 'route',
    globalImportMode: raw.globalImportMode === 'bypass' ? 'bypass' : 'route',
    agencyManualAddPath: raw.agencyManualAddPath === 'direct' ? 'direct' : 'pending',
  };
}

export function normalizeClientFlowConfig(raw: Record<string, unknown>): ClientFlowConfig {
  if (raw.userFlow === 'agency') {
    return {
      userFlow: 'agency',
      agencyName: typeof raw.agencyName === 'string' ? raw.agencyName : 'Agency',
      visibilityDays:
        typeof raw.visibilityDays === 'number' ? raw.visibilityDays : null,
      manualAddMode: raw.manualAddMode === 'bypass' ? 'bypass' : 'route',
      importMode: raw.importMode === 'bypass' ? 'bypass' : 'route',
      manualAddRequiresPending: raw.manualAddRequiresPending === true,
      importRequiresApproval: raw.importRequiresApproval !== false,
      dataScopeLevel: typeof raw.dataScopeLevel === 'string' ? raw.dataScopeLevel : 'own',
    };
  }
  return normalizeClientDestinationConfig(
    raw as Partial<ClientDestinationConfig> & {
      destination: ClientDestinationConfig['destination'];
      userFlow?: ClientDestinationConfig['userFlow'];
    },
  );
}

type FlowContext = {
  flow: 'manual_add' | 'import';
  selectedDestination?: 'global' | 'agency' | '';
  selectedAgencyName?: string;
};

function describeAgencyClientFlow(
  config: AgencyClientFlowConfig,
  ctx: FlowContext,
): string {
  const isImport = ctx.flow === 'import';
  const days = config.visibilityDays ?? 7;
  const visibilityNote =
    days <= 0
      ? 'Visible org-wide immediately after approval (Client Visibility days = 0).'
      : `Agency-only for ${days} ${days === 1 ? 'day' : 'days'} after approval, then shared org-wide (Settings → Client Visibility).`;

  if (isImport) {
    if (config.importMode === 'bypass') {
      return `CSV import for ${config.agencyName}: agency policy bypasses approval (Settings → Approvals → Client import). Then ${visibilityNote}`;
    }
    return `CSV import for ${config.agencyName}: goes to Pending for agency approval (Settings → Approvals → Client import), then ${visibilityNote}`;
  }

  if (config.manualAddMode === 'bypass') {
    return `Manual add for ${config.agencyName}: agency policy bypasses approval (Settings → Approvals → Client manual add). Then ${visibilityNote}`;
  }

  return `Manual add for ${config.agencyName}: goes to Pending for agency approval (Settings → Approvals → Client manual add), then ${visibilityNote}`;
}

/** User-facing summary aligned with Settings → Approvals (agency or org/global). */
export function describeClientDestinationFlow(
  config: ClientDestinationConfig | null | undefined,
  ctx: FlowContext,
): string | null {
  if (!config) return null;

  const isImport = ctx.flow === 'import';
  const globalDirect = (isImport ? config.globalImportMode : config.globalManualAddMode) === 'bypass';
  const bothMode = config.destination === 'both';
  const agencyOnly = config.destination === 'agency';
  const agencyPath = agencyOnly || (bothMode && ctx.selectedDestination === 'agency');
  const globalPath = config.destination === 'global' || (bothMode && ctx.selectedDestination === 'global');
  const settingsLabel =
    config.userFlow === 'database_manager'
      ? 'Database Manager — add & import destination'
      : 'Super Users — add & import destination';

  if (bothMode && !ctx.selectedDestination) {
    return isImport
      ? `Choose global database or agency for this import (${settingsLabel}).`
      : `Choose global database or agency for this client (${settingsLabel}).`;
  }

  if (agencyPath) {
    if (!ctx.selectedAgencyName) {
      return agencyOnly
        ? 'Agency-only mode — select an agency below before continuing.'
        : 'Select an agency below for this client.';
    }
    if (isImport) {
      return `Import goes to ${ctx.selectedAgencyName} for agency approval (Settings → Approvals → Client import), then Client Visibility → org-wide sharing.`;
    }
    return `Client goes to ${ctx.selectedAgencyName} for agency approval (Settings → Approvals → Client manual add), then Client Visibility → org-wide sharing.`;
  }

  if (globalPath) {
    if (globalDirect) {
      return isImport
        ? 'Import goes directly to the global database (no pending queue). Client Visibility does not apply.'
        : 'Client goes directly to the global database (no pending queue). Client Visibility does not apply.';
    }
    const workflowLabel = isImport ? 'CSV import' : 'manual add';
    return isImport
      ? `Import goes to the global database approval queue (Settings → Approvals → Global database — ${workflowLabel}).`
      : `Client goes to the global database approval queue (Settings → Approvals → Global database — ${workflowLabel}).`;
  }

  return null;
}

export function describeClientFlow(
  config: ClientFlowConfig | null | undefined,
  ctx: FlowContext,
): string | null {
  if (!config) return null;
  if (isAgencyClientFlowConfig(config)) {
    return describeAgencyClientFlow(config, ctx);
  }
  return describeClientDestinationFlow(config, ctx);
}
