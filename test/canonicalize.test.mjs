import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, sha256, hostOf } from '../src/lib/canonicalize.mjs';

test('removes tracking params and fragment', () => {
  assert.equal(canonicalUrl('https://www.bbc.co.uk/news/articles/c1?at_medium=RSS&at_campaign=rss#frag'), 'https://bbc.co.uk/news/articles/c1');
  assert.equal(canonicalUrl('https://example.com/a?utm_source=x&utm_medium=y&maca=1&traffic_source=rss'), 'https://example.com/a');
  assert.equal(canonicalUrl('https://example.com/a?fbclid=1&gclid=2&ocid=3&smid=4&cmpid=5&CMP=6&ns_mchannel=7&ref=8&rss=1'), 'https://example.com/a');
});
test('lowercases host, strips www, drops default port', () => {
  assert.equal(canonicalUrl('HTTPS://WWW.TheGuardian.COM:443/world/x'), 'https://theguardian.com/world/x');
});
test('http and https canonicalise to the same URL', () => {
  assert.equal(canonicalUrl('http://www.npr.org/2026/10/20/story/'), canonicalUrl('https://npr.org/2026/10/20/story'));
});
test('keeps meaningful params, sorted', () => {
  assert.equal(canonicalUrl('https://example.com/a?z=2&id=5&utm_source=x'), 'https://example.com/a?id=5&z=2');
});
test('trailing slash stripped except root', () => {
  assert.equal(canonicalUrl('https://example.com/a/b/'), 'https://example.com/a/b');
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/');
});
test('identical input gives the same hash', () => {
  const a = canonicalUrl('https://www.dw.com/en/x/a-123?maca=en-rss-en-world-4025-rdf');
  assert.equal(sha256(a), sha256(canonicalUrl('https://dw.com/en/x/a-123')));
  assert.match(sha256('x'), /^[0-9a-f]{64}$/);
});
test('real sample URLs from BBC, DW and Al Jazeera feeds', () => {
  assert.equal(canonicalUrl('https://www.bbc.com/news/articles/cx2k4y8e1zno?at_medium=RSS&at_campaign=rss'), 'https://bbc.com/news/articles/cx2k4y8e1zno');
  assert.equal(canonicalUrl('https://www.dw.com/en/venezuela-machado-returns/a-74512345?maca=en-rss-en-world-4025-rdf'), 'https://dw.com/en/venezuela-machado-returns/a-74512345');
  assert.equal(canonicalUrl('https://www.aljazeera.com/news/2026/10/27/jordan-strikes-syria?traffic_source=rss'), 'https://aljazeera.com/news/2026/10/27/jordan-strikes-syria');
});
test('rejects non-http schemes', () => {
  assert.throws(() => canonicalUrl('javascript:alert(1)'));
  assert.throws(() => canonicalUrl('ftp://example.com/x'));
  assert.throws(() => canonicalUrl('not a url'));
});
test('hostOf', () => {
  assert.equal(hostOf('https://News.Sky.com/story/1'), 'news.sky.com');
  assert.equal(hostOf('nope'), null);
});
