import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './env.mjs';
import Parser from 'rss-parser';
import { stripHtml, decodeEntities, tokenize } from './text.mjs';
import { canonicalUrl, sha256 } from './canonicalize.mjs';
import { isWireCopy } from './wire.mjs';

export const USER_AGENT = 'news-collection-agent/1.0 (+research; contact: local)';
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' } });

export async function fetchFeed(url) {
  const u = String(url);
  if (u.startsWith('file:')) {
    // file:///abs/path or file:relative/path (relative to the project root, used by test fixtures)
    const p = u.startsWith('file://') ? fileURLToPath(u) : path.resolve(root, u.slice('file:'.length));
    return parser.parseString(await fs.readFile(p, 'utf8'));
  }
  // Global fetch with a hard 15 s timeout (rss-parser's parseURL can leave sockets open and hang the process).
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' },
    redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parser.parseString(await res.text());
}

export function parseString(xml) { return parser.parseString(xml); }

const clean = (s) => decodeEntities(stripHtml(s ?? '')).replace(/\s+/g, ' ').trim();
const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());

export function normalizeItem(item, feed = {}, outlet = {}, now = new Date()) {
  const title = clean(item.title).slice(0, 1024);
  const guid = typeof item.guid === 'string' ? item.guid : item.guid?._ ?? item.id;
  const url = (item.link && String(item.link).trim()) || (isHttpUrl(guid) ? guid.trim() : null);
  if (!title || !url) return null;
  let canonical_url;
  try { canonical_url = canonicalUrl(url); } catch { canonical_url = null; }
  const summary = (item.contentSnippet ? clean(item.contentSnippet) : clean(item.description ?? item.content ?? item.summary)).slice(0, 2000);
  const author = item.creator || item.author || item['dc:creator'] || null;
  let published = item.isoDate || item.pubDate ? new Date(item.isoDate || item.pubDate) : null;
  if (!published || Number.isNaN(published.getTime())) published = new Date(now);
  if (published.getTime() > now.getTime() + 24 * 3600 * 1000) published = new Date(now);
  return {
    title,
    url,
    canonical_url,
    canonical_url_hash: canonical_url ? sha256(canonical_url) : null,
    summary: summary || null,
    author: author ? String(author).slice(0, 255) : null,
    published_at: published,
    content_hash: sha256(title.toLowerCase() + '\n' + (summary || '').toLowerCase()),
    is_wire_copy: isWireCopy({ url, summary, author }),
    topic: feed.topic ?? null,
    outlet_key: outlet.key ?? outlet.outlet_key ?? null,
  };
}

export function matchesTopic(item, topic, mode = 'all') {
  const terms = [...new Set(tokenize(topic || ''))];
  if (terms.length === 0) return true;
  const toks = new Set(tokenize(`${item.title ?? ''} ${item.summary ?? ''}`));
  return mode === 'any' ? terms.some((t) => toks.has(t)) : terms.every((t) => toks.has(t));
}
