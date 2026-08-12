import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import prisma from '../config/database';
import { uploadToR2 } from '../services/r2Storage';

export const emailSignaturesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

type UploadedSignatureImage = { buffer: Buffer; mimetype: string; originalname: string };
type UploadImageRequest = Request & { file?: UploadedSignatureImage };

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  isDefault: z.boolean().optional(),
});

emailSignaturesRouter.get('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const signatures = await prisma.emailSignature.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return res.json(signatures);
});

emailSignaturesRouter.post('/', authenticate, async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  const userId = req.user!.sub;
  const { name, content, isDefault } = parsed.data;
  if (isDefault) {
    await prisma.emailSignature.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  const sig = await prisma.emailSignature.create({ data: { userId, name, content, isDefault: isDefault ?? false } });
  return res.status(201).json(sig);
});

emailSignaturesRouter.patch('/:id', authenticate, async (req: Request, res: Response) => {
  const parsed = bodySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  const userId = req.user!.sub;
  const existing = await prisma.emailSignature.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (parsed.data.isDefault) {
    await prisma.emailSignature.updateMany({ where: { userId }, data: { isDefault: false } });
  }
  const sig = await prisma.emailSignature.update({ where: { id: req.params.id }, data: parsed.data });
  return res.json(sig);
});

emailSignaturesRouter.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const existing = await prisma.emailSignature.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await prisma.emailSignature.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

/** POST /email-signatures/upload-image — upload an image for use in signatures */
emailSignaturesRouter.post('/upload-image', authenticate, upload.single('image'), async (req: UploadImageRequest, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No image provided' });
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (!allowed.includes(file.mimetype)) return res.status(400).json({ error: 'Only image files are allowed' });
  const ext = file.originalname.split('.').pop() ?? 'png';
  const key = `signature-images/${req.user!.sub}/${Date.now()}.${ext}`;
  const url = await uploadToR2(key, file.buffer, file.mimetype);
  if (!url) return res.status(500).json({ error: 'Upload failed' });
  return res.json({ url });
});
