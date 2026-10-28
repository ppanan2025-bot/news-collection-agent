#!/usr/bin/env node
// READ-ONLY: lists unverified articles (optionally for a topic) with their corroboration candidates, as JSON.
// Connects as news_ro, so it cannot change anything. Status changes go through mcp__newsdb__mark_verified only.
// Run from the project root: node .claude/skills/verify-sources/scripts/pending.mjs [--topic "<terms>"] [--limit 50]
import { parseArgs } from '../../../../src/lib/cli.mjs';
import { loadVerification } from '../../../../src/lib/config.mjs';
import { roPool, closePools } from '../../../../src/lib/db.mjs';
import { listUnverifiedIds, findCorroborations } from '../../../../src/lib/repo.mjs';
import { summarizePending } from '../../../../src/lib/skillHelpers.mjs';

const args = parseArgs();
try {
  const cfg = loadVerification();
  const limit = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200);
  const pool = roPool();
  const ids = (await listUnverifiedIds(pool, { topic: typeof args.topic === 'string' ? args.topic : undefined })).slice(-limit);
  const results = [];
  for (const id of ids) results.push(await findCorroborations(pool, id, cfg, { limit: 10 }));
  const articles = summarizePending(results);
  console.log(JSON.stringify({ rule: cfg, count: articles.length, meets_rule: articles.filter((a) => a.meets_rule).length, articles }, null, 2));
} catch (e) {
  console.error(`[pending] ${e.message}`);
  process.exitCode = 1;
} finally { await closePools(); }
