#!/usr/bin/env node
// PreToolUse: Bash — no raw SQL writes via mysql/docker exec, no volume wipes. No DB.
import { runHook } from '../../src/lib/hookRunner.mjs';
import { decideBashCommand } from '../../src/lib/hookDecisions.mjs';

await runHook('guard-bash-db', ['Bash'], async (input) => decideBashCommand(input.tool_input?.command));
