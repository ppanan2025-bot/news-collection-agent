# Project Status: News Collection Agent for Research Report References

Root: `<project-root>` · Plan: `docs/PLAN.md` · PM tracker (this file)

## Phases

| # | Phase | Owner | Status |
|---|---|---|---|
| 1 | Plan | Planner | ✅ done (`docs/PLAN.md`, incl. §15 addendum) |
| 2 | PM review (checkpoint 1) | PM | ✅ done 2026-10-28 (corrections C1–C8 below) |
| 3 | Build | Deploy agent | ✅ done (`c6fdf3b`; round 2 `3d29794`) |
| 4 | Validation | Validator | ✅ done (rounds 1 and 2: ACCEPT WITH ISSUES) |
| 5 | Final report | PM | ✅ done 2026-10-28 (see Final report) |

## PM review: corrections the deploy agent must apply

| ID | Plan § | Correction |
|---|---|---|
| C1 | §12.12, §13 #26–28 | Running the `claude` CLI (`claude mcp list`, interactive session) can write `~/.claude.json`, which conflicts with #28. Agents must **not** run `claude`. Automated substitute for #26: `node scripts/mcp-smoke.mjs` against port 3307. #26 and #27 become **user-run manual checks**. #28 is checked with a hash+mtime snapshot of `~/.claude.json` and `~/.claude/settings*.json` taken before the build and after validation. |
| C2 | §5 wiring | `structuredContent` must be a JSON **object**. `list_outlets`, `search_articles` and `query_references` return arrays, so wrap them (`{outlets:[…]}`, `{articles:[…]}`, `{references:[…]}`) or omit `structuredContent` for those tools. Do not declare `outputSchema` unless results match it exactly. |
| C3 | §3, §5 `find_corroborations` | `MATCH(title)` needs a FULLTEXT index on exactly `(title)`. Only `(title, summary)` exists, so the query would fail. Either use `MATCH(title, summary)` or add `FULLTEXT KEY ft_title (title)`. Do not rely on FULLTEXT alone for the candidate set: window + group filter in SQL, then score in JS (`candidate_limit`). |
| C4 | §3, §5 `mark_verified`, §6 `verify.mjs` | Re-corroborating an article (unverified → corroborated again) hits `uq_pair`. Use `INSERT … ON DUPLICATE KEY UPDATE` (news_app has no DELETE). `repo.markVerified` must take an `actor` parameter (`claude` / `auto` / `cascade`). |
| C5 | §2 `package.json` | `node --test "test/**/*.test.mjs"` needs glob support (Node ≥ 21). Set `engines.node` to `>=22`, or use `node --test test/`. |
| C6 | §12.3 | `$MYSQL_ROOT_PASSWORD` is not in the host shell (it is in `.env`). Verify with `docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" newsdb -e "SHOW FULL TABLES; SHOW TRIGGERS"'`. |
| C7 | §7, §12.3, §14 | Project hooks fire only in Claude Code sessions rooted at the project. The build and validation agents run from `~`, so the hooks do not block them, and they may run the step-3 check and `npm run smoke` themselves. Also, the Bash hook only sees `npm run smoke`, not the `down -v` inside it, so the §7/§14 note that "the hook blocks the smoke" is wrong. Hook behaviour is verified via `hooks.test.mjs` and smoke step 7. |
| C8 | §7, §2 `env.mjs` | `require-corroborated` must use `pool.query` (not `execute`) so that `IN (?)` expands the array. `env.mjs` must not throw when `.env` is missing, because `npm test` must pass on a clean clone with no DB. `guard-report-write` compares `path.resolve`/`realpath` of `file_path` against `<CLAUDE_PROJECT_DIR>/reports/`. |
| F1 | §4 `rss`/`corroborate` (round 2 fix) | A byline naming AP, Associated Press, Reuters, AFP or Agence France-Presse marks an article as wire copy (`src/lib/wire.mjs`), and wire copy never counts as an independent corroborator. Live recheck (`verify --recheck-corroborated`) moved 4 of 16 corroborated articles (29, 42, 126, 140) back to unverified, leaving 12. ✅ applied in `3d29794`, validated in round 2. |

