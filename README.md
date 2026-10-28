# News Collection Agent

Collects news from reputable RSS feeds into MySQL, cross-verifies each article against independent outlets, and builds
reference lists for research reports from **corroborated articles only**. Runs as a Claude Code project: an MCP server
(`newsdb`), three skills and five PreToolUse hooks, all project-scoped.

## Prerequisites
- Docker (Compose v2) — MySQL 8.4 runs in a container bound to `127.0.0.1:3307`
- Node.js ≥ 22 (the test glob needs Node ≥ 21; developed on Node 26)
- Claude Code (for the interactive workflow)

## Setup
```bash
cd <project-root>
npm install
npm run setup        # creates .env with random passwords, starts MySQL, seeds outlets/feeds
```
`.env` is git-ignored and never needs to be read by Claude. `.mcp.json` contains no secrets; the server reads `.env` itself.

## Using it with Claude Code
1. Launch `claude` **from the project root** (the relative MCP server path depends on it).
2. Approve the project MCP server `newsdb` when prompted (it is listed in `enabledMcpjsonServers`).
3. Check: `claude mcp list` should show `newsdb` connected. If it fails, change `args` in `.mcp.json` to
   `<project-root>/mcp-server/index.mjs`.
4. Example session:
   ```
   /collect-news brazil election lula
   /verify-sources brazil election
   /build-references brazil-election-2026 brazil election apa
   ```
   This writes `reports/brazil-election-2026-references.md`.

## CLI
```bash
npm run collect -- --topic "iceland volcano" --since 48h      # JSON summary on stdout
npm run collect -- --limit-per-feed 20                        # all items, no topic filter
npm run verify -- --all-unverified                            # report only
npm run verify -- --all-unverified --auto                     # mark corroborated when the rule is met (never rejects)
npm run verify -- --recheck-corroborated                      # re-flag wire copy, downgrade articles that no longer meet the rule
node .claude/skills/verify-sources/scripts/pending.mjs --topic brazil          # read-only: unverified + candidates (JSON)
node .claude/skills/build-references/scripts/preview-references.mjs --topic world --style apa   # read-only preview
npm run refs -- --report my-report --topic world --style apa --out reports/my-report-references.md
```

## Verification rule
An article is `corroborated` only when matching articles exist from at least **2 independent outlets other than its own**
(`min_independent_outlets` in `config/verification.json`; set it to 1 for "2 outlets in total"). Independent = different
ownership group; wire/syndicated copies never count (including any article whose byline names AP, Reuters or AFP). With live feeds many stories stay `unverified` — that is intended.

## Tests
```bash
npm test         # unit tests (node:test), no database needed
npm run smoke    # end-to-end on a throwaway stack (project news-smoke, port 3308); prints SMOKE OK and removes it
node scripts/mcp-smoke.mjs   # MCP stdio smoke against the main DB (port 3307)
```

## Security model (layered)
- **Domain allowlist** enforced in the shared library (collector), the MCP server, and the `validate-domain` hook.
- **Corroborated-only citations** enforced by the `require-corroborated` hook, the `guard-report-write` hook, the MCP
  server (`cite_articles`, `query_references` reads only the `v_reference_ready` view) and a MySQL trigger on `report_citations`.
- **Corroboration** is recomputed server-side in `mark_verified`; a DB trigger rejects same-ownership corroborations.
- **DB users:** `news_app` has SELECT/INSERT/UPDATE only (no DELETE/DDL); `news_ro` is SELECT-only and is used for
  `run_readonly_sql` (SQL guard + read-only transaction + 5 s timeout) and the hooks.
- `guard-bash-db` blocks raw SQL writes and volume wipes from Claude's Bash tool. Hooks fail closed (exit 2) on errors.

## Reset
```bash
docker compose down -v && rm .env && npm run setup    # wipes all collected data
```
