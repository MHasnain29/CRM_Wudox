import prisma from '../config/database';
import { env } from '../config/env';
import { isR2Configured, uploadToR2, getR2SignedUrl } from './r2Storage';

export type SigningAuthorityRecord = {
  id: string;
  subCompanyId: string;
  name: string;
  signatureData: string;
  fontFamily: string;
  isPrimary: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function getSigningAuthorities(subCompanyId: string): Promise<SigningAuthorityRecord[]> {
  return prisma.signingAuthority.findMany({
    where: { subCompanyId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createSigningAuthority(
  subCompanyId: string,
  createdBy: string,
  data: { name: string; signatureData: string; fontFamily: string },
): Promise<SigningAuthorityRecord> {
  const existing = await prisma.signingAuthority.findFirst({
    where: { subCompanyId, isPrimary: true },
    select: { id: true },
  });
  return prisma.signingAuthority.create({
    data: {
      subCompanyId,
      createdBy,
      name: data.name,
      signatureData: data.signatureData,
      fontFamily: data.fontFamily,
      isPrimary: existing === null,
    },
  });
}

export async function updateSigningAuthority(
  id: string,
  subCompanyId: string,
  data: { name?: string; signatureData?: string; fontFamily?: string },
): Promise<SigningAuthorityRecord> {
  return prisma.signingAuthority.update({
    where: { id, subCompanyId },
    data,
  });
}

export async function setPrimarySigningAuthority(id: string, subCompanyId: string): Promise<void> {
  await prisma.$transaction([
    prisma.signingAuthority.updateMany({ where: { subCompanyId }, data: { isPrimary: false } }),
    prisma.signingAuthority.update({ where: { id, subCompanyId }, data: { isPrimary: true } }),
  ]);
}

/**
 * Public HTTPS URL for a signing-authority image so PandaDoc can fetch it.
 * Prefer R2 (signed or public URL) — works without a live ngrok tunnel.
 * Falls back to PUBLIC_API_URL / APP_URL public signature route.
 */
export async function uploadSignatureImageToR2(authorityId: string, signatureData: string): Promise<string | null> {
  try {
    if (!signatureData.startsWith('data:image/')) return null;

    const [header, base64] = signatureData.split(',');
    if (!base64) return null;
    const mimeMatch = header.match(/data:([^;]+);/);
    const mimeType = mimeMatch?.[1] ?? 'image/png';
    const buffer = Buffer.from(base64, 'base64');
    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const key = `signing-authorities/${authorityId}.${ext}`;

    if (isR2Configured()) {
      const uploaded = await uploadToR2(key, buffer, mimeType);
      if (uploaded && /^https?:\/\//i.test(uploaded)) return uploaded;
      const signed = await getR2SignedUrl(key, 60 * 60 * 24 * 7);
      if (signed) return signed;
    }

    // Local/dev fallback — only works if PUBLIC_API_URL is reachable by PandaDoc (live ngrok).
    const base = (env.PUBLIC_API_URL ?? env.APP_URL ?? '').replace(/\/$/, '');
    if (!base || /localhost|127\.0\.0\.1/i.test(base)) {
      console.warn(
        `[signingAuthority] No public R2 URL and PUBLIC_API_URL is local/unreachable for PandaDoc — authority ${authorityId}`,
      );
      return null;
    }
    return `${base}/api/v1/public/signatures/${authorityId}`;
  } catch (err) {
    console.warn(`[signingAuthority] Failed to build signature URL for authority ${authorityId}:`, err);
    return null;
  }
}

export async function deleteSigningAuthority(id: string, subCompanyId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const record = await tx.signingAuthority.findFirst({ where: { id, subCompanyId } });
    if (!record) return;

    await tx.signingAuthority.delete({ where: { id } });

    if (record.isPrimary) {
      const next = await tx.signingAuthority.findFirst({
        where: { subCompanyId },
        orderBy: { createdAt: 'asc' },
      });
      if (next) {
        await tx.signingAuthority.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    }
  });
}
