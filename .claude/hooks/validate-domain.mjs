#!/usr/bin/env node
// PreToolUse: mcp__newsdb__insert_article — URL must be on an outlet domain and not denied. No DB.
import { runHook, projectDir } from '../../src/lib/hookRunner.mjs';
import { decideDomain } from '../../src/lib/hookDecisions.mjs';
import { loadPolicy, loadFeeds, outletDomainsFromFeeds } from '../../src/lib/config.mjs';
import path from 'node:path';

await runHook('validate-domain', ['mcp__newsdb__insert_article'], async (input) => {
  const dir = projectDir();
  const policy = loadPolicy(dir);
  const feeds = loadFeeds(path.join(dir, 'config', 'feeds.json'));
  return decideDomain(input.tool_input, policy, outletDomainsFromFeeds(feeds));
});
