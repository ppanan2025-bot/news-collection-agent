#!/usr/bin/env node
// Builds a reference list from corroborated articles only (v_reference_ready) and records citations.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../src/lib/cli.mjs';
import { root } from '../src/lib/env.mjs';
import { loadVerification } from '../src/lib/config.mjs';
import { appPool, closePools } from '../src/lib/db.mjs';
import { queryReferences, citeArticles } from '../src/lib/repo.mjs';

const args = parseArgs();
try {
  const style = args.style || 'apa';
  if (!['apa', 'mla', 'chicago', 'markdown'].includes(style)) throw new Error(`bad --style ${style}`);
  const slug = args.report;
  if (!slug || !/^[a-z0-9-]{3,128}$/.test(slug)) throw new Error('--report <slug> required (^[a-z0-9-]{3,128}$)');
  const pool = appPool();
  const refs = await queryReferences(pool, { topic: typeof args.topic === 'string' ? args.topic : undefined, limit: Number(args.limit ?? 100) });
  if (!refs.length) {
    console.error('[refs] no corroborated articles found; run collect and verify first. Not falling back to unverified sources.');
    process.exitCode = 1;
  } else {
    const r = await citeArticles(pool, { report_slug: slug, report_title: args.title, article_ids: refs.map((x) => x.id), style });
    const cfg = loadVerification();
    if (args.out) {
      const out = path.resolve(root, args.out);
      const header = `# References: ${slug}\n\n- Topic: ${args.topic || '(all)'}\n- Generated: ${new Date().toISOString().slice(0, 10)}\n- Style: ${style}\n- Verification rule: corroborated by >= ${cfg.min_independent_outlets} independent outlets (different ownership groups, wire copies excluded), within ${cfg.window_hours}h\n\n`;
      const footer = `\n\n---\nAll sources corroborated by ≥${cfg.min_independent_outlets} independent outlets; verification log in newsdb.verification_events\n`;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, header + r.formatted + footer);
      console.error(`[refs] wrote ${path.relative(root, out)}`);
    }
    console.log(r.formatted);
  }
} catch (e) {
  console.error(`[refs] ${e.message}`);
  process.exitCode = 1;
} finally { await closePools(); }
