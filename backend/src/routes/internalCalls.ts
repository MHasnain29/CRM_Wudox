/**
 * Internal chat calling (WebRTC) — ICE server config only.
 * Signaling is handled over Socket.IO (internal-call:* events).
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { env } from '../config/env';

export const internalCallsRouter = Router();

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_ICE: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function parseIceServers(): IceServer[] {
  const raw = env.INTERNAL_CALL_ICE_SERVERS?.trim();
  if (!raw) return DEFAULT_ICE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ICE;
    return parsed as IceServer[];
  } catch {
    return DEFAULT_ICE;
  }
}

/** GET /internal-calls/ice-config — RTCConfiguration.iceServers for browser WebRTC */
internalCallsRouter.get('/ice-config', authenticate, (_req: Request, res: Response) => {
  res.json({ iceServers: parseIceServers() });
});
