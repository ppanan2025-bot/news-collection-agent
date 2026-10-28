import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../src/lib/env.mjs';
import { parseArgs, parseSince } from '../src/lib/cli.mjs';
import { collectOptions } from '../src/lib/collector.mjs';
import { summarizePending, buildPreview } from '../src/lib/skillHelpers.mjs';
import { decideBashCommand } from '../src/lib/hookDecisions.mjs';

const skillScript = (skill, file) => path.join(root, '.claude/skills', skill, 'scripts', file);
const src = (p) => fs.readFileSync(p, 'utf8');

test('skill scripts exist', () => {
  for (const [s, f] of [['collect-news', 'collect.mjs'], ['verify-sources', 'pending.mjs'], ['build-references', 'preview-references.mjs']])
    assert.ok(fs.existsSync(skillScript(s, f)), `${s}/${f}`);
});
test('collect: npm script and skill script share one implementation', () => {
  assert.match(src(path.join(root, 'scripts/collect.mjs')), /\.claude\/skills\/collect-news\/scripts\/collect\.mjs/);
  assert.match(src(skillScript('collect-news', 'collect.mjs')), /src\/lib\/collector\.mjs/);
});
test('read-only helpers use news_ro only and never call state-changing functions', () => {
  for (const f of [skillScript('verify-sources', 'pending.mjs'), skillScript('build-references', 'preview-references.mjs')]) {
    const s = src(f);
    assert.match(s, /roPool/);
    for (const banned of ['appPool', 'markVerified', 'citeArticles', 'insertArticle', 'autoVerify', 'writeFile', 'seedOutlets'])
      assert.ok(!s.includes(banned), `${path.basename(f)} must not use ${banned}`);
  }
});
test('SKILL.md allowed-tools reference the skill-local scripts narrowly', () => {
  const fm = (s) => /^allowed-tools: (.*)$/m.exec(src(path.join(root, '.claude/skills', s, 'SKILL.md')))[1];
  assert.match(fm('collect-news'), /^Bash\(node \.claude\/skills\/collect-news\/scripts\/collect\.mjs:\*\), /);
  assert.ok(!/npm run collect/.test(fm('collect-news')));
  assert.match(fm('verify-sources'), /Bash\(node \.claude\/skills\/verify-sources\/scripts\/pending\.mjs:\*\)/);
  assert.match(fm('build-references'), /Bash\(node \.claude\/skills\/build-references\/scripts\/preview-references\.mjs:\*\)/);
  for (const s of ['collect-news', 'verify-sources', 'build-references']) assert.equal((fm(s).match(/Bash\(/g) || []).length, 1, s);
});
test('Bash guard allows the skill script commands', () => {
  for (const c of ['node .claude/skills/collect-news/scripts/collect.mjs --topic "update on delete of drop"',
    'node .claude/skills/verify-sources/scripts/pending.mjs --topic brazil --limit 50',
    'node .claude/skills/build-references/scripts/preview-references.mjs --topic world --style apa'])
    assert.equal(decideBashCommand(c).decision, 'allow', c);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--topic', 'iceland volcano', '--limit-per-feed=5', '--dry-run', 'x'], ['dryRun']),
    { _: ['x'], topic: 'iceland volcano', limitPerFeed: '5', dryRun: true });
});
test('parseSince', () => {
  const now = Date.parse('2026-10-28T00:00:00Z');
  assert.equal(parseSince('48h', now).toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(parseSince('2d', now).toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(parseSince('2026-10-01T00:00:00Z').toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(parseSince(undefined), null);
  assert.throws(() => parseSince('yesterday'));
});
test('collectOptions', () => {
  const o = collectOptions(['--topic', ' brazil ', '--match', 'any', '--limit-per-feed', '20', '--dry-run']);
  assert.deepEqual({ ...o, since: o.since }, { topic: 'brazil', mode: 'any', feeds: undefined, limit: 20, since: null, dryRun: true });
  assert.equal(collectOptions([]).limit, 50);
  assert.equal(collectOptions([]).mode, 'all');
  assert.throws(() => collectOptions(['--limit-per-feed', '0']));
});

const fc = (id, meets, cands) => ({ article: { id, title: `t${id}`, outlet_key: 'bbc', published_at: '2026-10-27T00:00:00Z', is_wire_copy: false },
  meets_rule: meets, independent_groups: meets ? ['g1', 'g2'] : [], candidates: cands });
test('summarizePending: shape, only matches, meets_rule first', () => {
  const out = summarizePending([
    fc(5, false, [{ id: 9, outlet_key: 'npr', title: 'x', score: 0.2, syndicated: false, wire_copy: false, matches: false }]),
    fc(3, true, [{ id: 7, outlet_key: 'abc', title: 'y', score: 0.5, syndicated: false, wire_copy: true, matches: true }]),
  ]);
  assert.deepEqual(out.map((a) => a.id), [3, 5]);
  assert.deepEqual(out[0].matches, [{ id: 7, outlet_key: 'abc', title: 'y', score: 0.5, syndicated: false, wire_copy: true }]);
  assert.deepEqual(out[1].matches, []);
});
test('buildPreview: formats, records nothing, drops rows without corroborators', () => {
  const rows = [
    { id: 2, title: 'Later', outlet: 'NPR', canonical_url: 'https://npr.org/b', published_at: '2026-10-21T00:00:00Z', independent_corroborators: 2 },
    { id: 1, title: 'Earlier', outlet: 'BBC News', canonical_url: 'https://bbc.co.uk/a', published_at: '2026-10-20T00:00:00Z', independent_corroborators: 2 },
    { id: 3, title: 'Bad', outlet: 'X', canonical_url: 'https://x/a', published_at: '2026-10-20T00:00:00Z', independent_corroborators: 0 },
  ];
  const p = buildPreview(rows, { 1: ['NPR', 'The Guardian'], 2: ['BBC News', 'CBS News'] }, 'markdown', new Date('2026-10-28T00:00:00Z'));
  assert.equal(p.recorded, false);
  assert.equal(p.count, 2);
  assert.deepEqual(p.references.map((r) => r.article_id), [1, 2]);
  assert.equal(p.formatted.split('\n')[0], '[1] BBC News — "Earlier" (2026-10-20). <https://bbc.co.uk/a> Corroborated by: NPR, The Guardian.');
});
