#!/usr/bin/env node
// Upserts outlets, outlet_domains and feeds from config/feeds.json (or --feeds <path>).
import { parseArgs } from '../src/lib/cli.mjs';
import { loadFeeds } from '../src/lib/config.mjs';
import { appPool, closePools } from '../src/lib/db.mjs';
import { seedOutlets } from '../src/lib/repo.mjs';

const args = parseArgs();
try {
  const cfg = loadFeeds(args.feeds);
  const r = await seedOutlets(appPool(), cfg);
  console.log(JSON.stringify({ seeded: r }));
} catch (e) {
  console.error(`[seed] ${e.message}`);
  process.exitCode = 1;
} finally { await closePools(); }
