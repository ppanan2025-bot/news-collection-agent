import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkUrl } from '../src/lib/domainPolicy.mjs';
import { loadPolicy, loadFeeds, outletDomainsFromFeeds } from '../src/lib/config.mjs';
import { root } from '../src/lib/env.mjs';

const policy = loadPolicy(root);
const domains = outletDomainsFromFeeds(loadFeeds(path.join(root, 'config/feeds.json')));

test('allows outlet domains and returns the outlet key', () => {
  assert.deepEqual([checkUrl('https://www.bbc.co.uk/news/world-123', policy, domains).allowed, checkUrl('https://www.bbc.co.uk/news/world-123', policy, domains).outletKey], [true, 'bbc']);
  assert.equal(checkUrl('https://news.sky.com/story/abc-123', policy, domains).outletKey, 'skynews');
  assert.equal(checkUrl('https://abcnews.com/International/x', policy, domains).outletKey, 'abc');
  assert.equal(checkUrl('https://abcnews.go.com/International/wireStory/x', policy, domains).outletKey, 'abc');
});
const denied = ['https://bit.ly/x', 'https://foo.blogspot.com/post', 'http://127.0.0.1/', 'http://[::1]/', 'http://localhost/x',
  'http://printer.local/', 'http://db.internal/', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://bbc.co.uk/x', 'https://example.org/news',
  'https://bbc.co.uk.evil.com/news', 'https://evilbbc.co.uk/news', 'not a url', 'http://2130706433/'];
for (const u of denied) {
  test(`denies ${u}`, () => {
    const r = checkUrl(u, policy, domains);
    assert.equal(r.allowed, false);
    assert.ok(r.reason.length > 0);
  });
}
test('deny list beats allow list and reason mentions deny list', () => {
  const r = checkUrl('https://bit.ly/abc123', policy, { 'bit.ly': 'x' });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /deny list/);
});
test('allow_extra is honoured; array form of outlet domains works', () => {
  assert.equal(checkUrl('https://reuters.com/x', { ...policy, allow_extra: ['reuters.com'] }, {}).allowed, true);
  assert.equal(checkUrl('https://npr.org/x', policy, [{ domain: 'npr.org', outlet_key: 'npr' }]).outletKey, 'npr');
});
