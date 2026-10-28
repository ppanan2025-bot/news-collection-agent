// DB access shared by the collector scripts and the MCP server.
import { sha256, canonicalUrl } from './canonicalize.mjs';
import { checkUrl } from './domainPolicy.mjs';
import { evaluate } from './corroborate.mjs';
import { isWireCopy } from './wire.mjs';
import { formatList, assertAllCorroborated } from './references.mjs';

export class RepoError extends Error {
  constructor(message, details) { super(message); this.name = 'RepoError'; this.details = details; }
}

const ARTICLE_COLS = `a.id, a.outlet_id, a.feed_id, a.title, a.url, a.canonical_url, a.canonical_url_hash, a.summary, a.author,
  a.published_at, a.fetched_at, a.content_hash, a.topic, a.is_wire_copy, a.verification_status, a.verification_reason,
  a.verified_at, a.verified_by, o.outlet_key, o.name AS outlet, COALESCE(o.ownership_group, o.outlet_key) AS grp`;

function shape(r) {
  if (!r) return r;
  const { grp, ...rest } = r;
  return { ...rest, id: Number(r.id), is_wire_copy: !!r.is_wire_copy, group: grp };
}

const toDate = (d) => (d instanceof Date ? d : new Date(d));

// ---------- seeding ----------
export async function seedOutlets(pool, feedsCfg) {
  const conn = await pool.getConnection();
  const result = { outlets: 0, domains: 0, feeds: 0 };
  try {
    await conn.beginTransaction();
    for (const o of feedsCfg.outlets) {
      await conn.query(
        `INSERT INTO outlets (outlet_key, name, primary_domain, country, ownership_group, reliability_tier)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), primary_domain=VALUES(primary_domain), country=VALUES(country),
           ownership_group=VALUES(ownership_group), reliability_tier=VALUES(reliability_tier)`,
        [o.key, o.name, o.domains[0], o.country ?? null, o.ownership_group ?? null, o.tier ?? 'medium']);
      const [[row]] = await conn.query('SELECT id FROM outlets WHERE outlet_key=?', [o.key]);
      result.outlets++;
      for (const d of o.domains) {
        await conn.query('INSERT INTO outlet_domains (domain, outlet_id) VALUES (?,?) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id)', [d, row.id]);
        result.domains++;
      }
      for (const f of o.feeds || []) {
        await conn.query(
          `INSERT INTO feeds (outlet_id, url, url_hash, topic, enabled) VALUES (?,?,?,?,?)
           ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id), url=VALUES(url), topic=VALUES(topic), enabled=VALUES(enabled)`,
          [row.id, f.url, sha256(f.url), f.topic ?? null, f.enabled === false ? 0 : 1]);
        result.feeds++;
      }
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return result;
}

export async function loadOutletDomains(pool) {
  const [rows] = await pool.query('SELECT d.domain, o.outlet_key, o.id AS outlet_id FROM outlet_domains d JOIN outlets o ON o.id=d.outlet_id');
  return rows;
}

export async function getFeedIds(pool) {
  const [rows] = await pool.query('SELECT id, url_hash FROM feeds');
  return Object.fromEntries(rows.map((r) => [r.url_hash, r.id]));
}

export async function updateFeedStatus(pool, url, status) {
  await pool.query('UPDATE feeds SET last_fetched_at=UTC_TIMESTAMP(), last_status=? WHERE url_hash=?', [String(status).slice(0, 255), sha256(url)]);
}

// ---------- articles ----------
/**
 * Inserts an article after enforcing the domain policy. Same function for collector and MCP server.
 * @returns {status:'inserted'|'duplicate', id, canonical_url, outlet_key}
 */
export async function insertArticle(pool, art, { policy, outletDomains, feedId = null }) {
  const check = checkUrl(art.url, policy, outletDomains);
  if (!check.allowed) throw new RepoError(`domain policy: ${check.reason}`, { url: art.url });
  const canonical = art.canonical_url ?? canonicalUrl(art.url);
  const hash = sha256(canonical);
  const outletKey = check.outletKey;
  if (!outletKey) throw new RepoError(`URL ${art.url} does not belong to a configured outlet`);
  const [[outlet]] = await pool.query('SELECT id FROM outlets WHERE outlet_key=?', [outletKey]);
  if (!outlet) throw new RepoError(`outlet ${outletKey} is not seeded; run npm run seed`);
  const [[existing]] = await pool.query('SELECT id FROM articles WHERE canonical_url_hash=?', [hash]);
  if (existing) return { status: 'duplicate', id: Number(existing.id), canonical_url: canonical, outlet_key: outletKey };
  const title = String(art.title).slice(0, 1024);
  const summary = art.summary ? String(art.summary).slice(0, 4000) : null;
  const published = art.published_at ? toDate(art.published_at) : new Date();
  if (Number.isNaN(published.getTime())) throw new RepoError(`invalid published_at: ${art.published_at}`);
  const contentHash = art.content_hash ?? sha256(title.toLowerCase() + '\n' + (summary || '').toLowerCase());
  // Always re-derive (an explicit true is kept) so a caller cannot launder wire copy as independent.
  const isWire = art.is_wire_copy === true || isWireCopy({ url: art.url, summary, author: art.author });
  try {
    const [res] = await pool.query(
      `INSERT INTO articles (outlet_id, feed_id, title, url, canonical_url, canonical_url_hash, summary, author, published_at, content_hash, topic, is_wire_copy)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [outlet.id, feedId, title, art.url, canonical, hash, summary, art.author ? String(art.author).slice(0, 255) : null,
        published, contentHash, art.topic ? String(art.topic).slice(0, 128) : null, isWire ? 1 : 0]);
    return { status: 'inserted', id: Number(res.insertId), canonical_url: canonical, outlet_key: outletKey };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const [[row]] = await pool.query('SELECT id FROM articles WHERE canonical_url_hash=?', [hash]);
      return { status: 'duplicate', id: Number(row.id), canonical_url: canonical, outlet_key: outletKey };
    }
    throw e;
  }
}

export async function getArticleRow(pool, id, { forUpdate = false, conn } = {}) {
  const q = conn ?? pool;
  const [[row]] = await q.query(`SELECT ${ARTICLE_COLS} FROM articles a JOIN outlets o ON o.id=a.outlet_id WHERE a.id=?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return shape(row);
}

export async function getArticlesByIds(q, ids) {
  if (!ids.length) return [];
  const [rows] = await q.query(`SELECT ${ARTICLE_COLS} FROM articles a JOIN outlets o ON o.id=a.outlet_id WHERE a.id IN (?)`, [ids]);
  return rows.map(shape);
}

export async function getArticle(pool, id) {
  const art = await getArticleRow(pool, id);
  if (!art) throw new RepoError(`article ${id} not found`);
  const [corroborations] = await pool.query(
    `SELECT c.corroborating_article_id, c.score, c.title_overlap, c.keyword_jaccard, c.method, c.confirmed_by, c.created_at,
            a2.title, a2.canonical_url, a2.verification_status, o2.outlet_key
     FROM corroborations c JOIN articles a2 ON a2.id=c.corroborating_article_id JOIN outlets o2 ON o2.id=a2.outlet_id
     WHERE c.article_id=? ORDER BY c.id`, [id]);
  const [events] = await pool.query('SELECT id, from_status, to_status, reason, actor, details, created_at FROM verification_events WHERE article_id=? ORDER BY id', [id]);
  return { ...art, corroborations, events };
}

export async function searchArticles(pool, { query, topic, status, outlet_key, since, until, limit = 25 } = {}) {
  const where = [], params = [];
  if (query) { where.push('MATCH(a.title, a.summary) AGAINST(? IN NATURAL LANGUAGE MODE)'); params.push(query); }
  if (topic) { where.push('(a.topic = ? OR MATCH(a.title, a.summary) AGAINST(? IN NATURAL LANGUAGE MODE))'); params.push(topic, topic); }
  if (status) { where.push('a.verification_status = ?'); params.push(status); }
  if (outlet_key) { where.push('o.outlet_key = ?'); params.push(outlet_key); }
  if (since) { where.push('a.published_at >= ?'); params.push(toDate(since)); }
  if (until) { where.push('a.published_at <= ?'); params.push(toDate(until)); }
  params.push(Math.min(Math.max(Number(limit) || 25, 1), 100));
  const [rows] = await pool.query(
    `SELECT a.id, a.title, o.outlet_key, a.canonical_url, a.published_at, a.verification_status, a.is_wire_copy
     FROM articles a JOIN outlets o ON o.id=a.outlet_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.published_at DESC, a.id DESC LIMIT ?`, params);
  return rows.map((r) => ({ ...r, id: Number(r.id), is_wire_copy: !!r.is_wire_copy }));
}

export async function listUnverifiedIds(pool, { topic } = {}) {
  const params = [];
  let extra = '';
  if (topic) { extra = ' AND (a.topic = ? OR MATCH(a.title, a.summary) AGAINST(? IN NATURAL LANGUAGE MODE))'; params.push(topic, topic); }
  const [rows] = await pool.query(`SELECT a.id FROM articles a WHERE a.verification_status='unverified'${extra} ORDER BY a.published_at, a.id`, params);
  return rows.map((r) => Number(r.id));
}

// ---------- corroboration ----------
/** Candidate set: other ownership group, inside the window, not rejected. Scored in JS (C3). */
export async function findCandidates(q, article, cfg, windowHours) {
  const w = windowHours ?? cfg.window_hours;
  const pub = toDate(article.published_at);
  const [rows] = await q.query(
    `SELECT ${ARTICLE_COLS} FROM articles a JOIN outlets o ON o.id=a.outlet_id
     WHERE a.id <> ? AND COALESCE(o.ownership_group, o.outlet_key) <> ? AND a.verification_status <> 'rejected'
       AND a.published_at BETWEEN DATE_SUB(?, INTERVAL ? HOUR) AND DATE_ADD(?, INTERVAL ? HOUR)
     ORDER BY ABS(TIMESTAMPDIFF(SECOND, a.published_at, ?)), a.id LIMIT ?`,
    [article.id, article.group, pub, w, pub, w, pub, cfg.candidate_limit]);
  return rows.map(shape);
}

export async function findCorroborations(pool, articleId, cfg, { windowHours, limit = 20 } = {}) {
  const article = await getArticleRow(pool, articleId);
  if (!article) throw new RepoError(`article ${articleId} not found`);
  const rule = { ...cfg, ...(windowHours ? { window_hours: windowHours } : {}) };
  const cands = await findCandidates(pool, article, rule);
  const ev = evaluate(article, cands, rule);
  const byId = new Map(ev.matches.map((m) => [Number(m.id), m]));
  const { compare } = await import('./similarity.mjs');
  const scored = cands.map((c) => {
    const m = byId.get(c.id);
    const s = m ?? compare(article, c, rule.syndication_threshold);
    return { id: c.id, title: c.title, summary: c.summary, outlet_key: c.outlet_key, group: c.group, canonical_url: c.canonical_url,
      published_at: c.published_at, score: s.score, title_overlap: s.titleOverlap, keyword_jaccard: s.keywordJaccard,
      shared_salient: s.sharedSalient, syndicated: s.syndicated, wire_copy: c.is_wire_copy, matches: !!m };
  }).sort((x, y) => Number(y.matches) - Number(x.matches) || y.score - x.score || x.id - y.id)
    .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 50));
  const { group, ...art } = article;
  return { article: { ...art, group }, candidates: scored, independent_groups: ev.independentGroups, meets_rule: ev.meetsRule, rule };
}

async function insertEvent(conn, articleId, from, to, reason, actor, details) {
  await conn.query('INSERT INTO verification_events (article_id, from_status, to_status, reason, actor, details) VALUES (?,?,?,?,?,?)',
    [articleId, from, to, reason, actor, details ? JSON.stringify(details) : null]);
}

/**
 * Changes verification status. Corroboration is re-computed here (server side) and cannot be forced.
 * @param actor 'claude' | 'auto' | 'cascade'
 */
export async function markVerified(pool, { articleId, status, corroboratingIds = [], reason, actor = 'claude' }, cfg) {
  if (!['corroborated', 'rejected', 'unverified'].includes(status)) throw new RepoError(`invalid status ${status}`);
  if (!reason || String(reason).trim().length < (actor === 'claude' ? 20 : 1)) throw new RepoError('reason must be at least 20 characters');
  const ids = [...new Set((corroboratingIds || []).map(Number))];
  if (ids.length > 20) throw new RepoError('at most 20 corroborating_ids');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const art = await getArticleRow(pool, articleId, { forUpdate: true, conn });
    if (!art) throw new RepoError(`article ${articleId} not found`);
    const from = art.verification_status;
    let independent = [], recorded = 0, cascaded = [];
    if (status === 'corroborated') {
      if (ids.includes(Number(articleId))) throw new RepoError('an article cannot corroborate itself');
      const cands = await getArticlesByIds(conn, ids);
      const found = new Set(cands.map((c) => c.id));
      const missing = ids.filter((i) => !found.has(i));
      if (missing.length) throw new RepoError(`corroborating ids not found: ${missing.join(', ')}`, { missing });
      const rejectedC = cands.filter((c) => c.verification_status === 'rejected').map((c) => c.id);
      if (rejectedC.length) throw new RepoError(`corroborating ids are rejected articles: ${rejectedC.join(', ')}`, { rejected: rejectedC });
      const ev = evaluate(art, cands, cfg);
      const matchIds = new Set(ev.matches.map((m) => Number(m.id)));
      const failing = ev.rejectedCandidates.map((r) => `${r.id} (${r.reason})`);
      if (ids.some((i) => !matchIds.has(i))) throw new RepoError(`corroborating ids do not match: ${failing.join('; ')}`, { failing: ev.rejectedCandidates });
      if (!ev.meetsRule) {
        throw new RepoError(`rule not met: ${ev.independentGroups.length} independent outlet group(s) (excluding syndicated/wire copy) [${ev.independentGroups.join(', ')}], need ${cfg.min_independent_outlets}`,
          { independent_groups: ev.independentGroups });
      }
      for (const m of ev.matches) {
        await conn.query(
          `INSERT INTO corroborations (article_id, corroborating_article_id, score, title_overlap, keyword_jaccard, method, confirmed_by)
           VALUES (?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE score=VALUES(score), title_overlap=VALUES(title_overlap), keyword_jaccard=VALUES(keyword_jaccard),
             method=VALUES(method), confirmed_by=VALUES(confirmed_by), created_at=CURRENT_TIMESTAMP`,
          [art.id, m.id, m.score, m.titleOverlap, m.keywordJaccard, m.syndicated || m.wireCopy ? 'syndicated' : 'similarity', actor]);
        recorded++;
      }
      independent = ev.independentGroups;
      await conn.query('UPDATE articles SET verification_status=?, verification_reason=?, verified_at=UTC_TIMESTAMP(), verified_by=? WHERE id=?',
        [status, reason, actor, art.id]);
      await insertEvent(conn, art.id, from, status, reason, actor, { corroborating_ids: ids, independent_groups: independent,
        matches: ev.matches.map((m) => ({ id: m.id, outlet: m.outletKey, score: m.score, syndicated: m.syndicated, wire_copy: m.wireCopy })), rule: cfg });
    } else {
      await conn.query('UPDATE articles SET verification_status=?, verification_reason=?, verified_at=UTC_TIMESTAMP(), verified_by=? WHERE id=?',
        [status, reason, actor, art.id]);
      await insertEvent(conn, art.id, from, status, reason, actor, ids.length ? { corroborating_ids: ids } : null);
      if (status === 'rejected') cascaded = await cascadeAfterReject(conn, art.id, cfg);
    }
    await conn.commit();
    return { article_id: art.id, from_status: from, to_status: status, independent_outlets: independent, corroborations_recorded: recorded, cascaded };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }
}

/** Re-evaluates corroborated articles that relied on `rejectedId`; downgrades those that no longer meet the rule. */
async function cascadeAfterReject(conn, rejectedId, cfg) {
  const [deps] = await conn.query(
    `SELECT DISTINCT c.article_id FROM corroborations c JOIN articles a ON a.id=c.article_id
     WHERE c.corroborating_article_id=? AND a.verification_status='corroborated'`, [rejectedId]);
  return recheckWithConn(conn, deps.map((d) => Number(d.article_id)), cfg, {
    actor: 'cascade',
    reason: (n) => `cascade: corroborating article ${rejectedId} was rejected; ${n} independent group(s) remain, need ${cfg.min_independent_outlets}`,
    details: { rejected_id: rejectedId },
  });
}

/**
 * Re-evaluates corroborated articles against their recorded (non-rejected) corroborators with the current rule.
 * Corroboration rows whose corroborator is now wire/syndicated copy are relabelled 'syndicated' (so the reference view
 * stops counting them); articles that fall below the rule go back to 'unverified' with a verification event.
 */
async function recheckWithConn(conn, articleIds, cfg, { actor, reason, details = {} }) {
  const out = [];
  for (const article_id of articleIds) {
    const art = await getArticleRow(null, article_id, { forUpdate: true, conn });
    const [rows] = await conn.query(
      `SELECT c.corroborating_article_id AS id FROM corroborations c JOIN articles a2 ON a2.id=c.corroborating_article_id
       WHERE c.article_id=? AND a2.verification_status <> 'rejected'`, [article_id]);
    const cands = await getArticlesByIds(conn, rows.map((r) => Number(r.id)));
    if (!art || art.verification_status !== 'corroborated') continue;
    const ev = evaluate(art, cands, cfg);
    for (const m of ev.matches) {
      if (m.syndicated || m.wireCopy) {
        await conn.query("UPDATE corroborations SET method='syndicated' WHERE article_id=? AND corroborating_article_id=? AND method<>'syndicated'", [article_id, m.id]);
      }
    }
    if (!ev.meetsRule) {
      const why = reason(ev.independentGroups.length);
      await conn.query("UPDATE articles SET verification_status='unverified', verification_reason=?, verified_at=UTC_TIMESTAMP(), verified_by=? WHERE id=?", [why, actor, article_id]);
      await insertEvent(conn, Number(article_id), 'corroborated', 'unverified', why, actor, { ...details, independent_groups: ev.independentGroups,
        matches: ev.matches.map((m) => ({ id: m.id, outlet: m.outletKey, syndicated: m.syndicated, wire_copy: m.wireCopy })) });
      out.push({ id: Number(article_id), to_status: 'unverified' });
    }
  }
  return out;
}

/** Re-derives is_wire_copy for stored articles (only ever flips 0 -> 1). Returns the ids that changed. */
export async function refreshWireFlags(pool) {
  const { isWireCopy } = await import('./wire.mjs');
  const [rows] = await pool.query('SELECT id, url, summary, author FROM articles WHERE is_wire_copy=0');
  const ids = rows.filter((r) => isWireCopy(r)).map((r) => Number(r.id));
  if (ids.length) await pool.query('UPDATE articles SET is_wire_copy=1 WHERE id IN (?)', [ids]);
  return ids;
}

/** Re-checks every corroborated article with the current rule (actor 'auto'); never rejects. */
export async function recheckCorroborated(pool, cfg) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT id FROM articles WHERE verification_status='corroborated' ORDER BY id");
    const changed = await recheckWithConn(conn, rows.map((r) => Number(r.id)), cfg, {
      actor: 'auto',
      reason: (n) => `recheck: only ${n} independent outlet group(s) remain after excluding wire/syndicated copy, need ${cfg.min_independent_outlets}`,
      details: { recheck: true },
    });
    await conn.commit();
    return { checked: rows.length, downgraded: changed };
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}

