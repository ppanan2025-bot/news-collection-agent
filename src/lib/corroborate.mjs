// Pure, deterministic corroboration decision.
import { compare } from './similarity.mjs';

export const countsAsIndependent = (m) => !m.syndicated && !m.wireCopy;

export const groupOf = (x) => x.group ?? x.ownership_group ?? x.outlet_key ?? x.outletKey ?? null;

function toMs(d) {
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * @param article    {id,title,summary,content_hash,is_wire_copy,published_at,outlet_key,group|ownership_group}
 * @param candidates same shape
 * @param cfg        verification config
 */
export function evaluate(article, candidates, cfg) {
  const aGroup = groupOf(article);
  const aT = toMs(article.published_at);
  const matches = [], rejectedCandidates = [];
  const sorted = [...candidates].sort((x, y) => Number(x.id) - Number(y.id));
  for (const c of sorted) {
    const cGroup = groupOf(c);
    const outletKey = c.outlet_key ?? c.outletKey ?? null;
    if (Number(c.id) === Number(article.id)) { rejectedCandidates.push({ id: c.id, reason: 'same article' }); continue; }
    if (cGroup === aGroup) { rejectedCandidates.push({ id: c.id, reason: 'same outlet or ownership group' }); continue; }
    const deltaHours = Math.round(((toMs(c.published_at) - aT) / 3600000) * 100) / 100;
    if (!Number.isFinite(deltaHours) || Math.abs(deltaHours) > cfg.window_hours) {
      rejectedCandidates.push({ id: c.id, reason: `outside ${cfg.window_hours}h window` }); continue;
    }
    const s = compare(article, c, cfg.syndication_threshold);
    if (s.score < cfg.min_score) { rejectedCandidates.push({ id: c.id, reason: `score ${s.score} < ${cfg.min_score}` }); continue; }
    if (s.sharedSalient < cfg.min_shared_salient_tokens) {
      rejectedCandidates.push({ id: c.id, reason: `shared salient tokens ${s.sharedSalient} < ${cfg.min_shared_salient_tokens}` }); continue;
    }
    matches.push({ id: c.id, outletKey, group: cGroup, score: s.score, titleOverlap: s.titleOverlap,
      keywordJaccard: s.keywordJaccard, sharedSalient: s.sharedSalient, syndicated: s.syndicated, wireCopy: !!c.is_wire_copy, deltaHours });
  }
  // A candidate counts only if it is neither syndicated with the article nor itself wire-agency copy.
  const independentGroups = [...new Set(matches.filter(countsAsIndependent).map((m) => m.group))].sort();
  return { matches, rejectedCandidates, independentGroups, meetsRule: independentGroups.length >= cfg.min_independent_outlets };
}
