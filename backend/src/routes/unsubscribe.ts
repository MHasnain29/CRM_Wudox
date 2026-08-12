/**
 * Public unsubscribe endpoint — no auth required.
 * Called when a contact clicks the "Unsubscribe" link in a bulk campaign email.
 *
 * The link contains a signed JWT: { contactId, email, campaignId }
 * On success: marks ClientContact.isUnsubscribed = true for that contact only.
 * Does NOT affect other contacts or the client's agency status.
 */
import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { env } from '../config/env';

export const unsubscribeRouter = Router();

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 12px; padding: 40px 48px; max-width: 440px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    h1 { font-size: 20px; color: #111; margin: 0 0 12px; }
    p { color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

/** GET /api/v1/unsubscribe?token=xxx */
unsubscribeRouter.get('/', async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    return res.status(400).send(htmlPage('Invalid Link', '<h1>Invalid Link</h1><p>This unsubscribe link is missing a token.</p>'));
  }

  let payload: { contactId: string; email: string; campaignId: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as typeof payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(410).send(htmlPage('Link Expired', '<h1>Link Expired</h1><p>This unsubscribe link has expired. Please contact us directly to be removed from our mailing list.</p>'));
    }
    return res.status(400).send(htmlPage('Invalid Link', '<h1>Invalid Link</h1><p>This unsubscribe link is not valid.</p>'));
  }

  const { contactId, email } = payload;
  if (!contactId || !email) {
    return res.status(400).send(htmlPage('Invalid Link', '<h1>Invalid Link</h1><p>This unsubscribe link is malformed.</p>'));
  }

  // Update only if the token's contactId and email both match (prevents token misuse)
  await prisma.clientContact.updateMany({
    where: { id: contactId, email },
    data: { isUnsubscribed: true },
  }).catch(() => {});

  return res.status(200).send(htmlPage(
    'Unsubscribed',
    '<h1>You\'ve been unsubscribed</h1><p>You will no longer receive bulk emails from us.<br>If this was a mistake, please contact us directly.</p>'
  ));
});