/** Evaluates an article against its candidate set and, if the rule is met, marks it corroborated (actor auto). */
export async function autoVerify(pool, articleId, cfg) {
  const fc = await findCorroborations(pool, articleId, cfg, { limit: 50 });
  if (!fc.meets_rule) return { article_id: articleId, meets_rule: false, independent_groups: fc.independent_groups };
  const ids = fc.candidates.filter((c) => c.matches).map((c) => c.id).slice(0, 20);
  const names = [...new Set(fc.candidates.filter((c) => c.matches && !c.syndicated && !c.wire_copy).map((c) => c.outlet_key))];
  const r = await markVerified(pool, { articleId, status: 'corroborated', corroboratingIds: ids,
    reason: `auto: deterministic rule met by ${names.length} independent outlet(s): ${names.join(', ')}`, actor: 'auto' }, cfg);
  return { article_id: articleId, meets_rule: true, ...r };
}

// ---------- references ----------
export async function queryReferences(pool, { topic, query, since, until, limit = 30 } = {}) {
  const where = [], params = [];
  if (topic) { where.push('(v.topic = ? OR v.id IN (SELECT id FROM articles WHERE MATCH(title, summary) AGAINST(? IN NATURAL LANGUAGE MODE)))'); params.push(topic, topic); }
  if (query) { where.push('v.id IN (SELECT id FROM articles WHERE MATCH(title, summary) AGAINST(? IN NATURAL LANGUAGE MODE))'); params.push(query); }
  if (since) { where.push('v.published_at >= ?'); params.push(toDate(since)); }
  if (until) { where.push('v.published_at <= ?'); params.push(toDate(until)); }
  params.push(Math.min(Math.max(Number(limit) || 30, 1), 100));
  const [rows] = await pool.query(
    `SELECT v.id, v.title, v.outlet, v.canonical_url, v.published_at, v.independent_corroborators, v.corroborating_outlets
     FROM v_reference_ready v ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY v.independent_corroborators DESC, v.published_at ASC, v.id ASC LIMIT ?`, params);
  return rows.map((r) => ({ ...r, id: Number(r.id), independent_corroborators: Number(r.independent_corroborators) }));
}

