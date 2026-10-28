import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stem, tokenize, keywords, salientTokens } from '../src/lib/text.mjs';
import { score, titleOverlap, keywordJaccard, sharedSalient, isSyndicated, compare } from '../src/lib/similarity.mjs';
import { loadFixtureArticles } from './helpers.mjs';

test('stemming', () => {
  assert.deepEqual(['erupts', 'eruption', 'erupted'].map(stem), ['erupt', 'erupt', 'erupt']);
  assert.deepEqual(['forces', 'forcing', 'forced'].map(stem), ['forc', 'forc', 'forc']);
  assert.equal(stem('countries'), 'country');
  assert.equal(stem('press'), 'press');
});
test('stopwords and filler removed; short tokens dropped; 2-digit numbers kept', () => {
  assert.deepEqual(tokenize('Live update: the latest news says it is over'), []);
  assert.deepEqual(tokenize('Quake of 68 at 7 in Chile'), ['quake', '68', 'chile']);
  assert.deepEqual(tokenize('Mbappé'), ['mbappe']);
});
test('salient tokens', () => {
  const s = salientTokens('Iceland volcano erupts near Grindavik');
  assert.ok(s.has('iceland') && s.has('volcano') && s.has('grindavik') && s.has('erupt'));
});
test('keywords are deterministic, frequency then alphabetical', () => {
  assert.deepEqual(keywords('beta alpha beta gamma alpha beta'), ['beta', 'alpha', 'gamma']);
});

const arts = await loadFixtureArticles();
const by = (frag) => arts.find((a) => a.title.includes(frag));
const A = [by('Iceland volcano erupts'), by('Volcanic eruption'), by("Reykjanes volcano")];
const C = [arts.find((a) => a.outlet_key === 'abc'), arts.find((a) => a.outlet_key === 'cbs' && a.is_wire_copy)];

test('symmetry and determinism', () => {
  for (const x of arts) for (const y of arts) {
    assert.equal(score(x, y), score(y, x));
    assert.equal(sharedSalient(x, y), sharedSalient(y, x));
    assert.equal(isSyndicated(x, y), isSyndicated(y, x));
  }
  assert.deepEqual(compare(A[0], A[1]), compare(A[0], A[1]));
});
test('same-story pairs score >= 0.35 with >= 2 shared salient tokens', () => {
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    assert.ok(score(A[i], A[j]) >= 0.35, `${A[i].title} ~ ${A[j].title}: ${score(A[i], A[j])}`);
    assert.ok(sharedSalient(A[i], A[j]) >= 2);
  }
});
test('unrelated pairs score below 0.35', () => {
  const unrelated = arts.filter((a) => !A.includes(a) && !C.includes(a));
  for (const u of unrelated) for (const a of A) assert.ok(score(u, a) < 0.35, `${u.title} vs ${a.title}`);
  assert.ok(score(A[0], C[0]) < 0.35);
});
test('isSyndicated: identical AP copy true, independent rewrites false', () => {
  assert.equal(isSyndicated(C[0], C[1]), true);
  assert.equal(isSyndicated(A[0], A[1]), false);
  assert.equal(isSyndicated(A[1], A[2]), false);
});
test('titleOverlap / keywordJaccard ranges', () => {
  assert.equal(titleOverlap({ title: '' }, A[0]), 0);
  const kj = keywordJaccard(A[0], A[1]);
  assert.ok(kj >= 0 && kj <= 1);
});
