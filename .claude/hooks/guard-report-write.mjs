#!/usr/bin/env node
// PreToolUse: Write|Edit|MultiEdit — files under reports/ may only contain URLs of corroborated articles.
import { runHook, projectDir } from '../../src/lib/hookRunner.mjs';
import { isReportPath, textsFromToolInput, extractUrls, urlsToCheck, decideReportUrls, allow } from '../../src/lib/hookDecisions.mjs';
import { loadPolicy } from '../../src/lib/config.mjs';

await runHook('guard-report-write', ['Write', 'Edit', 'MultiEdit'], async (input) => {
  const dir = projectDir();
  if (!isReportPath(input.tool_input?.file_path, dir)) return allow(); // never touches the DB
  const policy = loadPolicy(dir);
  const urls = extractUrls(textsFromToolInput(input.tool_name, input.tool_input).join('\n'));
  const checks = urlsToCheck(urls, policy.report_url_exempt);
  if (!checks.length) return allow();
  const hashes = [...new Set(checks.map((c) => c.hash).filter(Boolean))];
  let map = {};
  if (hashes.length) {
    const { roPool } = await import('../../src/lib/db.mjs');
    const [rows] = await roPool().query('SELECT canonical_url_hash h, verification_status FROM articles WHERE canonical_url_hash IN (?)', [hashes]);
    map = Object.fromEntries(rows.map((r) => [r.h, r.verification_status]));
  }
  return decideReportUrls(checks, map);
});
