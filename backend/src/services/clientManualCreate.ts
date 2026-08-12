import { z } from 'zod';
import prisma from '../config/database';

export const createClientSchema = z.object({
  name: z.string().min(1).max(500),
  industry: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  address: z.string().max(1000).optional(),
  companySize: z.string().max(100).optional(),
  tags: z.array(z.string().min(1).max(100).trim()).optional(),
  contacts: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        title: z.string().max(200).optional(),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().max(50).optional(),
        phoneExtension: z.string().max(20).optional(),
        linkedin: z.string().url().optional().or(z.literal('')),
        website: z.string().url().optional().or(z.literal('')),
        isPrimary: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
  locationAddress: z
    .object({
      unit: z.string().max(50).optional(),
      streetAddress: z.string().max(300).optional(),
      city: z.string().max(100).optional(),
      region: z.string().max(100).optional(),
      postalCode: z.string().max(20).optional(),
      country: z.string().max(50).optional(),
    })
    .optional(),
  /** Database Manager / Super User + both mode: global vs agency for this add. */
  databaseDestination: z.enum(['global', 'agency']).optional(),
});

export type CreateClientBody = z.infer<typeof createClientSchema>;

type DbClientTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Shared create path for manual Add Client and director approval of a pending submission. */
export async function performManualClientCreate(
  tx: DbClientTx,
  params: {
    data: CreateClientBody;
    subCompanyId: string | null;
    corporateCode: string;
    visibility: 'global' | 'agency';
    createdByRole: string | null;
    createdById?: string | null;
    skipClientSubCompany?: boolean;
  },
) {
  const { data, subCompanyId, corporateCode, visibility, createdByRole, createdById, skipClientSubCompany } = params;

  const primaryContactIndex = data.contacts.findIndex((contact) => contact.isPrimary === true);
  const normalizedContacts = data.contacts.map((contact, index) => ({
    ...contact,
    isPrimary: primaryContactIndex >= 0 ? index === primaryContactIndex : index === 0,
  }));

  const uniqueTags = [...new Set((data.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];

  const client = await tx.client.create({
    data: {
      corporateCode,
      name: data.name.trim(),
      industry: data.industry?.trim() ?? null,
      location: data.location?.trim() ?? null,
      address: data.address?.trim() ?? null,
      companySize: data.companySize?.trim() ?? null,
      status: 'contacted',
      visibility,
      createdByRole,
      createdById: createdById ?? null,
      ...(visibility === 'global' ? { visibilityPromotedAt: new Date() } : {}),
    },
  });

  if (data.locationAddress && (data.locationAddress.streetAddress || data.locationAddress.city)) {
    const addr = data.locationAddress;
    const fullAddress = [addr.unit, addr.streetAddress, addr.city, addr.region, addr.postalCode]
      .filter(Boolean)
      .join(', ');
    await tx.clientLocation.create({
      data: {
        clientId: client.id,
        name: addr.city || 'Primary',
        address: (fullAddress || addr.streetAddress) ?? null,
        city: addr.city ?? null,
        region: addr.region ?? null,
        postalCode: addr.postalCode ?? null,
        country: addr.country ?? null,
        isPrimary: true,
      },
    });
  }

  await tx.clientContact.createMany({
    data: normalizedContacts.map((contact) => ({
      clientId: client.id,
      name: contact.name.trim(),
      title: contact.title?.trim() ?? null,
      email: contact.email?.trim() || null,
      phone: contact.phone?.trim() ?? null,
      phoneExtension: contact.phoneExtension?.trim() ?? null,
      linkedin: contact.linkedin?.trim() || null,
      website: contact.website?.trim() || null,
      isPrimary: contact.isPrimary,
    })),
  });

  if (!skipClientSubCompany && subCompanyId) {
    await tx.clientSubCompany.create({
      data: { clientId: client.id, subCompanyId, status: 'contacted' },
    });
  }

  if (uniqueTags.length > 0 && subCompanyId) {
    await tx.clientTag.createMany({
      data: uniqueTags.map((tag) => ({
        clientId: client.id,
        subCompanyId,
        tag,
      })),
      skipDuplicates: true,
    });
  }

  return tx.client.findUnique({
    where: { id: client.id },
    include: {
      contacts: true,
      locations: true,
      tags: subCompanyId ? { where: { subCompanyId } } : false,
    },
  });
}

export function pendingSubmissionToCreateBody(row: {
  name: string;
  industry: string | null;
  location: string | null;
  address: string | null;
  companySize: string | null;
  tags: string[];
  contacts: unknown;
  locationAddress: unknown;
}): CreateClientBody | null {
  const contactsRaw = row.contacts;
  const loc = row.locationAddress;
  const raw = {
    name: row.name,
    industry: row.industry ?? undefined,
    location: row.location ?? undefined,
    address: row.address ?? undefined,
    companySize: row.companySize ?? undefined,
    tags: row.tags?.length ? row.tags : undefined,
    contacts: Array.isArray(contactsRaw) ? contactsRaw : [],
    locationAddress:
      loc && typeof loc === 'object' && !Array.isArray(loc)
        ? (loc as CreateClientBody['locationAddress'])
        : undefined,
  };
  const parsed = createClientSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
