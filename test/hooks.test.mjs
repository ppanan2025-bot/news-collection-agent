import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../src/lib/env.mjs';
import { decideCitation, decideBashCommand, decideVerificationInput, isReportPath, extractUrls, urlsToCheck, decideReportUrls } from '../src/lib/hookDecisions.mjs';

const fixture = (name) => fs.readFileSync(path.join(root, 'test/fixtures/hook-inputs', `${name}.json`), 'utf8');
function run(script, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(root, '.claude/hooks', `${script}.mjs`)], {
    input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env }, timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
function assertAllow(r) { assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout, ''); }
function assertDeny(r, re) {
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  if (re) assert.match(out.hookSpecificOutput.permissionDecisionReason, re);
}
// Fail-closed tests point the DB at an unreachable port.
const NO_DB = { NEWSDB_HOST: '127.0.0.1', NEWSDB_PORT: '1' };

test('validate-domain: allowed URL', () => assertAllow(run('validate-domain', fixture('validate-domain-allow'))));
test('validate-domain: bit.ly denied', () => assertDeny(run('validate-domain', fixture('validate-domain-bitly')), /bit\.ly is on the deny list/));
test('validate-domain: lookalike denied', () => assertDeny(run('validate-domain', fixture('validate-domain-lookalike')), /not on the allowlist/));
test('validate-domain: missing url denied', () => assertDeny(run('validate-domain', fixture('validate-domain-missing-url')), /requires a url/));
test('validate-domain: other tool ignored', () => assertAllow(run('validate-domain', fixture('validate-domain-other-tool'))));
test('validate-domain: malformed stdin -> exit 2', () => {
  const r = run('validate-domain', 'not json');
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
});

test('guard-bash-db: raw SQL UPDATE via docker exec denied', () => assertDeny(run('guard-bash-db', fixture('bash-sql-update')), /mark_verified/));
test('guard-bash-db: docker compose down -v denied', () => assertDeny(run('guard-bash-db', fixture('bash-down-v'))));
test('guard-bash-db: npm run collect allowed', () => assertAllow(run('guard-bash-db', fixture('bash-collect'))));
test('guard-bash-db: docker compose ps allowed', () => assertAllow(run('guard-bash-db', fixture('bash-ps'))));
test('guard-bash-db: decisions', () => {
  assert.equal(decideBashCommand('mysql -uroot newsdb -e "DELETE FROM articles"').decision, 'deny');
  assert.equal(decideBashCommand('docker exec abc mysql -e "drop table x"').decision, 'deny');
  assert.equal(decideBashCommand('docker compose down --volumes').decision, 'deny');
  assert.equal(decideBashCommand('docker volume rm news-collection-agent_newsdb_data').decision, 'deny');
  assert.equal(decideBashCommand('docker compose down').decision, 'allow');
  assert.equal(decideBashCommand('mysql -e "SELECT 1"').decision, 'allow');
  assert.equal(decideBashCommand('git commit -m "update readme"').decision, 'allow');
});

test('check-verification-input: corroborated with 1 id denied', () => assertDeny(run('check-verification-input', fixture('verify-corroborated-one-id')), /at least 2/));
test('check-verification-input: corroborated with 2 ids + reason allowed', () => assertAllow(run('check-verification-input', fixture('verify-corroborated-two-ids'))));
test('check-verification-input: rejected with empty reason denied', () => assertDeny(run('check-verification-input', fixture('verify-rejected-empty-reason')), /reason/));
test('check-verification-input: decisions', () => {
  const cfg = { min_independent_outlets: 2 };
  assert.equal(decideVerificationInput({ status: 'corroborated', corroborating_ids: [1, 2], reason: 'short' }, cfg).decision, 'deny');
  assert.equal(decideVerificationInput({ status: 'unverified', reason: '' }, cfg).decision, 'allow');
});

test('guard-report-write: outside reports allowed without DB', () => assertAllow(run('guard-report-write', fixture('report-write-outside'), NO_DB)));
test('guard-report-write: reports path, no URLs allowed', () => assertAllow(run('guard-report-write', fixture('report-write-no-urls'), NO_DB)));
test('guard-report-write: reports path, doi.org only allowed', () => assertAllow(run('guard-report-write', fixture('report-write-doi-only'), NO_DB)));
test('guard-report-write: reports path with news URL and DB down -> exit 2', () => {
  const r = run('guard-report-write', fixture('report-write-news-url'), NO_DB);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
});
test('guard-report-write: path logic', () => {
  assert.equal(isReportPath(path.join(root, 'reports/a.md'), root), true);
  assert.equal(isReportPath('reports/sub/a.md', root), true);
  assert.equal(isReportPath(path.join(root, 'reports/../src/x.mjs'), root), false);
  assert.equal(isReportPath(path.join(root, 'reports'), root), false);
  assert.equal(isReportPath('/tmp/reports/a.md', root), false);
});
test('guard-report-write: url decisions', () => {
  const urls = extractUrls('See https://www.bbc.co.uk/news/x?at_medium=RSS. and (https://doi.org/10.1/x) and https://evil.example/y');
  assert.equal(urls.length, 3);
  const checks = urlsToCheck(urls, ['doi.org']);
  assert.equal(checks.length, 2);
  const map = { [checks[0].hash]: 'corroborated' };
  const d = decideReportUrls(checks, map);
  assert.equal(d.decision, 'deny');
  assert.match(d.reason, /evil\.example/);
  assert.doesNotMatch(d.reason, /bbc/);
  assert.equal(decideReportUrls([checks[0]], map).decision, 'allow');
});

test('require-corroborated: decideCitation', () => {
  assert.equal(decideCitation([1, 2], { 1: 'corroborated', 2: 'corroborated' }).decision, 'allow');
  const mixed = decideCitation([1, 2, 3], { 1: 'corroborated', 2: 'unverified', 3: 'rejected' });
  assert.equal(mixed.decision, 'deny');
  assert.match(mixed.reason, /2:unverified, 3:rejected/);
  assert.match(mixed.reason, /verify-sources/);
  assert.match(decideCitation([1, 4], { 1: 'corroborated' }).reason, /4:missing/);
  assert.equal(decideCitation([], {}).decision, 'deny');
  assert.equal(decideCitation(['1'], {}).decision, 'deny');
});
test('require-corroborated: empty ids denied without DB', () => assertDeny(run('require-corroborated', fixture('cite-empty-ids'), NO_DB)));
test('require-corroborated: DB unreachable -> exit 2', () => {
  const r = run('require-corroborated', fixture('cite-valid-ids'), NO_DB);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
});
