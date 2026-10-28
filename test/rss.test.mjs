import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../src/lib/env.mjs';
import { parseString, normalizeItem, matchesTopic, fetchFeed } from '../src/lib/rss.mjs';

const xml = (f) => fs.readFileSync(path.join(root, 'test/fixtures/rss', f), 'utf8');
const now = new Date('2026-10-21T00:00:00Z');

test('parseString + normalizeItem gives expected fields; HTML stripped; tracking removed', async () => {
  const feed = await parseString(xml('bbc.xml'));
  const a = normalizeItem(feed.items[0], { topic: 'world' }, { key: 'bbc' }, now);
  assert.equal(a.title, 'Iceland volcano erupts near Grindavik, forcing evacuation');
  assert.equal(a.canonical_url, 'https://bbc.co.uk/news/articles/c1volcano');
  assert.match(a.canonical_url_hash, /^[0-9a-f]{64}$/);
  assert.ok(!/[<>]/.test(a.summary));
  assert.match(a.summary, /Reykjanes peninsula/);
  assert.equal(a.published_at.toISOString(), '2026-10-20T06:10:00.000Z');
  assert.match(a.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(a.is_wire_copy, false);
  assert.equal(a.topic, 'world');
  assert.equal(a.outlet_key, 'bbc');
});
test('author from dc:creator', async () => {
  const feed = await parseString(xml('guardian.xml'));
  assert.equal(normalizeItem(feed.items[0], {}, {}, now).author, 'Test Reporter');
});
test('published_at falls back to fetch time; future dates clamped', async () => {
  const feed = await parseString(xml('cbs.xml'));
  const noDate = feed.items.find((i) => /Lunar/.test(i.title));
  assert.equal(normalizeItem(noDate, {}, {}, now).published_at.toISOString(), now.toISOString());
  const future = normalizeItem({ title: 't', link: 'https://x.com/a', pubDate: 'Mon, 01 Jan 2035 00:00:00 GMT' }, {}, {}, now);
  assert.equal(future.published_at.toISOString(), now.toISOString());
});
test('is_wire_copy detected (wireStory URL and AP dateline)', async () => {
  const abc = normalizeItem((await parseString(xml('abc.xml'))).items[0], {}, {}, now);
  const cbs = normalizeItem((await parseString(xml('cbs.xml'))).items[0], {}, {}, now);
  assert.equal(abc.is_wire_copy, true);
  assert.equal(cbs.is_wire_copy, true);
});
test('guid used when link missing; null when neither', () => {
  assert.equal(normalizeItem({ title: 't', guid: 'https://npr.org/x' }, {}, {}, now).url, 'https://npr.org/x');
  assert.equal(normalizeItem({ title: 't', guid: 'abc' }, {}, {}, now), null);
});
test('matchesTopic all / any', () => {
  const item = { title: 'Iceland volcano erupts near Grindavik', summary: 'Residents evacuated' };
  assert.equal(matchesTopic(item, 'iceland eruption'), true);
  assert.equal(matchesTopic(item, 'iceland earthquake'), false);
  assert.equal(matchesTopic(item, 'iceland earthquake', 'any'), true);
  assert.equal(matchesTopic(item, ''), true);
});
test('fetchFeed reads relative file: URLs', async () => {
  const f = await fetchFeed('file:test/fixtures/rss/npr.xml');
  assert.equal(f.items.length, 1);
});
