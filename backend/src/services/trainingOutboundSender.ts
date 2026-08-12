/**
 * Training-only outbound From resolution (default + standalone training emails).
 * Matches CRM compose: keep agency branding, surface sender-domain errors, fail closed if no From.
 * Does not change resolveOutboundUserSender behavior for other features.
 */
import prisma from '../config/database';
import {
  getAgencyBranding,
  resolveOutboundUserSender,
  type AgencyBranding,
} from './email';
import { isSenderDomainError } from './senderDomainErrors';

export type TrainingOutboundSender = {
  from: { email: string; name: string };
  agency: AgencyBranding | undefined;
  /** Display name for email body ("X has sent required training…"). */
  sentByName: string;
};

export type TrainingOutboundSenderResult =
  | { ok: true; sender: TrainingOutboundSender }
  | { ok: false; error: string };

export async function resolveTrainingOutboundSender(params: {
  sentByUserId: string;
  subCompanyId: string;
}): Promise<TrainingOutboundSenderResult> {
  const agencyFallback = await getAgencyBranding(params.subCompanyId);

  let agency = agencyFallback;
  let fromEmail = '';
  let fromName = agencyFallback?.emailFromName || agencyFallback?.name || 'NA Staffing CRM';
  let usedUserFrom = false;

  try {
    const resolved = await resolveOutboundUserSender({
      userId: params.sentByUserId,
      subCompanyId: params.subCompanyId,
    });
    agency = resolved.agency ?? agencyFallback;
    if (resolved.from.email?.trim()) {
      fromEmail = resolved.from.email.trim();
      fromName = resolved.from.name?.trim() || fromName;
      usedUserFrom = true;
    }
  } catch (err) {
    if (isSenderDomainError(err)) {
      return { ok: false, error: err.message };
    }
    console.warn('[trainingOutboundSender] resolve failed; using agency From', err);
  }

  if (!fromEmail) {
    fromEmail = (agency?.emailFromAddress || '').trim();
    fromName = agency?.emailFromName || agency?.name || fromName;
  }

  if (!fromEmail) {
    return {
      ok: false,
      error: 'No From address configured for training email (agency email or send-as).',
    };
  }

  let sentByName = usedUserFrom ? fromName || 'Recruitment' : 'Recruitment';
  if (sentByName === 'Recruitment') {
    const sender = await prisma.user.findUnique({
      where: { id: params.sentByUserId },
      select: { firstName: true, lastName: true },
    });
    sentByName =
      `${sender?.firstName ?? ''} ${sender?.lastName ?? ''}`.trim() || 'Recruitment';
  }

  return {
    ok: true,
    sender: {
      from: { email: fromEmail, name: fromName },
      agency,
      sentByName,
    },
  };
}

/** Format SendGrid / Error into a staff-visible message (training path only). */
export function formatTrainingSendError(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to send training email. Try again.';
  const sgErrors = (err as { response?: { body?: { errors?: Array<{ message?: string }> } } })
    ?.response?.body?.errors;
  if (Array.isArray(sgErrors) && sgErrors.length > 0) {
    const detail = sgErrors
      .map((e) => e?.message)
      .filter(Boolean)
      .join('; ');
    if (detail) return `${err.message}: ${detail}`;
  }
  return err.message || 'Failed to send training email. Try again.';
}
