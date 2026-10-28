// Loads <root>/.env without overriding variables already present in process.env.
// Never throws when .env is missing (npm test must work on a clean clone).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadDotEnv(file = path.join(root, '.env')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  for (const [k, v] of Object.entries(parseEnv(text))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return true;
}

loadDotEnv();

export function dbConfig() {
  const e = process.env;
  return {
    host: e.NEWSDB_HOST || '127.0.0.1',
    port: Number(e.NEWSDB_PORT || 3307),
    database: e.NEWSDB_DATABASE || 'newsdb',
    app: { user: e.NEWSDB_APP_USER || 'news_app', password: e.NEWSDB_APP_PASSWORD || '' },
    ro: { user: e.NEWSDB_RO_USER || 'news_ro', password: e.NEWSDB_RO_PASSWORD || '' },
  };
}

export const config = { root, get db() { return dbConfig(); } };
export default config;
