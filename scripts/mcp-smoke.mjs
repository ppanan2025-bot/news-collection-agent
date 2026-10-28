#!/usr/bin/env node
// Spawns the MCP server over stdio with the SDK client and exercises it. Exit 0 on success.
// Usage: node scripts/mcp-smoke.mjs [--unverified-id N]   (NEWSDB_PORT selects the DB)
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root } from '../src/lib/env.mjs';
import { parseArgs } from '../src/lib/cli.mjs';

const args = parseArgs();
const EXPECTED = ['cite_articles', 'find_corroborations', 'get_article', 'insert_article', 'list_outlets', 'mark_verified',
  'query_references', 'run_readonly_sql', 'search_articles', 'stats'];
const fails = [];
const check = (cond, msg) => { console.error(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails.push(msg); };
const text = (r) => r.content?.map((c) => c.text).join('\n') ?? '';

const env = { ...process.env, NEWSDB_PORT: process.env.NEWSDB_PORT || '3307' };
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp-server/index.mjs')], cwd: root, env, stderr: 'inherit' });
const client = new Client({ name: 'mcp-smoke', version: '1.0.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check(JSON.stringify(names) === JSON.stringify(EXPECTED), `listTools returns exactly 10 tools (${names.join(', ')})`);

  const st = await client.callTool({ name: 'stats', arguments: {} });
  check(!st.isError && typeof st.structuredContent?.articles?.total === 'number', `stats returns counts: ${JSON.stringify(st.structuredContent)}`);

  const lo = await client.callTool({ name: 'list_outlets', arguments: {} });
  check(!lo.isError && Array.isArray(lo.structuredContent?.outlets), 'list_outlets returns {outlets:[...]}');

  for (const bad of ['DELETE FROM articles', "UPDATE articles SET verification_status='corroborated'", 'SELECT 1; DROP TABLE articles',
    '/*!50000 DROP TABLE x*/', "SELECT * FROM articles INTO OUTFILE '/tmp/x'"]) {
    const r = await client.callTool({ name: 'run_readonly_sql', arguments: { sql: bad } });
    check(r.isError === true, `run_readonly_sql rejects: ${bad}`);
  }
  const good = await client.callTool({ name: 'run_readonly_sql', arguments: { sql: 'SELECT COUNT(*) n FROM articles' } });
  check(!good.isError && good.structuredContent?.rows?.length === 1, `run_readonly_sql SELECT works: ${text(good).replace(/\s+/g, ' ').slice(0, 120)}`);
  const w = await client.callTool({ name: 'run_readonly_sql', arguments: { sql: 'WITH x AS (SELECT 1 AS a) SELECT * FROM x' } });
  check(!w.isError, 'run_readonly_sql WITH ... SELECT works');

  const sa = await client.callTool({ name: 'search_articles', arguments: { limit: 3 } });
  check(!sa.isError && Array.isArray(sa.structuredContent?.articles), 'search_articles returns {articles:[...]}');
  const qr = await client.callTool({ name: 'query_references', arguments: { limit: 5 } });
  check(!qr.isError && Array.isArray(qr.structuredContent?.references), 'query_references returns {references:[...]}');

  const ins = await client.callTool({ name: 'insert_article', arguments: { url: 'https://bit.ly/abc123', title: 'shortened link' } });
  check(ins.isError === true, 'insert_article denies bit.ly');

  let unv = args.unverifiedId ? Number(args.unverifiedId) : null;
  if (!unv) {
    const r = await client.callTool({ name: 'search_articles', arguments: { status: 'unverified', limit: 1 } });
    unv = r.structuredContent?.articles?.[0]?.id ?? null;
  }
  if (unv) {
    const c = await client.callTool({ name: 'cite_articles', arguments: { report_slug: 'mcp-smoke', article_ids: [unv] } });
    check(c.isError === true, `cite_articles rejects unverified article ${unv}`);
    const m = await client.callTool({ name: 'mark_verified', arguments: { article_id: unv, status: 'corroborated', corroborating_ids: [], reason: 'smoke test: forcing corroboration without evidence' } });
    check(m.isError === true, `mark_verified corroborated without evidence is rejected server-side for ${unv}`);
    const fc = await client.callTool({ name: 'find_corroborations', arguments: { article_id: unv, limit: 3 } });
    check(!fc.isError && typeof fc.structuredContent?.meets_rule === 'boolean', 'find_corroborations works');
  } else {
    console.error('SKIP no unverified article available for cite/mark checks');
  }
} catch (e) {
  check(false, `unexpected error: ${e?.stack || e}`);
} finally {
  await client.close().catch(() => {});
}
if (fails.length) { console.error(`MCP SMOKE FAILED (${fails.length})`); process.exit(1); }
console.log('MCP SMOKE OK');
process.exit(0);