## Work items (from PLAN §12)

| # | Work item | Plan refs | Status |
|---|---|---|---|
| W1 | `git init` in the existing root (do not create the dir); `.gitignore`; `npm init -y`; edit `package.json` (scripts, `type: module`, engines per C5) | §2, §15 | ✅ done |
| W2 | `npm i @modelcontextprotocol/sdk@^1 mysql2@^3 rss-parser@^3 zod@^3.25` | §0 D6, §2 | ✅ done |
| W3 | `.env.example`, `scripts/init-env.mjs`, `docker-compose.yml`, `db/init/01-schema.sql` (+C3 index if chosen), `db/init/02-users.sh` (chmod +x); run init-env and `docker compose up -d --wait`; verify 8 tables / 1 view / 2 triggers (C6) | §2, §3 | ✅ done |
| W4 | `config/feeds.json`, `config/domain-policy.json`, `config/verification.json` (`min_independent_outlets: 2`) | §4, §6 | ✅ done |
| W5 | `src/lib` modules: env → config → canonicalize → text → similarity → corroborate → domainPolicy → sqlGuard → references → rss → db → repo → hookDecisions | §4, C4, C8 | ✅ done |
| W6 | RSS fixtures + unit tests; `npm test` green (tune fixtures, not thresholds) | §10, §11 | ✅ done |
| W7 | Scripts `seed`, `collect`, `verify`, `references`; live run: seed → collect `--limit-per-feed 20` → verify `--all-unverified` | §6 | ✅ done |
| W8 | `mcp-server/index.mjs` (10 tools) + `.mcp.json`; check with `scripts/mcp-smoke.mjs` on port 3307 | §5, C2, C3, C4 | ✅ done |
| W9 | 5 hook scripts + `.claude/settings.json`; hook tests; `npm test` | §7, C8 | ✅ done |
| W10 | 3 `SKILL.md` files, `CLAUDE.md`, `README.md` | §8, §9, §12.10 | ✅ done |
| W11 | `scripts/smoke.sh` + `scripts/mcp-smoke.mjs`; `npm run smoke` prints `SMOKE OK` | §11 | ✅ done |
| W12 | Final checks: `npm test`, `npm run smoke`, `.env` ignored, `~/.claude*` unchanged (C1); `claude mcp list` left to the user | §12.12, C1 | ✅ done |
| W13 | Skill-local scripts (`collect-news/scripts/collect.mjs`; read-only `verify-sources/scripts/pending.mjs`, `build-references/scripts/preview-references.mjs`) + wire-copy fix (validator issue a) + live recheck | Round 2 | ✅ done |

## Acceptance criteria (PLAN §13 + §15)

