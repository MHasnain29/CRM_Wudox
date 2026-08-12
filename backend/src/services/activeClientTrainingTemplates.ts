/**
 * Allowlisted PandaDoc templates for Active Client training.
 * Fixed set for demo / product — not a free-text picker.
 */

export type ActiveClientTrainingTemplateOption = {
  id: string;
  name: string;
};

export const ACTIVE_CLIENT_TRAINING_PANDA_TEMPLATES: ActiveClientTrainingTemplateOption[] = [
  {
    id: 'Ev3upM2rNemT3zgcWkieR2',
    name: 'AWFI - 2025 Smoke-Free Workplace Policy',
  },
  {
    id: '7L84RuEDRffWMMdjqSyohh',
    name: 'GMP training',
  },
];

const byId = new Map(ACTIVE_CLIENT_TRAINING_PANDA_TEMPLATES.map((t) => [t.id, t]));

export function isAllowedActiveClientTrainingTemplateId(id: string | null | undefined): boolean {
  return Boolean(id && byId.has(id));
}

export function resolveActiveClientTrainingTemplate(
  id: string,
): ActiveClientTrainingTemplateOption {
  const hit = byId.get(id);
  if (!hit) {
    throw Object.assign(new Error('Invalid client training PandaDoc template'), { status: 400 });
  }
  return hit;
}

/** Snapshot key on ActiveClientTrainingAssignment when using PandaDoc (not R2). */
export function pandaDocTrainingSnapshotKey(templateId: string): string {
  return `pandadoc:${templateId}`;
}

export function isPandaDocTrainingSnapshotKey(key: string | null | undefined): boolean {
  return Boolean(key?.startsWith('pandadoc:'));
}

export function templateIdFromSnapshotKey(key: string): string | null {
  if (!isPandaDocTrainingSnapshotKey(key)) return null;
  return key.slice('pandadoc:'.length) || null;
}
