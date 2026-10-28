import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReference, formatList, assertAllCorroborated } from '../src/lib/references.mjs';

const art = { id: 7, title: 'Iceland volcano erupts near Grindavik', outlet: 'BBC News', canonical_url: 'https://bbc.co.uk/news/articles/c1volcano',
  published_at: '2026-10-20T06:10:00Z', verification_status: 'corroborated' };
const corr = ['The Guardian', 'NPR'];
const acc = new Date('2026-10-28T12:00:00Z');

test('apa', () => assert.equal(formatReference(art, corr, 'apa', acc),
  'Iceland volcano erupts near Grindavik. (2026, October 20). *BBC News*. https://bbc.co.uk/news/articles/c1volcano Corroborated by: NPR, The Guardian.'));
test('apa with author', () => assert.equal(formatReference({ ...art, author: 'Jane Doe' }, corr, 'apa', acc),
  'Jane Doe. (2026, October 20). Iceland volcano erupts near Grindavik. *BBC News*. https://bbc.co.uk/news/articles/c1volcano Corroborated by: NPR, The Guardian.'));
test('mla', () => assert.equal(formatReference(art, corr, 'mla', acc),
  '"Iceland volcano erupts near Grindavik." *BBC News*, 20 Oct. 2026, https://bbc.co.uk/news/articles/c1volcano. Accessed 28 Oct. 2026. Corroborated by: NPR, The Guardian.'));
test('chicago', () => assert.equal(formatReference(art, corr, 'chicago', acc),
  'BBC News. "Iceland volcano erupts near Grindavik." October 20, 2026. https://bbc.co.uk/news/articles/c1volcano. Corroborated by: NPR, The Guardian.'));
test('markdown', () => assert.equal(formatReference(art, corr, 'markdown', acc, 3),
  '[3] BBC News — "Iceland volcano erupts near Grindavik" (2026-10-20). <https://bbc.co.uk/news/articles/c1volcano> Corroborated by: NPR, The Guardian.'));
test('throws on unverified or rejected', () => {
  assert.throws(() => formatReference({ ...art, verification_status: 'unverified' }, corr, 'apa'));
  assert.throws(() => formatReference({ ...art, verification_status: 'rejected' }, corr, 'apa'));
  assert.throws(() => assertAllCorroborated([art, { id: 9, verification_status: 'unverified' }]), /9:unverified/);
  assert.throws(() => formatReference(art, corr, 'harvard'));
});
test('list numbering and ordering are deterministic', () => {
  const later = { ...art, id: 3, title: 'Later story', published_at: '2026-10-21T00:00:00Z' };
  const sameTime = { ...art, id: 2, title: 'Same time lower id' };
  const items = [later, art, sameTime].map((a) => ({ article: a, corroborators: corr }));
  const r1 = formatList(items, 'apa', acc), r2 = formatList([...items].reverse(), 'apa', acc);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.references.map((r) => r.article_id), [2, 7, 3]);
  assert.match(r1.formatted.split('\n')[0], /^1\. Same time lower id/);
  assert.match(formatList(items, 'markdown', acc).formatted.split('\n')[2], /^\[3\] /);
});