| # | Criterion (short) | Status |
|---|---|---|
| 1 | All §1 files present; `package.json` has `type: module` + required scripts | pass |
| 2 | `.gitignore` covers `.env` / `node_modules`; `.env` untracked, no `change_me`; `.env.example` has no secrets | pass |
| 3 | No passwords in `.mcp.json` or tracked files | pass |
| 4 | `docker compose up -d --wait` OK; bound to 127.0.0.1:3307 only; named volume `*_newsdb_data` | pass |
| 5 | 8 tables, view `v_reference_ready`, 2 triggers, UNIQUE `canonical_url_hash` | pass |
| 6 | `news_ro` SELECT only (INSERT fails); `news_app` has no DELETE/DROP | pass |
| 7 | `npm test` passes without DB; all 8 suites; every §10 SQL-guard rejection covered | pass |
| 8 | Live collect: `feeds_ok >= 6`; second run ~0 inserted, duplicates > 0 | pass |
| 9 | `published_at` / `content_hash` non-null; no tracking params in `canonical_url` | pass |
| 10 | `npm run smoke` prints `SMOKE OK` and removes the stack + volume | pass |
| 11 | Smoke: A corroborated; B, C, D unverified; bit.ly item not inserted | pass |
| 12 | MCP lists exactly the 10 tools; none accepts arbitrary write SQL | pass |
| 13 | `run_readonly_sql` rejects DELETE / UPDATE / multi-statement / `/*! */` / INTO OUTFILE; accepts SELECT, WITH…SELECT | pass |
| 14 | `mark_verified` corroborated enforced server-side; every success writes `verification_events` | pass |
| 15 | Reject cascade downgrades dependent articles (test, smoke step or manual check) | pass |
| 16 | `cite_articles` / `query_references` corroborated-only; DB trigger blocks direct INSERT | pass |
| 17 | `settings.json`: `enabledMcpjsonServers`, 5 PreToolUse matchers, exact commands | pass |
| 18 | Hook I/O contract (deny JSON + exit 0; allow → empty stdout, exit 0; error → exit 2) | pass |
| 19 | `require-corroborated` live: denies unverified, allows corroborated | pass |
| 20 | `guard-report-write` denies unverified URL in `reports/`; skips the DB for other paths | pass |
| 21 | `validate-domain` denies bit.ly / IP / localhost / unknown / lookalike; allows outlet domains | pass |
| 22 | `guard-bash-db` denies raw SQL writes and `down -v` | pass |
| 23 | 3 skills with valid frontmatter; `build-references` forbids unverified fallback | pass |
| 24 | `CLAUDE.md` content (golden rules, workflow, policy incl. D1 meaning, tools, hooks, commands) | pass |
| 25 | Config: 6–10 outlets with `ownership_group`; allow/deny lists; thresholds only in config | pass |
| 26 | `claude mcp list` shows `newsdb` connected (**user-run**, per C1; automated proxy: mcp-smoke on 3307) | user |
| 27 | Interactive `/collect-news` → `/verify-sources` → `/build-references` produces a corroborated-only references file (**user-run**, per C1) | user |
| 28 | Nothing in `~/.claude/` or `~/.claude.json` created or modified (snapshot comparison, C1) | pass |
| 29 | Clean clone: `npm install && npm run setup` gives a working DB + MCP server | pass |
| 30 | Nothing created at `~/news-collection-agent` (§15) | pass |

## Decisions log

