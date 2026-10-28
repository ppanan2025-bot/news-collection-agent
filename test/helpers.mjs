import path from 'node:path';
import { root } from '../src/lib/env.mjs';
import { loadFeeds } from '../src/lib/config.mjs';
import { fetchFeed, normalizeItem } from '../src/lib/rss.mjs';

/** Fixture articles (excluding the bit.ly and duplicate items) with ids and groups, as stored after collection. */
export async function loadFixtureArticles() {
  const cfg = loadFeeds(path.join(root, 'test/fixtures/feeds.fixture.json'));
  const out = [];
  const seen = new Set();
  let id = 1;
  for (const o of cfg.outlets) {
    const parsed = await fetchFeed(o.feeds[0].url);
    for (const it of parsed.items) {
      const a = normalizeItem(it, o.feeds[0], o, new Date('2026-10-21T00:00:00Z'));
      if (!a || a.url.includes('bit.ly') || seen.has(a.canonical_url_hash)) continue;
      seen.add(a.canonical_url_hash);
      out.push({ ...a, id: id++, group: o.ownership_group ?? o.key });
    }
  }
  return out;
}
