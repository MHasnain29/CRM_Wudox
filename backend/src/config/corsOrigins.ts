import { env } from './env';

/** Localhost and private LAN origins (Vite network URL, etc.) — dev only. */
const DEV_LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

export function getAllowedCorsOrigins(): string[] {
  return env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
}

export function corsOriginDelegate(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }
  if (getAllowedCorsOrigins().includes(origin)) {
    callback(null, true);
    return;
  }
  if (env.NODE_ENV === 'development' && DEV_LOCAL_ORIGIN.test(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`CORS: origin ${origin} not allowed`));
}
