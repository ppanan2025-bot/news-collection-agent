#!/usr/bin/env node
// Cross-checks articles. Without --auto it only reports; with --auto it marks corroborated when the rule is met
// (actor 'auto'). It NEVER auto-rejects.
// --recheck-corroborated: re-derive wire-copy flags, then re-check every corroborated article against the current
// rule; articles that no longer meet it go back to 'unverified' (with a verification event). Never rejects.
import { parseArgs } from '../src/lib/cli.mjs';
import { loadVerification } from '../src/lib/config.mjs';
import { appPool, closePools } from '../src/lib/db.mjs';
import { findCorroborations, listUnverifiedIds, autoVerify, refreshWireFlags, recheckCorroborated } from '../src/lib/repo.mjs';

const args = parseArgs(process.argv.slice(2), ['auto', 'allUnverified', 'recheckCorroborated']);
try {
  const cfg = { ...loadVerification() };
  if (args.minOutlets !== undefined) {
    const n = Number(args.minOutlets);
    if (!Number.isInteger(n) || n < 1) throw new Error('--min-outlets must be an integer >= 1');
    cfg.min_independent_outlets = n;
  }
  const pool = appPool();
  if (args.recheckCorroborated) {
    const wireFlagged = await refreshWireFlags(pool);
    const r = await recheckCorroborated(pool, cfg);
    console.log(JSON.stringify({ rule: cfg, wire_flagged: wireFlagged, ...r }, null, 2));
    await closePools();
    process.exit(0);
  }
  let ids;
  if (args.articleId) ids = [Number(args.articleId)];
  else if (args.allUnverified) ids = await listUnverifiedIds(pool);
  else if (args.topic) ids = await listUnverifiedIds(pool, { topic: args.topic });
  else throw new Error('usage: verify.mjs --topic t | --article-id n | --all-unverified [--auto] [--min-outlets N] | --recheck-corroborated');

  const out = { rule: cfg, checked: ids.length, meets_rule: 0, corroborated: [], results: [] };
  for (const id of ids) {
    if (args.auto) {
      try {
        const r = await autoVerify(pool, id, cfg);
        if (r.meets_rule) { out.meets_rule++; out.corroborated.push(id); }
        out.results.push(r);
      } catch (e) { out.results.push({ article_id: id, error: e.message }); }
    } else {
      const fc = await findCorroborations(pool, id, cfg, { limit: 10 });
      if (fc.meets_rule) out.meets_rule++;
      out.results.push({ article_id: id, title: fc.article.title, outlet: fc.article.outlet_key, meets_rule: fc.meets_rule,
        independent_groups: fc.independent_groups,
        matches: fc.candidates.filter((c) => c.matches).map((c) => ({ id: c.id, outlet: c.outlet_key, score: c.score, syndicated: c.syndicated, wire_copy: c.wire_copy, title: c.title })) });
    }
  }
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`[verify] ${e.message}`);
  process.exitCode = 1;
} finally { await closePools(); }
