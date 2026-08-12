import { SenderDomainVerificationUnavailableError } from './senderDomainErrors';

type CacheState = {
  domains: string[];
  expiresAt: number;
  inflight: Promise<string[]> | null;
};

const TTL_MS = 10 * 60 * 1000;
let cache: CacheState = { domains: [], expiresAt: 0, inflight: null };

/** Test helper — clears in-memory cache. */
export function resetSendGridAuthenticatedDomainsCache(): void {
  cache = { domains: [], expiresAt: 0, inflight: null };
}

function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

type WhitelabelDomainRow = {
  domain?: string;
  valid?: boolean;
};

type FetchLike = typeof fetch;

async function fetchAllValidDomains(fetchImpl: FetchLike, apiKey: string): Promise<string[]> {
  const domains = new Set<string>();
  const limit = 100;
  let offset = 0;

  for (;;) {
    const url = `https://api.sendgrid.com/v3/whitelabel/domains?limit=${limit}&offset=${offset}`;
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[sendgrid-domains] list failed status=${res.status} body=${body.slice(0, 200)}`);
      throw new SenderDomainVerificationUnavailableError(
        'Could not verify email domain with SendGrid. Try again shortly.',
      );
    }
    const rows = (await res.json()) as WhitelabelDomainRow[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      if (row?.valid === true && row.domain) {
        const d = normalizeDomain(row.domain);
        if (d) domains.add(d);
      }
    }
    if (rows.length < limit) break;
    offset += limit;
  }

  return [...domains];
}

/**
 * Cached list of SendGrid authenticated (valid) domains.
 * Coalesces concurrent fetches. Throws SenderDomainVerificationUnavailableError on failure.
 * Reads SENDGRID_API_KEY from process.env (same source as env.ts) to stay unit-testable.
 */
export async function getSendGridAuthenticatedDomains(
  fetchImpl: FetchLike = fetch,
  apiKeyOverride?: string | null,
): Promise<string[]> {
  const apiKey = (apiKeyOverride !== undefined ? apiKeyOverride : process.env.SENDGRID_API_KEY)?.trim();
  if (!apiKey) {
    throw new SenderDomainVerificationUnavailableError(
      'SendGrid is not configured; cannot verify authenticated domains.',
    );
  }

  const now = Date.now();
  if (cache.expiresAt > now) return cache.domains;
  if (cache.inflight) return cache.inflight;

  cache.inflight = (async () => {
    try {
      const domains = await fetchAllValidDomains(fetchImpl, apiKey);
      cache = { domains, expiresAt: Date.now() + TTL_MS, inflight: null };
      return domains;
    } catch (err) {
      cache.inflight = null;
      throw err;
    }
  })();

  return cache.inflight;
}
