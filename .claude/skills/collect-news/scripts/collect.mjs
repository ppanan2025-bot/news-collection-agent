#!/usr/bin/env node
// Skill-local entry point for /collect-news. All logic lives in src/lib/collector.mjs.
// Run from the project root: node .claude/skills/collect-news/scripts/collect.mjs --topic "<terms>" [--since 48h] [--match any]
import { main } from '../../../../src/lib/collector.mjs';

await main();