export async function corroboratorNames(q, articleId) {
  const [rows] = await q.query(
    `SELECT DISTINCT o2.name FROM corroborations c JOIN articles a2 ON a2.id=c.corroborating_article_id JOIN outlets o2 ON o2.id=a2.outlet_id
     WHERE c.article_id=? AND c.method='similarity' AND a2.verification_status <> 'rejected' ORDER BY o2.name`, [articleId]);
  return rows.map((r) => r.name);
}

export async function citeArticles(pool, { report_slug, report_title, article_ids, style = 'apa' }, accessedDate = new Date()) {
  if (!/^[a-z0-9-]{3,128}$/.test(report_slug || '')) throw new RepoError('invalid report_slug');
  const ids = [...new Set((article_ids || []).map(Number))];
  if (!ids.length || ids.length > 100) throw new RepoError('article_ids must contain 1..100 ids');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const arts = await getArticlesByIds(conn, ids);
    const byId = new Map(arts.map((a) => [a.id, a]));
    const offenders = ids.filter((i) => byId.get(i)?.verification_status !== 'corroborated').map((i) => `${i}:${byId.get(i)?.verification_status ?? 'missing'}`);
    if (offenders.length) throw new RepoError(`only corroborated articles may be cited; offending ids: ${offenders.join(', ')}. Run /verify-sources first.`, { offenders });
    assertAllCorroborated(arts);
    await conn.query('INSERT INTO reports (slug, title) VALUES (?, ?) ON DUPLICATE KEY UPDATE title=COALESCE(VALUES(title), title)', [report_slug, report_title ?? null]);
    const [[rep]] = await conn.query('SELECT id FROM reports WHERE slug=?', [report_slug]);
    const items = [];
    for (const a of arts) {
      await conn.query('INSERT INTO report_citations (report_id, article_id, citation_style) VALUES (?,?,?) ON DUPLICATE KEY UPDATE citation_style=VALUES(citation_style), cited_at=CURRENT_TIMESTAMP',
        [rep.id, a.id, style]);
      items.push({ article: a, corroborators: await corroboratorNames(conn, a.id) });
    }
    const { references, formatted } = formatList(items, style, accessedDate);
    await conn.commit();
    return { report_slug, style, references, formatted };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }
}