| ID | Decision | Status |
|---|---|---|
| D1 | `min_independent_outlets = 2` (default): an article is corroborated only with matches from ≥2 independent outlets other than its own, so the story appears in ≥3 outlets in total. Configurable in `config/verification.json`; 1 gives the looser "2 outlets in total" reading. | **Decided by PM 2026-10-28** |
| D2 | Independence = different `ownership_group` (fallback `outlet_key`); wire/syndicated copies never count | Accepted |
| D3 | Layered protection: domain checks in lib + MCP + hook; corroboration checks in 2 hooks + MCP + DB trigger | Accepted |
| D4 | Deterministic rule gates corroboration; Claude can only tighten, never override | Accepted |
| D5 | No Python; plain ESM JavaScript | Accepted |
| D6 | `@modelcontextprotocol/sdk@^1`, `zod@^3.25`, `McpServer.registerTool`, stdio, logs to stderr only (+C2) | Accepted |
| D7 | `mysql:8.4`, `caching_sha2_password`; fallback `ssl:{rejectUnauthorized:false}` | Accepted |
| D8 | Path change: root is `<project-root>` (§15); relative `.mcp.json` args; absolute paths in shell calls | Accepted |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Running the `claude` CLI modifies `~/.claude.json` (breaks #28) | C1: agents never run `claude`; snapshot hash/mtime before and after |
| R2 | D1 = 2 leaves many live stories unverified | Intended; documented in `CLAUDE.md`/README; configurable |
| R3 | Fixture similarity near the thresholds | Tune fixture wording, never thresholds |
| R4 | mysql2 + `caching_sha2_password` login failure | D7 TLS fallback in `db.mjs` |
| R5 | Live feed URLs change or fail | Collector tolerates per-feed failures; threshold `feeds_ok >= 6` |
| R6 | `~/Documents` iCloud sync: slow or evicted `node_modules`; Docker file-sharing for the `./db/init` bind mount | Named volume for data; grant Docker Desktop access to `~/Documents` if the mount fails |
| R7 | MCP output-shape and FULLTEXT index errors only surface at runtime | C2, C3; exercised by `mcp-smoke.mjs` and smoke |
| R8 | Port 3307/3308 conflicts | Checked free at plan time; smoke uses a separate project and port |

## Final report

**Outcome:** delivered. **Final verdict: ACCEPT WITH ISSUES.** No acceptance criterion fails, and every remaining issue is low severity.

**Delivered scope (commits `c6fdf3b` and `3d29794`):**
- MySQL 8.4 in Docker on 127.0.0.1:3307. It has 8 tables, the view `v_reference_ready` and 2 triggers. `news_app` and `news_ro` have least-privilege grants.
- MCP server `newsdb` with 10 tools, including server-side corroboration enforcement and read-only SQL guarded by `sqlGuard` plus the `news_ro` user.
- Collector, verifier and reference builder, fed by 10 live RSS outlets that each have an ownership group.
- 5 PreToolUse hooks and project-scoped `.claude/settings.json`.
- 3 skills, each with skill-local scripts (W13).
- `CLAUDE.md` and `README.md`.
- Tests and checks:
  - `npm test` passes 135/135 with no DB.
  - `npm run smoke` prints SMOKE OK.
  - `mcp-smoke` passes.
  - Setup from a fresh clone works.
- Global config (`~/.claude`, `~/.claude.json`) is unchanged, and nothing was created at `~/news-collection-agent`.
- D1 is in force: an article needs at least 2 independent, non-wire outlets besides its own. Live data has 12 corroborated articles and 12 references.

**Acceptance results:** 28 of 30 pass and 0 fail. #26 and #27 are user-run (see C1).

**Open issues:**

| # | Severity | Issue | Recommended next step |
|---|---|---|---|
| O1 | Low | Stale `report_citations` rows remain for 4 downgraded articles (29, 42, 126, 140) in report `live-world-smoke`. No tool, hook or view reads them. | Add a `revoked_at` column set on downgrade or cascade, and filter on it. Alternatively, grant a narrow DELETE on `report_citations` to a maintenance path only. |
| O2 | Low | The `.claude/settings.json` allow list does not include the 3 skill-local scripts, so running them directly prompts for permission. Each skill's `allowed-tools` covers them while that skill runs. | The user can optionally add the `Bash(node .claude/skills/...)` entries by hand. Agents may not modify their own permissions. |
| O3 | Low | zod 3.25.76 audit advisory GHSA-mrhx-c7xc-m3w5. Input reaches it only over local stdio. | Upgrade to zod 4 together with a compatible `@modelcontextprotocol/sdk` 1.x, then rerun the tests and both smokes. |
| O4 | Low (known limit) | AP, Reuters or AFP copy with no byline, no "(AP) —" dateline and no `/wireStory/` URL is not detected as wire copy. | Add heuristics such as a near-duplicate summary against known wire items or agency phrases in the body. Until then, keep the human same-event review in `/verify-sources`. |

**Steps the user must run:**
1. #26: from the project root, run `claude mcp list` and confirm `newsdb` is connected (approve the project server if prompted).
2. #27: in an interactive session at the project root, run `/collect-news <topic>`, then `/verify-sources <topic>`, then `/build-references <slug> <topic>`. Confirm that `reports/<slug>-references.md` cites only corroborated articles.

## Changelog

- **2026-10-28**: Plan delivered (`docs/PLAN.md`, §15 path addendum). PM checkpoint 1: review done, corrections C1–C8 recorded, D1 decided (`min_independent_outlets = 2`, configurable), tracker created. Next: Build (W1–W12).
- **2026-10-28** (deploy agent): Build W1–W12 complete with C1–C8 applied. MySQL 8.4 up on 127.0.0.1:3307 (8 tables, view `v_reference_ready`, 2 triggers). `npm test`: 119/119 pass (no DB, also on a clean copy without `.env`). `npm run smoke`: SMOKE OK (A corroborated, B/C/D unverified, bit.ly rejected, hooks + trigger + MCP + reject cascade checked; news-smoke stack and volume removed). `scripts/mcp-smoke.mjs` on 3307: MCP SMOKE OK (10 tools). Live: 10/10 feeds OK, 168 items, second run 2 inserted / 166 duplicates; `verify --all-unverified --auto` corroborated 16 of 170; 16 APA references written to `reports/live-world-smoke-references.md`. Deviations: feed fetch uses global `fetch` + `parseString` (rss-parser `parseURL` hung the process); `file:` relative fixture URLs; `hookRunner.mjs` and `scripts/_args.mjs` helpers added; citation trigger treats a missing article as not corroborated; smoke adds guard-report-write, news_ro INSERT and cascade steps. `claude mcp list` / interactive session (#26, #27) left to the user per C1.
- **2026-10-28** (validator): Independently re-ran #1–30: 28 pass, #26/#27 user-run (mcp-smoke on 3307: MCP SMOKE OK). npm test 119/119 on a clean clone with no DB; smoke SMOKE OK (stack+volume removed); live collect 10/10 feeds, rerun 1 inserted/168 dupes; clean-clone setup on port 3309 + MCP OK; ~/.claude settings hash and global skills/hooks unchanged, no mcpServers added. Known issues (non-blocking): AP copy on NPR (id 42, author "The Associated Press", not flagged wire) corroborated with ABC AP wireStory 156 as one of its 2 groups; zod 3.25.76 high-severity audit advisory (GHSA-mrhx-c7xc-m3w5), low practical risk over local stdio. Verdict: ACCEPT WITH ISSUES.
- **2026-10-28** (deploy agent, round 2): W13 done. Collector logic moved to `src/lib/collector.mjs`; `.claude/skills/collect-news/scripts/collect.mjs` is the entry point and `scripts/collect.mjs` delegates to it. Added read-only helpers `verify-sources/scripts/pending.mjs` and `build-references/scripts/preview-references.mjs`; both use `news_ro` and record nothing. SKILL.md files and `allowed-tools` now name exactly one skill-local `node` command each. `.claude/settings.json` is unchanged: adding matching permission entries was blocked as self-modification. Wire fix: a byline naming AP/Associated Press/Reuters/AFP/Agence France-Presse now marks wire copy (`src/lib/wire.mjs`), and a wire-copy candidate never counts as independent (`evaluate`). Corroboration rows for wire corroborators are recorded as `syndicated`. Added `verify --recheck-corroborated`. Live: articles 23, 42, 44 and 45 were re-flagged as wire copy; 4 of 16 corroborated articles (29, 42, 126, 140) went back to unverified with `recheck:` events (actor auto). That leaves 12 corroborated and 12 rows in `v_reference_ready`, and `reports/live-world-smoke-references.md` was regenerated with 12 references. The old `report_citations` rows for the 4 downgraded articles in report `live-world-smoke` remain, because `news_app` has no DELETE. `npm test`: 135/135. `npm run smoke`: SMOKE OK, now including a step that checks the read-only helpers.
- **2026-10-28** (validator, round 2): Re-checked `3d29794`. npm test 135/135, smoke SMOKE OK, mcp-smoke on 3307 OK; #1/#7/#17/#18/#22/#23/#28/#30 re-confirmed, #29 fresh clone on port 3309 (project newsval-r2, torn down) setup + 135 tests + MCP OK. W13: 3 skill scripts present, collect wrapper is a 1-line delegate to `src/lib/collector.mjs`, helpers connect as `news_ro` (SELECT-only grant, no write calls), all run from project root, `npm run collect` OK (5 inserted), guard-bash-db allows the 3 new commands. Wire fix: 42 is unverified/is_wire_copy=1 and absent from the references file; 0 `v_reference_ready` rows rely on a wire-copy corroborator; every corroborated article has >=2 non-wire groups. Issues (low): 4 stale `report_citations` rows (29, 42, 126, 140) are written but never read by any tool/hook/view, so nothing treats them as valid citations; suggested fix is a `revoked_at` column (or a cascade-time flag) set on downgrade. `.claude/settings.json` allow list lacks the skill scripts; skills' `allowed-tools` cover them while a skill runs, so this only means a prompt on direct use. Verdict: ACCEPT WITH ISSUES.
- **2026-10-28** (PM, checkpoint 2): Confirmed commits `c6fdf3b` and `3d29794`. Set Build, Validation and Final report to done, added F1 and wrote the Final report. Verdict: ACCEPT WITH ISSUES (28 pass, 0 fail, #26/#27 user-run). Open issues O1–O4 are all low. Project closed pending the user-run checks.
