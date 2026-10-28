// Shared I/O wrapper for PreToolUse hook scripts.
// allow -> exit 0, no stdout; deny -> deny JSON on stdout, exit 0; error/malformed -> stderr, exit 2 (fail closed).
import { parseHookInput, isPreToolUse, denyOutput } from './hookDecisions.mjs';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param name     hook name (for messages)
 * @param tools    tool names (string[]) or predicate this hook applies to
 * @param decide   async (input) => {decision, reason}
 */
export async function runHook(name, tools, decide) {
  let code = 0;
  try {
    const input = parseHookInput(await readStdin());
    const applies = typeof tools === 'function' ? tools(input.tool_name) : tools.includes(input.tool_name);
    if (isPreToolUse(input) && applies) {
      const d = await decide(input);
      if (d?.decision === 'deny') process.stdout.write(denyOutput(`[${name}] ${d.reason}`) + '\n');
      else if (d?.decision !== 'allow') throw new Error('hook produced no decision');
    }
  } catch (e) {
    process.stderr.write(`[${name}] blocked (fail closed): ${e?.message || e}\n`);
    code = 2;
  }
  try { const { closePools } = await import('./db.mjs'); await closePools(); } catch { /* ignore */ }
  process.exit(code);
}

export const projectDir = () => process.env.CLAUDE_PROJECT_DIR || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
