import type { SubCompany } from '@prisma/client';

/** Fields safe to return on agency APIs / auth payloads — never includes googleRefreshToken. */
export type AgencyPublicDto = {
  id: string;
  name: string;
  mainOrgId: string;
  appProjectName: string | null;
  logoUrl: string | null;
  agencyLogoUrl: string | null;
  agencyEmail: string | null;
  agencyPhone: string | null;
  emailFooterText: string | null;
  emailTagline: string | null;
  emailFromAddress: string | null;
  emailFromName: string | null;
  emailSendAsDomain: string | null;
  emailInboundDomain: string | null;
  emailInboundLocalpart: string | null;
  googleCalendarConnected: boolean;
  googleConnectedEmail: string | null;
};

/** Prisma select that omits googleRefreshToken and other non-public columns. */
export const agencyPublicSelect = {
  id: true,
  name: true,
  mainOrgId: true,
  appProjectName: true,
  logoUrl: true,
  agencyLogoUrl: true,
  agencyEmail: true,
  agencyPhone: true,
  emailFooterText: true,
  emailTagline: true,
  emailFromAddress: true,
  emailFromName: true,
  emailSendAsDomain: true,
  emailInboundDomain: true,
  emailInboundLocalpart: true,
  googleCalendarConnected: true,
  googleConnectedEmail: true,
} as const;

type AgencyPublicSource = Pick<SubCompany, keyof typeof agencyPublicSelect>;

/** Strip secrets before returning sub-company on auth / agency list / update payloads. */
export function safeSubCompanyForClient(
  sc: AgencyPublicSource | SubCompany | null | undefined,
): AgencyPublicDto | null {
  if (!sc) return null;
  return {
    id: sc.id,
    name: sc.name,
    mainOrgId: sc.mainOrgId,
    appProjectName: sc.appProjectName ?? null,
    logoUrl: sc.logoUrl ?? null,
    agencyLogoUrl: sc.agencyLogoUrl ?? null,
    agencyEmail: sc.agencyEmail ?? null,
    agencyPhone: sc.agencyPhone ?? null,
    emailFooterText: sc.emailFooterText ?? null,
    emailTagline: sc.emailTagline ?? null,
    emailFromAddress: sc.emailFromAddress ?? null,
    emailFromName: sc.emailFromName ?? null,
    emailSendAsDomain: sc.emailSendAsDomain ?? null,
    emailInboundDomain: sc.emailInboundDomain ?? null,
    emailInboundLocalpart: sc.emailInboundLocalpart ?? null,
    googleCalendarConnected: sc.googleCalendarConnected,
    googleConnectedEmail: sc.googleConnectedEmail ?? null,
  };
}
