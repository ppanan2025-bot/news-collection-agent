// Shared CLI helpers for scripts/ and .claude/skills/*/scripts/.
// Tiny argv parser: --flag value | --flag=value | --bool
export function parseArgs(argv = process.argv.slice(2), booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq > 0) out[key] = a.slice(eq + 1);
    else if (booleans.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

/** "48h" | "2d" | ISO -> Date (null when absent). */
export function parseSince(s, now = Date.now()) {
  if (!s || s === true) return null;
  const m = /^(\d+)\s*([hd])$/i.exec(String(s));
  if (m) return new Date(now - Number(m[1]) * (m[2].toLowerCase() === 'd' ? 86400000 : 3600000));
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`bad --since ${s}`);
  return d;
}
