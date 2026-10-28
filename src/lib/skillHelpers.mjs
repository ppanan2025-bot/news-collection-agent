// Pure helpers behind the read-only skill scripts (pending.mjs, preview-references.mjs).
import { formatList } from './references.mjs';

/** Shapes find_corroborations results into a compact pending-review list. */
export function summarizePending(results) {
  return results.map((fc) => ({
    id: fc.article.id,
    title: fc.article.title,
    outlet_key: fc.article.outlet_key,
    published_at: fc.article.published_at,
    is_wire_copy: !!fc.article.is_wire_copy,
    meets_rule: fc.meets_rule,
    independent_groups: fc.independent_groups,
    matches: fc.candidates.filter((c) => c.matches).map((c) => ({
      id: c.id, outlet_key: c.outlet_key, title: c.title, score: c.score,
      syndicated: !!c.syndicated, wire_copy: !!c.wire_copy,
    })),
  })).sort((a, b) => Number(b.meets_rule) - Number(a.meets_rule) || a.id - b.id);
}

/**
 * Formats reference-ready rows (from v_reference_ready, which only contains corroborated articles) without recording
 * anything. Rows lacking independent corroborators are dropped defensively.
 */
export function buildPreview(rows, corroboratorsById, style = 'apa', accessedDate = new Date()) {
  const usable = rows.filter((r) => Number(r.independent_corroborators) > 0);
  const items = usable.map((r) => ({
    article: { ...r, verification_status: 'corroborated' },
    corroborators: corroboratorsById[r.id] ?? [],
  }));
  const { references, formatted } = formatList(items, style, accessedDate);
  return { preview: true, recorded: false, count: references.length, style, references, formatted,
    note: 'Preview only: nothing was recorded. Record citations with mcp__newsdb__cite_articles.' };
}
