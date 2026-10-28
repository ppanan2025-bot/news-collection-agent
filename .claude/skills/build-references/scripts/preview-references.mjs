#!/usr/bin/env node
// READ-ONLY: formats corroborated-only references from v_reference_ready without recording or writing anything.
// Connects as news_ro. Recording citations goes through mcp__newsdb__cite_articles only.
// Run from the project root:
//   node .claude/skills/build-references/scripts/preview-references.mjs [--topic t] [--query q] [--since ISO] [--style apa|mla|chicago|markdown] [--limit 30]
import { parseArgs } from '../../../../src/lib/cli.mjs';
import { roPool, closePools } from '../../../../src/lib/db.mjs';
import { queryReferences, corroboratorNames } from '../../../../src/lib/repo.mjs';
import { buildPreview } from '../../../../src/lib/skillHelpers.mjs';

const args = parseArgs();
try {
  const style = typeof args.style === 'string' ? args.style : 'apa';
  if (!['apa', 'mla', 'chicago', 'markdown'].includes(style)) throw new Error(`bad --style ${style}`);
  const pool = roPool();
  const str = (v) => (typeof v === 'string' ? v : undefined);
  const rows = await queryReferences(pool, { topic: str(args.topic), query: str(args.query), since: str(args.since), limit: Number(args.limit ?? 30) });
  const names = {};
  for (const r of rows) names[r.id] = await corroboratorNames(pool, r.id);
  const out = buildPreview(rows, names, style);
  console.log(JSON.stringify({ ...out, article_ids: out.references.map((r) => r.article_id) }, null, 2));
} catch (e) {
  console.error(`[preview-references] ${e.message}`);
  process.exitCode = 1;
} finally { await closePools(); }
