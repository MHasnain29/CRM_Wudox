/**
 * Unauthenticated public endpoints (e.g. login-page branding).
 * Single-tenant: uses the first sub-company row (by createdAt).
 */
import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { getFromR2 } from '../services/r2Storage';

export const publicRouter = Router();

function brandingPayload(row: { id: string; name: string; appProjectName: string | null; logoUrl: string | null }) {
  const custom = row.appProjectName?.trim() ?? '';
  const projectName = custom || row.name.trim() || '';
  return {
    companyId: row.id,
    subCompanyId: row.id,
    projectName,
    logoUrl: row.logoUrl ?? null,
  };
}

/**
 * GET /public/branding
 * Returns branding for the primary sub-company (oldest by createdAt). Empty payload if none exist.
 */
publicRouter.get('/branding', async (_req: Request, res: Response) => {
  const row = await prisma.subCompany.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, appProjectName: true, logoUrl: true },
  });

  if (!row) {
    return res.json({
      companyId: null,
      subCompanyId: null,
      projectName: '',
      logoUrl: null,
    });
  }

  return res.json(brandingPayload(row));
});

/** GET /public/transparent-signature — 1×1 transparent PNG for unsigned agreement image blocks. */
publicRouter.get('/transparent-signature', (_req: Request, res: Response) => {
  const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=', 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  return res.send(buf);
});

/**
 * GET /public/signatures/:authorityId
 * Serves a signing authority's signature image — no auth required.
 * PandaDoc calls this URL to embed the image in the agreement document.
 */
publicRouter.get('/signatures/:authorityId', async (req: Request, res: Response) => {
  const { authorityId } = req.params;
  const authority = await prisma.signingAuthority.findFirst({
    where: { id: authorityId },
    select: { signatureData: true },
  }).catch(() => null);

  if (!authority) return res.status(404).end();

  // PNG/image data URL stored in DB — decode and serve directly
  if (authority.signatureData.startsWith('data:image/')) {
    const [header, base64] = authority.signatureData.split(',');
    const mimeMatch = header.match(/data:([^;]+);/);
    const mimeType = mimeMatch?.[1] ?? 'image/png';
    const buffer = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  }

  // Raw SVG string stored in DB — serve directly
  if (authority.signatureData.trimStart().startsWith('<svg')) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(authority.signatureData);
  }

  // Fallback: try R2 key
  const r2Key = `signatures/${authorityId}.png`;
  const r2Result = await getFromR2(r2Key).catch(() => null);
  if (r2Result) {
    res.setHeader('Content-Type', r2Result.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(r2Result.body);
  }

  return res.status(404).end();
});