// ---------- misc ----------
export async function stats(pool) {
  const [rows] = await pool.query('SELECT verification_status s, COUNT(*) n FROM articles GROUP BY verification_status');
  const articles = { unverified: 0, corroborated: 0, rejected: 0, total: 0 };
  for (const r of rows) { articles[r.s] = Number(r.n); articles.total += Number(r.n); }
  const [[o]] = await pool.query('SELECT COUNT(*) n FROM outlets');
  const [[f]] = await pool.query('SELECT COUNT(*) n FROM feeds');
  const [[rp]] = await pool.query('SELECT COUNT(*) n FROM reports');
  return { articles, outlets: Number(o.n), feeds: Number(f.n), reports: Number(rp.n) };
}

export async function listOutlets(pool) {
  const [rows] = await pool.query(
    `SELECT o.outlet_key, o.name, o.ownership_group, o.reliability_tier, GROUP_CONCAT(d.domain ORDER BY d.domain SEPARATOR ',') AS domains
     FROM outlets o LEFT JOIN outlet_domains d ON d.outlet_id=o.id GROUP BY o.id ORDER BY o.outlet_key`);
  return rows.map((r) => ({ outlet_key: r.outlet_key, name: r.name, domains: r.domains ? r.domains.split(',') : [], ownership_group: r.ownership_group, reliability_tier: r.reliability_tier }));
}

export async function statusesByIds(pool, ids) {
  if (!ids.length) return {};
  const [rows] = await pool.query('SELECT id, verification_status FROM articles WHERE id IN (?)', [ids]);
  return Object.fromEntries(rows.map((r) => [Number(r.id), r.verification_status]));
}

export async function statusesByCanonicalHashes(pool, hashes) {
  if (!hashes.length) return {};
  const [rows] = await pool.query('SELECT canonical_url_hash h, verification_status FROM articles WHERE canonical_url_hash IN (?)', [hashes]);
  return Object.fromEntries(rows.map((r) => [r.h, r.verification_status]));
}
