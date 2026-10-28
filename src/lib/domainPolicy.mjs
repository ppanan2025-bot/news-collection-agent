import net from 'node:net';

const suffixMatch = (host, d) => host === d || host.endsWith('.' + d);

/**
 * @param url            string
 * @param policy         domain-policy.json
 * @param outletDomains  {domain: outlet_key} map (or array of {domain, outlet_key})
 */
export function checkUrl(url, policy, outletDomains = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return { allowed: false, reason: `Invalid URL: ${url}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { allowed: false, reason: `Scheme ${u.protocol} is not allowed (http/https only)` };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return { allowed: false, reason: 'URL has no host' };
  if (net.isIP(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return { allowed: false, reason: `IP-literal host ${host} is not allowed` };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return { allowed: false, reason: `Local/internal host ${host} is not allowed` };
  for (const d of policy.deny || []) {
    if (suffixMatch(host, d)) return { allowed: false, reason: `Domain ${host} is on the deny list (URL shorteners and self-publishing platforms are not primary sources)` };
  }
  const entries = Array.isArray(outletDomains)
    ? outletDomains.map((r) => [r.domain, r.outlet_key])
    : Object.entries(outletDomains || {});
  const allow = [];
  if (policy.allow_from_feeds !== false) for (const [d, k] of entries) allow.push([d.toLowerCase(), k]);
  for (const d of policy.allow_extra || []) allow.push([d.toLowerCase(), null]);
  // Longest match wins so subdomain-specific mappings beat parents.
  allow.sort((a, b) => b[0].length - a[0].length);
  for (const [d, k] of allow) {
    if (suffixMatch(host, d)) return { allowed: true, reason: `Domain ${host} matches allowed domain ${d}`, outletKey: k ?? undefined };
  }
  return { allowed: false, reason: `Domain ${host} is not on the allowlist (configured outlet domains)` };
}
