/**
 * Shared IP allowlist parsing and checking (exact IP + IPv4 CIDR).
 */

export function parseAllowedIps(raw: string): { exact: string[]; cidr: { network: string; prefix: number }[] } {
  if (!raw?.trim()) return { exact: [], cidr: [] };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const exact: string[] = [];
  const cidr: { network: string; prefix: number }[] = [];
  for (const p of parts) {
    if (p.includes('/')) {
      const [network, prefixStr] = p.split('/');
      const prefix = parseInt(prefixStr, 10);
      if (network && !isNaN(prefix) && prefix >= 0 && prefix <= 32) {
        cidr.push({ network: network.trim(), prefix });
      }
    } else {
      exact.push(p);
    }
  }
  return { exact, cidr };
}

function ipInCidr(ip: string, network: string, prefixLen: number): boolean {
  const toNum = (s: string): number => {
    const parts = s.split('.').map((x) => parseInt(x, 10));
    if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return -1;
    return (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
  };
  const ipN = toNum(ip);
  const netN = toNum(network);
  if (ipN < 0 || netN < 0) return false;
  const mask = prefixLen === 0 ? 0 : ~((1 << (32 - prefixLen)) - 1) >>> 0;
  return (ipN & mask) === (netN & mask);
}

/** Normalize IP (strip IPv4-mapped prefix). */
export function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '');
}

/** Return true if the given IP is in the allowed list (comma-separated IPs and/or CIDRs). */
export function isIpAllowed(clientIp: string, allowedIpsRaw: string): boolean {
  const normalized = normalizeIp(clientIp);
  const { exact, cidr } = parseAllowedIps(allowedIpsRaw);
  if (exact.includes(normalized)) return true;
  for (const { network, prefix } of cidr) {
    if (ipInCidr(normalized, network, prefix)) return true;
  }
  return false;
}
