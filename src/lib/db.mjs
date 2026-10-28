// mysql2/promise pools: app (news_app, read/write) and ro (news_ro, read-only). Opened lazily.
import mysql from 'mysql2/promise';
import { dbConfig } from './env.mjs';

let pools = {};

function make(kind) {
  const c = dbConfig();
  const cred = kind === 'app' ? c.app : c.ro;
  const opts = {
    host: c.host, port: c.port, database: c.database, user: cred.user, password: cred.password,
    timezone: 'Z', connectionLimit: 4, connectTimeout: 5000, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: false,
  };
  if (process.env.NEWSDB_SSL === '1') opts.ssl = { rejectUnauthorized: false };
  return mysql.createPool(opts);
}

export function appPool() { return (pools.app ??= make('app')); }
export function roPool() { return (pools.ro ??= make('ro')); }

export async function closePools() {
  const ps = Object.values(pools);
  pools = {};
  await Promise.allSettled(ps.map((p) => p.end()));
}
