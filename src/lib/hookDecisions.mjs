// Pure decision functions used by .claude/hooks/*.mjs (unit-testable, no I/O).
import path from 'node:path';
import fs from 'node:fs';
import { checkUrl } from './domainPolicy.mjs';
import { canonicalUrl, sha256, hostOf } from './canonicalize.mjs';

export const allow = () => ({ decision: 'allow' });
export const deny = (reason) => ({ decision: 'deny', reason });

export function denyOutput(reason) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

/** Validates the common hook payload; throws on malformed input (caller exits 2). */
export function parseHookInput(raw) {
  const input = JSON.parse(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('hook input must be a JSON object');
  return input;
}

export const isPreToolUse = (input) => input.hook_event_name === undefined || input.hook_event_name === 'PreToolUse';

// ---- validate-domain ----
export function decideDomain(toolInput, policy, outletDomains) {
  const url = toolInput?.url;
  if (typeof url !== 'string' || !url.trim()) return deny('insert_article requires a url');
  const r = checkUrl(url, policy, outletDomains);
  return r.allowed ? allow() : deny(r.reason);
}

// ---- require-corroborated ----
export function validateIds(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.every((i) => Number.isInteger(i) && i > 0);
}

export function decideCitation(ids, statusMap) {
  if (!validateIds(ids)) return deny('cite_articles requires a non-empty array of integer article_ids');
  const bad = ids.filter((i) => statusMap[i] !== 'corroborated').map((i) => `${i}:${statusMap[i] ?? 'missing'}`);
  if (bad.length) return deny(`Only corroborated articles may be cited. Not corroborated: ${bad.join(', ')}. Run /verify-sources first.`);
  return allow();
}

// ---- check-verification-input ----
export function decideVerificationInput(toolInput, cfg) {
  const status = toolInput?.status;
  const reason = typeof toolInput?.reason === 'string' ? toolInput.reason.trim() : '';
  const ids = Array.isArray(toolInput?.corroborating_ids) ? toolInput.corroborating_ids : [];
  if (status === 'corroborated') {
    if (ids.length < cfg.min_independent_outlets)
      return deny(`Marking corroborated needs at least ${cfg.min_independent_outlets} corroborating_ids from independent outlets (got ${ids.length}). Leave it unverified instead.`);
    if (reason.length < 20) return deny('A reason of at least 20 characters naming the shared facts and outlets is required.');
  } else if (status === 'rejected') {
    if (reason.length < 20) return deny('Rejecting an article requires a reason of at least 20 characters.');
  }
  return allow();
}

// ---- guard-report-write ----
function realish(p) {
  // realpath of the deepest existing ancestor + the remaining segments (file may not exist yet)
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  let base;
  try { base = fs.realpathSync(cur); } catch { base = cur; }
  return path.join(base, ...rest);
}

export function isReportPath(filePath, projectDir) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
  const target = realish(abs);
  const reports = realish(path.join(projectDir, 'reports'));
  const rel = path.relative(reports, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function textsFromToolInput(toolName, ti = {}) {
  if (toolName === 'Write') return [ti.content ?? ''];
  if (toolName === 'Edit') return [ti.new_string ?? ''];
  if (toolName === 'MultiEdit') return (Array.isArray(ti.edits) ? ti.edits : []).map((e) => e?.new_string ?? '');
  return [];
}

export function extractUrls(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"'`)\]}]+/gi;
  for (const m of String(text).matchAll(re)) out.push(m[0].replace(/[.,;:!?*_]+$/, ''));
  return [...new Set(out)];
}

const suffix = (host, d) => host === d || host.endsWith('.' + d);

/** Splits URLs into exempt and those needing a DB lookup; returns [{url, canonical, hash}] to check. */
export function urlsToCheck(urls, exempt = []) {
  const out = [];
  for (const url of urls) {
    const host = (hostOf(url) || '').replace(/^www\./, '');
    if (exempt.some((d) => suffix(host, d))) continue;
    let canonical;
    try { canonical = canonicalUrl(url); } catch { canonical = null; }
    out.push({ url, canonical, hash: canonical ? sha256(canonical) : null });
  }
  return out;
}

export function decideReportUrls(checks, statusByHash) {
  const bad = checks.filter((c) => !c.hash || statusByHash[c.hash] !== 'corroborated')
    .map((c) => `${c.url} (${c.hash && statusByHash[c.hash] ? statusByHash[c.hash] : 'not in newsdb'})`);
  if (bad.length) return deny(`Report files may only contain URLs of corroborated articles. Offending: ${bad.join(', ')}. Collect and verify them first (/collect-news, /verify-sources), then cite via /build-references.`);
  return allow();
}

// ---- guard-bash-db ----
const SQL_WRITE = /\b(insert|update|delete|replace|drop|alter|truncate|create|grant)\b/i;

export function decideBashCommand(command) {
  if (typeof command !== 'string') return allow();
  const cmd = command;
  const mentionsMysql = /\bmysql(sh)?\b/i.test(cmd) || /\bmysqladmin\b/i.test(cmd);
  const dockerExec = /\bdocker\b[\s\S]*\bexec\b/i.test(cmd);
  if ((mentionsMysql || dockerExec) && SQL_WRITE.test(cmd))
    return deny('Raw SQL writes are blocked. Use the newsdb MCP tools; verification state may only change through mcp__newsdb__mark_verified.');
  if (/\bdocker[\s-]+compose\b[\s\S]*\bdown\b[\s\S]*(\s-v\b|\s--volumes\b|\s-[a-zA-Z]*v[a-zA-Z]*\b)/.test(cmd))
    return deny('Removing the newsdb volume (docker compose down -v) is blocked. Use the newsdb MCP tools; verification state may only change through mark_verified.');
  if (/\bdocker\s+volume\s+(rm|remove|prune)\b/i.test(cmd) && /newsdb|prune/i.test(cmd))
    return deny('Removing the newsdb Docker volume is blocked. Use the newsdb MCP tools; verification state may only change through mark_verified.');
  return allow();
}
