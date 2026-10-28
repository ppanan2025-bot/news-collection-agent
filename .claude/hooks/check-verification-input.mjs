#!/usr/bin/env node
// PreToolUse: mcp__newsdb__mark_verified — enough corroborating ids and a real reason. No DB.
import { runHook, projectDir } from '../../src/lib/hookRunner.mjs';
import { decideVerificationInput } from '../../src/lib/hookDecisions.mjs';
import { loadVerification } from '../../src/lib/config.mjs';

await runHook('check-verification-input', ['mcp__newsdb__mark_verified'], async (input) =>
  decideVerificationInput(input.tool_input, loadVerification(projectDir())));
