// RSS collector shared by `scripts/collect.mjs` and `.claude/skills/collect-news/scripts/collect.mjs`.
import { parseArgs, parseSince } from './cli.mjs';
import { loadFeeds, loadPolicy } from './config.mjs';
import { appPool, closePools } from './db.mjs';
import { seedOutlets, loadOutletDomains, getFeedIds, insertArticle, updateFeedStatus } from './repo.mjs';
import { fetchFeed, normalizeItem, matchesTopic } from './rss.mjs';
import { checkUrl } from './domainPolicy.mjs';
import { sha256 } from './canonicalize.mjs';

/** Pure: argv -> collector options. */
export function collectOptions(argv) {
  const a = parseArgs(argv, ['dryRun']);
  const limit = Number(a.limitPerFeed ?? 50);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit-per-feed must be a positive integer');
  return {
    topic: typeof a.topic === 'string' ? a.topic.trim() : '',
    mode: a.match === 'any' ? 'any' : 'all',
    feeds: typeof a.feeds === 'string' ? a.feeds : undefined,
    limit,
    since: parseSince(a.since),
    dryRun: !!a.dryRun,
  };
}

async function pMap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export async function collect(opts) {
  const summary = { feeds_ok: 0, feeds_failed: [], fetched: 0, matched: 0, inserted: 0, duplicates: 0, rejected_by_policy: [], article_ids: [] };
  const cfg = loadFeeds(opts.feeds);
  const policy = loadPolicy();
  let outletDomains, feedIds = {}, pool;
  if (opts.dryRun) {
    outletDomains = cfg.outlets.flatMap((o) => o.domains.map((d) => ({ domain: d, outlet_key: o.key })));
  } else {
    pool = appPool();
    await seedOutlets(pool, cfg);
    outletDomains = await loadOutletDomains(pool);
    feedIds = await getFeedIds(pool);
  }
  const jobs = cfg.outlets.flatMap((o) => (o.feeds || []).filter((f) => f.enabled !== false).map((f) => ({ outlet: o, feed: f })));
  const results = await pMap(jobs, 4, async ({ outlet, feed }) => {
    try { return { outlet, feed, parsed: await fetchFeed(feed.url) }; }
    catch (e) { return { outlet, feed, error: e.message || String(e) }; }
  });
  for (const r of results) {
    if (r.error) {
      summary.feeds_failed.push({ url: r.feed.url, error: r.error });
      console.error(`[collect] feed failed ${r.feed.url}: ${r.error}`);
      if (pool) await updateFeedStatus(pool, r.feed.url, `error: ${r.error}`).catch(() => {});
      continue;
    }
    summary.feeds_ok++;
    const items = (r.parsed.items || []).slice(0, opts.limit);
    let ins = 0;
    for (const it of items) {
      summary.fetched++;
      const art = normalizeItem(it, { topic: opts.topic || r.feed.topic }, r.outlet);
      if (!art) continue;
      if (opts.since && art.published_at < opts.since) continue;
      if (!matchesTopic(art, opts.topic, opts.mode)) continue;
      summary.matched++;
      const chk = checkUrl(art.url, policy, outletDomains);
      if (!chk.allowed) { summary.rejected_by_policy.push({ url: art.url, reason: chk.reason }); continue; }
      if (opts.dryRun) continue;
      try {
        const res = await insertArticle(pool, art, { policy, outletDomains, feedId: feedIds[sha256(r.feed.url)] ?? null });
        if (res.status === 'inserted') { summary.inserted++; ins++; summary.article_ids.push(res.id); }
        else summary.duplicates++;
      } catch (e) {
        summary.rejected_by_policy.push({ url: art.url, reason: e.message });
      }
    }
    if (pool) await updateFeedStatus(pool, r.feed.url, `ok: ${items.length} items, ${ins} inserted`);
  }
  return { summary, totalFeeds: jobs.length };
}

/** CLI entry point: prints one JSON summary; exit 1 if every feed failed or on error. */
export async function main(argv = process.argv.slice(2)) {
  try {
    const { summary, totalFeeds } = await collect(collectOptions(argv));
    console.log(JSON.stringify(summary));
    if (totalFeeds > 0 && summary.feeds_ok === 0) process.exitCode = 1;
  } catch (e) {
    console.error(`[collect] ${e.message}`);
    process.exitCode = 1;
  } finally { await closePools(); }
}
