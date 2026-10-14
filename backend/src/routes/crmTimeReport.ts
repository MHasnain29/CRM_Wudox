import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { authenticate } from '../middleware/auth';
import { buildCrmTimeReport } from '../services/crmTimeReport';

export const crmTimeReportRouter = Router();

export async function crmTimeReportHandler(req: Request, res: Response) {
  if (!req.user?.sub) return res.status(401).json({ error: 'Unauthorized' });
  try {
    return res.json(await buildCrmTimeReport(req.user.sub, req.query));
  } catch (error) {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid query', details: error.flatten() });
    if ((error as { status?: number })?.status === 403) return res.status(403).json({ error: error instanceof Error ? error.message : 'Forbidden' });
    console.error('[crmTimeReport] Unable to load recorded CRM time:', error);
    return res.status(500).json({ error: 'Unable to load recorded CRM time' });
  }
}

crmTimeReportRouter.get('/crm-time', authenticate, crmTimeReportHandler);
