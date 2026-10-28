#!/usr/bin/env node
// newsdb MCP server (stdio). Logs only to stderr; stdout carries the MCP protocol.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appPool, roPool, closePools } from '../src/lib/db.mjs';
import { loadVerification, loadPolicy } from '../src/lib/config.mjs';
import { assertReadOnlySql } from '../src/lib/sqlGuard.mjs';
import * as repo from '../src/lib/repo.mjs';

const log = (...a) => console.error('[newsdb]', ...a);
const server = new McpServer({ name: 'newsdb', version: '1.0.0' });

const ok = (result) => ({
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  // structuredContent must be an object (C2): wrap arrays.
  structuredContent: Array.isArray(result) ? { items: result } : result,
});
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e?.message || String(e) }] });

function tool(name, description, inputSchema, handler, annotations = {}) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
    try { return ok(await handler(args ?? {})); }
    catch (e) { log(`${name} error:`, e?.message || e); return fail(e); }
  });
}

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date/time');
const statusEnum = z.enum(['unverified', 'corroborated', 'rejected']);

tool('stats', 'Counts of articles by verification status, outlets, feeds and reports.', {},
  async () => repo.stats(roPool()), { readOnlyHint: true });

tool('list_outlets', 'List configured outlets with domains, ownership group and reliability tier.', {},
  async () => ({ outlets: await repo.listOutlets(roPool()) }), { readOnlyHint: true });

tool('insert_article', 'Insert one article by URL. The URL must belong to a configured outlet domain (domain policy enforced). Dedupes on canonical URL.', {
  url: z.string().url(),
  title: z.string().min(1).max(1024),
  summary: z.string().max(4000).optional(),
  published_at: iso.optional(),
  author: z.string().max(255).optional(),
  topic: z.string().max(128).optional(),
}, async (a) => {
  const pool = appPool();
  const outletDomains = await repo.loadOutletDomains(pool);
  return repo.insertArticle(pool, a, { policy: loadPolicy(), outletDomains });
});

tool('search_articles', 'Search stored articles (full-text on title+summary) with optional filters.', {
  query: z.string().max(500).optional(),
  topic: z.string().max(128).optional(),
  status: statusEnum.optional(),
  outlet_key: z.string().max(64).optional(),
  since: iso.optional(),
  until: iso.optional(),
  limit: z.number().int().min(1).max(100).default(25),
}, async (a) => ({ articles: await repo.searchArticles(roPool(), a) }), { readOnlyHint: true });

tool('get_article', 'Full article record with its corroborations and verification events.', {
  id: z.number().int().positive(),
}, async ({ id }) => repo.getArticle(roPool(), id), { readOnlyHint: true });

tool('find_corroborations', 'Find candidate corroborating articles from independent outlets and evaluate the deterministic rule. Writes nothing.', {
  article_id: z.number().int().positive(),
  window_hours: z.number().int().min(1).max(720).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}, async ({ article_id, window_hours, limit }) => repo.findCorroborations(roPool(), article_id, loadVerification(), { windowHours: window_hours, limit }),
{ readOnlyHint: true });

tool('mark_verified', 'Set an article\'s verification status. "corroborated" is re-checked server-side against the rule using only corroborating_ids; "rejected" cascades to dependent articles.', {
  article_id: z.number().int().positive(),
  status: statusEnum,
  corroborating_ids: z.array(z.number().int().positive()).max(20).default([]),
  reason: z.string().min(20).max(4000),
}, async (a) => repo.markVerified(appPool(), { articleId: a.article_id, status: a.status, corroboratingIds: a.corroborating_ids, reason: a.reason, actor: 'claude' }, loadVerification()));

tool('query_references', 'Reference-ready (corroborated only) articles from v_reference_ready.', {
  topic: z.string().max(128).optional(),
  query: z.string().max(500).optional(),
  since: iso.optional(),
  until: iso.optional(),
  limit: z.number().int().min(1).max(100).default(30),
}, async (a) => ({ references: await repo.queryReferences(roPool(), a) }), { readOnlyHint: true });

tool('cite_articles', 'Record citations for a report and return formatted references. Only corroborated articles are accepted.', {
  report_slug: z.string().regex(/^[a-z0-9-]{3,128}$/),
  report_title: z.string().max(512).optional(),
  article_ids: z.array(z.number().int().positive()).min(1).max(100),
  style: z.enum(['apa', 'mla', 'chicago', 'markdown']).default('apa'),
}, async (a) => repo.citeArticles(appPool(), a));

tool('run_readonly_sql', 'Run one read-only SQL statement (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN) as news_ro inside a read-only transaction.', {
  sql: z.string().min(1).max(10000),
  max_rows: z.number().int().min(1).max(1000).default(200),
}, async ({ sql, max_rows }) => {
  assertReadOnlySql(sql);
  const conn = await roPool().getConnection();
  try {
    await conn.query('SET SESSION max_execution_time=5000');
    await conn.query('START TRANSACTION READ ONLY');
    try {
      const [rows, fields] = await conn.query({ sql, rowsAsArray: false });
      const list = Array.isArray(rows) ? rows : [rows];
      return { columns: (fields || []).map((f) => f.name), rows: list.slice(0, max_rows), truncated: list.length > max_rows };
    } finally { await conn.query('ROLLBACK').catch(() => {}); }
  } finally { conn.release(); }
}, { readOnlyHint: true });

const transport = new StdioServerTransport();
await server.connect(transport);
log('server ready (stdio)');

const shutdown = async () => { await closePools(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
