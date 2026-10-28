import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/lib/corroborate.mjs';
import { loadVerification } from '../src/lib/config.mjs';
import { root } from '../src/lib/env.mjs';
import { loadFixtureArticles } from './helpers.mjs';

const cfg = loadVerification(root);
const arts = await loadFixtureArticles();
const by = (frag) => arts.find((a) => a.title.includes(frag));
const [a1, a2, a3] = [by('Iceland volcano erupts'), by('Volcanic eruption'), by('Reykjanes volcano')];

test('default config: min_independent_outlets = 2 (D1)', () => assert.equal(cfg.min_independent_outlets, 2));

test('fixture outcomes: story A corroborated; B, C, D not', () => {
  for (const a of arts) {
    const r = evaluate(a, arts, cfg);
    const isA = [a1, a2, a3].includes(a);
    assert.equal(r.meetsRule, isA, `${a.outlet_key}: ${a.title}`);
  }
});
test('excludes same-outlet and same-ownership-group candidates', () => {
  const sameGroup = { ...a2, id: 900, outlet_key: 'bbc-sister', group: a1.group };
  const r = evaluate(a1, [sameGroup], cfg);
  assert.equal(r.matches.length, 0);
  assert.match(r.rejectedCandidates[0].reason, /same outlet/);
});
test('excludes candidates outside the window', () => {
  const late = { ...a2, id: 901, published_at: new Date(new Date(a1.published_at).getTime() + (cfg.window_hours + 1) * 3600e3) };
  const r = evaluate(a1, [late, a3], cfg);
  assert.ok(r.rejectedCandidates.some((x) => x.id === 901 && /window/.test(x.reason)));
  assert.equal(r.meetsRule, false);
});
test('syndicated pairs are excluded from the count', () => {
  const syn = { ...a1, id: 902, outlet_key: 'other', group: 'other-group' };
  const r = evaluate(a1, [syn, a2], cfg);
  assert.ok(r.matches.find((m) => m.id === 902).syndicated);
  assert.deepEqual(r.independentGroups, [a2.group]);
  assert.equal(r.meetsRule, false);
});
test('two articles from one other outlet count as one group', () => {
  const a2b = { ...a2, id: 903, url: a2.url + '-b', title: a2.title + ' as lava flows', content_hash: 'x', summary: 'Different words entirely about lava walls and Grindavik evacuation in Iceland' };
  const r = evaluate(a1, [a2, a2b], cfg);
  assert.equal(r.independentGroups.length, 1);
  assert.equal(r.meetsRule, false);
});
test('meetsRule false with 1 independent group, true with 2', () => {
  assert.equal(evaluate(a1, [a2], cfg).meetsRule, false);
  assert.equal(evaluate(a1, [a2, a3], cfg).meetsRule, true);
});
test('respects min_independent_outlets overrides', () => {
  assert.equal(evaluate(a1, [a2], { ...cfg, min_independent_outlets: 1 }).meetsRule, true);
  assert.equal(evaluate(a1, [a2, a3], { ...cfg, min_independent_outlets: 3 }).meetsRule, false);
});
test('deterministic output', () => {
  assert.deepEqual(evaluate(a1, [a3, a2], cfg), evaluate(a1, [a2, a3], cfg));
});
