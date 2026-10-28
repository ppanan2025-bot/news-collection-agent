import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWireCopy, isWireByline } from '../src/lib/wire.mjs';
import { normalizeItem } from '../src/lib/rss.mjs';
import { evaluate } from '../src/lib/corroborate.mjs';
import { loadVerification } from '../src/lib/config.mjs';
import { root } from '../src/lib/env.mjs';
import { loadFixtureArticles } from './helpers.mjs';

const cfg = loadVerification(root);

test('wire-agency bylines are detected', () => {
  for (const a of ['The Associated Press', 'Associated Press', 'By ASSOCIATED PRESS', 'AP', 'Jane Doe, AP', 'Reuters', 'Jane Doe (Reuters)',
    'AFP', 'Agence France-Presse', 'Agence France Presse', 'Staff and agencies; AFP']) assert.equal(isWireByline(a), true, a);
  for (const a of [null, '', 'Jane Doe', 'FRANCE24', 'FRANCE 24', 'Apple Reporter', 'Raja Abdulrahim', 'Dap Smith', 'Natalie Apostolou'])
    assert.equal(isWireByline(a), false, String(a));
});
test('isWireCopy: URL, dateline or byline', () => {
  assert.equal(isWireCopy({ url: 'https://abcnews.go.com/International/wireStory/x-1' }), true);
  assert.equal(isWireCopy({ url: 'https://x.com/a', summary: 'SANTIAGO, Chile (AP) — A quake' }), true);
  assert.equal(isWireCopy({ url: 'https://npr.org/a', author: 'The Associated Press' }), true);
  assert.equal(isWireCopy({ url: 'https://npr.org/a', author: 'Catherine Osborn' }), false);
});

// Live case found by the validator (2026-10-28): NPR 42 (AP byline) was "corroborated" by ABC 156 (AP /wireStory/) + France 24 104.
const now = new Date('2026-10-28T00:00:00Z');
const npr = { ...normalizeItem({
  title: 'Local ceasefire brokered by Melania Trump starts in southern Ukraine',
  link: 'https://www.npr.org/2026/10/27/g-s1-150037/russia-ukraine-war',
  contentSnippet: 'A localized ceasefire between Ukraine and Russia took effect early Tuesday ahead of a humanitarian mission brokered by U.S. first lady Melania Trump, as missile attacks resumed in Kyiv.',
  creator: 'The Associated Press', isoDate: '2026-10-27T05:26:58.000Z' }, {}, { key: 'npr' }, now), id: 42, group: 'npr' };
const abc = { ...normalizeItem({
  title: 'Local ceasefire brokered by Melania Trump starts in Ukraine',
  link: 'https://abcnews.com/International/wireStory/local-ceasefire-brokered-melania-trump-starts-southern-ukraine-137590102',
  contentSnippet: 'A localized ceasefire between Ukraine and Russia has taken effect ahead of a humanitarian mission brokered by U.S. first lady Melania Trump',
  isoDate: '2026-10-27T06:37:12.000Z' }, {}, { key: 'abc' }, now), id: 156, group: 'disney-abc' };
const f24 = { ...normalizeItem({
  title: 'Localised Russia-Ukraine ceasefire starts Ukrainian town facing starvation',
  link: 'https://www.france24.com/en/video/20261027-localised-russia-ukraine-ceasefire-starts-ukrainian-town-facing-starvation',
  contentSnippet: "A localised ceasefire between Ukraine and Russia took effect early Tuesday (October 27) ahead of a humanitarian mission led by US first lady Melania Trump, as missile attacks resumed in Kyiv. FRANCE 24's correspondent in Kyiv, Emmanuelle Chaze, has more.",
  creator: 'FRANCE24', isoDate: '2026-10-27T12:34:42.000Z' }, {}, { key: 'france24' }, now), id: 104, group: 'france-medias-monde' };

test('live case: AP byline at NPR is flagged as wire copy at normalize time', () => {
  assert.equal(npr.is_wire_copy, true);
  assert.equal(abc.is_wire_copy, true);
  assert.equal(f24.is_wire_copy, false);
});
test('live case: NPR 42 is not corroborated by ABC 156 (wire) + France 24 104', () => {
  const r = evaluate(npr, [abc, f24], cfg);
  assert.ok(r.matches.some((m) => m.id === 156 && m.wireCopy), 'ABC still matches but is flagged wire copy');
  assert.deepEqual(r.independentGroups, ['france-medias-monde']);
  assert.equal(r.meetsRule, false);
});
test('a wire-copy candidate never counts, even when the article itself is not wire copy', () => {
  const nonWireNpr = { ...npr, is_wire_copy: false, author: 'Staff' };
  const r = evaluate(nonWireNpr, [abc, f24], cfg);
  assert.equal(r.matches.find((m) => m.id === 156).wireCopy, true);
  assert.deepEqual(r.independentGroups, ['france-medias-monde']);
  assert.equal(r.meetsRule, false);
  // With min 1 the France 24 match alone suffices; ABC still does not count.
  assert.deepEqual(evaluate(nonWireNpr, [abc, f24], { ...cfg, min_independent_outlets: 1 }).independentGroups, ['france-medias-monde']);
});
test('fixture story A unaffected: no fixture A item is wire copy', async () => {
  const arts = await loadFixtureArticles();
  const A = arts.filter((a) => /Grindavik/.test(a.title));
  assert.equal(A.length, 3);
  for (const a of A) {
    assert.equal(a.is_wire_copy, false);
    assert.equal(evaluate(a, arts, cfg).meetsRule, true);
  }
});
