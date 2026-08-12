import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { requireSettingsWrite } from '../middleware/requireSettingsAccess';
import { resolveAgencyScope } from '../config/agencyScope';
import prisma from '../config/database';
import { uploadToR2, getFromR2 } from '../services/r2Storage';
import { extractAnchors } from '../services/reviewPdf/anchors/extractAnchors';

const router = Router();
router.use(authenticate);

const VALID_DOC_TYPES = ['temp_agreement', 'direct_placement', 'both_agreement'] as const;
type DocType = (typeof VALID_DOC_TYPES)[number];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function getEffectiveSubCompanyId(req: Request): Promise<string | null> {
  return resolveAgencyScope(req);
}

// GET /review-templates — list active templates for the (resolved) agency
router.get('/', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const templates = await prisma.reviewTemplate.findMany({
    where: { subCompanyId, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      documentType: true,
      originalFilename: true,
      createdAt: true,
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return res.json({ templates });
});

// POST /review-templates — upload PDF template (directors only)
// Body (multipart): documentType, file (PDF); optional ?subCompanyId= for elevated users
// Replaces the active template for that slot by soft-retiring the old row (keeps history FKs).
router.post('/', requireSettingsWrite, upload.single('file'), async (req: Request, res: Response) => {
  const user = req.user!;
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const file = (req as any).file as { originalname: string; buffer: Buffer; mimetype: string } | undefined;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  if (!file.originalname.toLowerCase().endsWith('.pdf') && file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF files are allowed' });
  }

  const { documentType } = req.body as { documentType: string };
  if (!documentType || !VALID_DOC_TYPES.includes(documentType as DocType)) {
    return res.status(400).json({ error: 'Invalid documentType. Must be: temp_agreement, direct_placement, or both_agreement' });
  }

  // Soft-retire existing active template(s) of same type — do not hard-delete so
  // proposal.reviewTemplateId history can still resolve the old file.
  await prisma.reviewTemplate.updateMany({
    where: { subCompanyId, documentType, isActive: true },
    data: { isActive: false },
  });

  const fileKey = `review-templates/${subCompanyId}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await uploadToR2(fileKey, file.buffer, 'application/pdf');

  // Extract anchor positions for overlay filling. Failures must NOT block
  // the upload — render will fall back to returning the original PDF unfilled.
  let anchorMap: unknown = null;
  let anchorStats: { detected: string[]; missed: string[]; totalOccurrences: number } | null = null;
  try {
    const result = await extractAnchors(file.buffer);
    if (result.detected.length > 0) {
      anchorMap = result.map;
    }
    anchorStats = {
      detected: result.detected,
      missed: result.missed,
      totalOccurrences: result.totalOccurrences,
    };
    console.log(
      `[review-template] anchors: ${result.detected.length}/${result.detected.length + result.missed.length} tokens detected, ${result.totalOccurrences} occurrences`,
      { detected: result.detected, missed: result.missed, fileKey },
    );
  } catch (err) {
    console.warn('[review-template] anchor extraction threw — PDF will be returned unfilled on render', err);
  }

  const template = await prisma.reviewTemplate.create({
    data: {
      name: documentType,
      documentType,
      originalFilename: file.originalname,
      fileKey,
      anchorMap: anchorMap as any,
      isActive: true,
      subCompanyId,
      uploadedById: user.sub,
    },
    select: { id: true, name: true, documentType: true, originalFilename: true, createdAt: true },
  });

  // Point DOCX/mapping slots at the new active template when they previously
  // referenced a now-retired row of the same document type.
  const mapping = await prisma.reviewTemplateMapping.findUnique({
    where: { subCompanyId },
    include: {
      tempTemplate: { select: { id: true, documentType: true } },
      directTemplate: { select: { id: true, documentType: true } },
      bothTemplate: { select: { id: true, documentType: true } },
    },
  });
  if (mapping) {
    const patch: {
      tempTemplateId?: string;
      directTemplateId?: string;
      bothTemplateId?: string;
    } = {};
    if (mapping.tempTemplate?.documentType === documentType) patch.tempTemplateId = template.id;
    if (mapping.directTemplate?.documentType === documentType) patch.directTemplateId = template.id;
    if (mapping.bothTemplate?.documentType === documentType) patch.bothTemplateId = template.id;
    if (Object.keys(patch).length > 0) {
      await prisma.reviewTemplateMapping.update({
        where: { subCompanyId },
        data: patch,
      });
    }
  }

  return res.status(201).json({ template, anchorStats });
});

// GET /review-templates/:id/preview — inline PDF preview
router.get('/:id/preview', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const template = await prisma.reviewTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found' });
  if (template.subCompanyId !== subCompanyId) return res.status(403).json({ error: 'Not authorized' });
  // Allow preview of retired templates (history / admin inspection).

  try {
    const result = await getFromR2(template.fileKey);
    if (!result) return res.status(404).json({ error: 'File not found in storage' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(template.originalFilename)}"`);
    return res.send(result.body);
  } catch (err) {
    console.error('[review-templates/preview]', err);
    return res.status(502).json({ error: 'Failed to load file' });
  }
});

// GET /review-templates/:id/download
router.get('/:id/download', async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const template = await prisma.reviewTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found' });
  if (template.subCompanyId !== subCompanyId) return res.status(403).json({ error: 'Not authorized' });

  try {
    const result = await getFromR2(template.fileKey);
    if (!result) return res.status(404).json({ error: 'File not found in storage' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(template.originalFilename)}"`);
    return res.send(result.body);
  } catch (err) {
    console.error('[review-templates/download]', err);
    return res.status(502).json({ error: 'Failed to fetch file from storage' });
  }
});

// DELETE /review-templates/:id — soft-retire (keeps row for proposal history FKs)
router.delete('/:id', requireSettingsWrite, async (req: Request, res: Response) => {
  const subCompanyId = await getEffectiveSubCompanyId(req);
  if (!subCompanyId) return res.status(403).json({ error: 'Agency context required' });

  const template = await prisma.reviewTemplate.findUnique({ where: { id: req.params.id } });
  if (!template) return res.status(404).json({ error: 'Template not found' });
  if (template.subCompanyId !== subCompanyId) return res.status(403).json({ error: 'Not authorized' });

  await prisma.reviewTemplate.update({
    where: { id: template.id },
    data: { isActive: false },
  });
  return res.json({ success: true });
});

export default router;
