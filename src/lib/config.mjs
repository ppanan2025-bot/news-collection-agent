// Loads and validates config/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './env.mjs';

export class ConfigError extends Error {}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new ConfigError(`cannot read ${file}: ${e.message}`); }
}

export function configDir(base) {
  return path.join(base || process.env.CLAUDE_PROJECT_DIR || root, 'config');
}

export function validateFeeds(cfg) {
  if (!cfg || !Array.isArray(cfg.outlets) || cfg.outlets.length === 0) throw new ConfigError('feeds: outlets[] required');
  const keys = new Set();
  for (const o of cfg.outlets) {
    if (!o.key || !/^[a-z0-9_-]{1,64}$/.test(o.key)) throw new ConfigError(`feeds: bad outlet key ${o.key}`);
    if (keys.has(o.key)) throw new ConfigError(`feeds: duplicate outlet key ${o.key}`);
    keys.add(o.key);
    if (!o.name) throw new ConfigError(`feeds: outlet ${o.key} needs name`);
    if (!Array.isArray(o.domains) || o.domains.length === 0) throw new ConfigError(`feeds: outlet ${o.key} needs domains[]`);
    o.domains = o.domains.map((d) => String(d).toLowerCase().replace(/^www\./, ''));
    o.feeds = Array.isArray(o.feeds) ? o.feeds : [];
    o.tier = o.tier || 'medium';
    for (const f of o.feeds) if (!f.url) throw new ConfigError(`feeds: outlet ${o.key} has feed without url`);
  }
  return cfg;
}

export function validateVerification(v) {
  const req = ['window_hours', 'min_score', 'min_shared_salient_tokens', 'min_independent_outlets', 'syndication_threshold', 'candidate_limit'];
  for (const k of req) if (typeof v?.[k] !== 'number' || !Number.isFinite(v[k])) throw new ConfigError(`verification: ${k} must be a number`);
  if (v.min_independent_outlets < 1) throw new ConfigError('verification: min_independent_outlets must be >= 1');
  return v;
}

export function validatePolicy(p) {
  if (!p || !Array.isArray(p.deny)) throw new ConfigError('domain-policy: deny[] required');
  p.allow_extra = Array.isArray(p.allow_extra) ? p.allow_extra : [];
  p.report_url_exempt = Array.isArray(p.report_url_exempt) ? p.report_url_exempt : [];
  p.allow_from_feeds = p.allow_from_feeds !== false;
  return p;
}

export function loadFeeds(file) {
  return validateFeeds(readJson(file ? path.resolve(file) : path.join(configDir(), 'feeds.json')));
}
export function loadVerification(base) {
  return validateVerification(readJson(path.join(configDir(base), 'verification.json')));
}
export function loadPolicy(base) {
  return validatePolicy(readJson(path.join(configDir(base), 'domain-policy.json')));
}

/** Map of domain -> outlet_key built from a feeds config. */
export function outletDomainsFromFeeds(feedsCfg) {
  const map = {};
  for (const o of feedsCfg.outlets) for (const d of o.domains) map[d] = o.key;
  return map;
}

export function loadAll(base) {
  return {
    feeds: loadFeeds(base ? path.join(configDir(base), 'feeds.json') : undefined),
    verification: loadVerification(base),
    policy: loadPolicy(base),
  };
}
