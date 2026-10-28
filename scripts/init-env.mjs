#!/usr/bin/env node
// Creates <root>/.env from .env.example, replacing each `change_me` with a random secret.
// Never overwrites an existing .env.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (fs.existsSync(envPath)) {
  console.error('[init-env] .env already exists; leaving it unchanged');
  process.exit(0);
}
const example = fs.readFileSync(examplePath, 'utf8');
const out = example.replace(/change_me/g, () => crypto.randomBytes(18).toString('hex'));
fs.writeFileSync(envPath, out, { mode: 0o600 });
console.error('[init-env] wrote .env with random passwords');
