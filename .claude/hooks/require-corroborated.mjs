#!/usr/bin/env node
// PreToolUse: mcp__newsdb__cite_articles — every article id must be corroborated (checked live as news_ro).
import { runHook } from '../../src/lib/hookRunner.mjs';
import { decideCitation, validateIds } from '../../src/lib/hookDecisions.mjs';

await runHook('require-corroborated', ['mcp__newsdb__cite_articles'], async (input) => {
  const ids = input.tool_input?.article_ids;
  if (!validateIds(ids)) return decideCitation(ids, {});
  const { roPool } = await import('../../src/lib/db.mjs');
  // pool.query (not execute) so that IN (?) expands the array (C8)
  const [rows] = await roPool().query('SELECT id, verification_status FROM articles WHERE id IN (?)', [ids]);
  const map = Object.fromEntries(rows.map((r) => [Number(r.id), r.verification_status]));
  return decideCitation(ids, map);
});
