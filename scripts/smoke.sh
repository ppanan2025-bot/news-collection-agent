#!/usr/bin/env bash
# End-to-end smoke test against a throwaway MySQL stack (project news-smoke, port 3308) using RSS fixtures.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export NEWSDB_PORT=3308
export COMPOSE_PROJECT_NAME=news-smoke
export CLAUDE_PROJECT_DIR="$ROOT"
FEEDS="test/fixtures/feeds.fixture.json"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/news-smoke.XXXXXX")"

cleanup() {
  echo "[smoke] tearing down news-smoke stack and volume" >&2
  docker compose -p news-smoke down -v >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

step() { echo "[smoke] $*" >&2; }

step "1. init env"
node scripts/init-env.mjs

step "2. docker compose up (port 3308)"
docker compose -p news-smoke up -d --wait >&2

step "3. seed from fixtures"
node scripts/seed.mjs --feeds "$FEEDS" >&2

step "4. collect from fixtures"
node scripts/collect.mjs --feeds "$FEEDS" > "$TMP/collect.json"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.error(JSON.stringify({ feeds_ok: s.feeds_ok, inserted: s.inserted, duplicates: s.duplicates, rejected_by_policy: s.rejected_by_policy.length }));
if (s.rejected_by_policy.length !== 1 || !/bit\.ly/.test(s.rejected_by_policy[0].url)) throw new Error("expected exactly 1 policy rejection (bit.ly)");
if (!(s.duplicates >= 1)) throw new Error("expected >= 1 duplicate");
if (!(s.inserted >= 8)) throw new Error("expected >= 8 inserted");
' "$TMP/collect.json"

step "5. verify --all-unverified --auto"
node scripts/verify.mjs --all-unverified --auto > "$TMP/verify.json"
node --input-type=module -e '
import fs from "node:fs";
import { roPool, closePools } from "./src/lib/db.mjs";
const [rows] = await roPool().query("SELECT a.id, a.title, a.canonical_url, a.verification_status s, o.outlet_key FROM articles a JOIN outlets o ON o.id=a.outlet_id ORDER BY a.id");
await closePools();
const pick = (re, ok) => rows.filter((r) => re.test(r.title) && (!ok || ok === r.outlet_key));
const A = pick(/Grindavik/), B = pick(/Sudan/), C = pick(/earthquake strikes northern Chile/), D = pick(/inflation|coral|Lunar/);
const bad = [];
if (A.length !== 3 || A.some((r) => r.s !== "corroborated")) bad.push("A not all corroborated: " + JSON.stringify(A.map((r) => [r.id, r.s])));
for (const [n, g, cnt] of [["B", B, 1], ["C", C, 2], ["D", D, 3]]) if (g.length !== cnt || g.some((r) => r.s !== "unverified")) bad.push(n + " wrong: " + JSON.stringify(g.map((r) => [r.id, r.s])));
if (rows.some((r) => /bit\.ly/.test(r.canonical_url))) bad.push("bit.ly item was inserted");
if (rows.some((r) => /utm_|at_medium|maca=/.test(r.canonical_url))) bad.push("tracking params in canonical_url");
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
fs.writeFileSync(process.argv[1], JSON.stringify({ A: A.map((r) => r.id), Aurls: A.map((r) => r.canonical_url), B: B[0].id, others: [...B, ...C, ...D].map((r) => r.canonical_url) }));
console.error(`A corroborated: ${A.map((r) => r.id).join(",")}; B=${B[0].id} C=${C.map((r) => r.id)} D=${D.map((r) => r.id)} unverified`);
' "$TMP/ids.json"
AIDS=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).A.join(","))' "$TMP/ids.json")
A1=${AIDS%%,*}
BID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).B)' "$TMP/ids.json")

step "6. build references (apa)"
node scripts/references.mjs --report smoke-test --style apa > "$TMP/refs.txt"
node -e '
const fs = require("fs");
const ids = JSON.parse(fs.readFileSync(process.argv[1]));
const refs = fs.readFileSync(process.argv[2], "utf8");
for (const u of ids.Aurls) if (!refs.includes(u)) throw new Error("missing A url " + u);
for (const u of ids.others) if (refs.includes(u)) throw new Error("non-corroborated url in references: " + u);
console.error(refs.trim());
' "$TMP/ids.json" "$TMP/refs.txt"

step "6b. read-only skill helpers (pending, preview-references)"
node .claude/skills/verify-sources/scripts/pending.mjs > "$TMP/pending.json"
node .claude/skills/build-references/scripts/preview-references.mjs --style markdown > "$TMP/preview.json"
node -e '
const fs = require("fs");
const ids = JSON.parse(fs.readFileSync(process.argv[1]));
const pending = JSON.parse(fs.readFileSync(process.argv[2]));
const prev = JSON.parse(fs.readFileSync(process.argv[3]));
if (pending.count !== 6 || pending.articles.some((a) => ids.A.includes(a.id))) throw new Error("pending should list the 6 unverified B/C/D articles only");
if (prev.recorded !== false || prev.count !== 3) throw new Error("preview should list exactly the 3 corroborated A articles");
for (const u of ids.Aurls) if (!prev.formatted.includes(u)) throw new Error("preview missing " + u);
for (const u of ids.others) if (prev.formatted.includes(u)) throw new Error("preview contains non-corroborated " + u);
console.error("pending: " + pending.count + " unverified; preview: " + prev.count + " corroborated references");
' "$TMP/ids.json" "$TMP/pending.json" "$TMP/preview.json"

step "7. hook integration: require-corroborated"
OUT=$(echo "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"mcp__newsdb__cite_articles\",\"tool_input\":{\"article_ids\":[$BID]}}" | node .claude/hooks/require-corroborated.mjs)
echo "$OUT" | grep -q '"permissionDecision":"deny"' || { echo "expected deny for B ($BID), got: $OUT" >&2; exit 1; }
OUT=$(echo "{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"mcp__newsdb__cite_articles\",\"tool_input\":{\"article_ids\":[$A1]}}" | node .claude/hooks/require-corroborated.mjs)
[ -z "$OUT" ] || { echo "expected allow (empty stdout) for A ($A1), got: $OUT" >&2; exit 1; }
URL_B=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).others[0])' "$TMP/ids.json")
OUT=$(node -e 'console.log(JSON.stringify({hook_event_name:"PreToolUse",tool_name:"Write",tool_input:{file_path:"reports/smoke.md",content:"Source: "+process.argv[1]}}))' "$URL_B" | node .claude/hooks/guard-report-write.mjs)
echo "$OUT" | grep -q '"permissionDecision":"deny"' || { echo "expected guard-report-write deny for $URL_B, got: $OUT" >&2; exit 1; }
URL_A=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).Aurls[0])' "$TMP/ids.json")
OUT=$(node -e 'console.log(JSON.stringify({hook_event_name:"PreToolUse",tool_name:"Write",tool_input:{file_path:"reports/smoke.md",content:"Source: "+process.argv[1]}}))' "$URL_A" | node .claude/hooks/guard-report-write.mjs)
[ -z "$OUT" ] || { echo "expected guard-report-write allow for $URL_A, got: $OUT" >&2; exit 1; }
step "   deny B / allow A (require-corroborated and guard-report-write): ok"

step "8. trigger check: direct report_citations INSERT for B"
node --input-type=module -e '
import { appPool, roPool, closePools } from "./src/lib/db.mjs";
const id = Number(process.argv[1]);
const p = appPool();
let msg = "";
try {
  await p.query("INSERT INTO reports (slug) VALUES (?) ON DUPLICATE KEY UPDATE slug=slug", ["smoke-trigger"]);
  const [[r]] = await p.query("SELECT id FROM reports WHERE slug=?", ["smoke-trigger"]);
  await p.query("INSERT INTO report_citations (report_id, article_id, citation_style) VALUES (?,?,?)", [r.id, id, "apa"]);
} catch (e) { msg = e.message; }
let roMsg = "";
try { await roPool().query("INSERT INTO reports (slug) VALUES (?)", ["ro-should-fail"]); } catch (e) { roMsg = e.message; }
await closePools();
if (!/only corroborated articles may be cited/.test(msg)) { console.error("trigger did not fire: " + msg); process.exit(1); }
if (!/denied/i.test(roMsg)) { console.error("news_ro INSERT did not fail: " + roMsg); process.exit(1); }
console.error("trigger fired: " + msg + " | news_ro insert denied");
' "$BID"

step "9. MCP stdio smoke"
node scripts/mcp-smoke.mjs --unverified-id "$BID" >&2

step "10. reject cascade"
node --input-type=module -e '
import { appPool, closePools } from "./src/lib/db.mjs";
import { loadVerification } from "./src/lib/config.mjs";
import { markVerified } from "./src/lib/repo.mjs";
const [a1, ...rest] = process.argv[1].split(",").map(Number);
const r = await markVerified(appPool(), { articleId: a1, status: "rejected", reason: "smoke: simulate a retracted report to test cascade", actor: "claude" }, loadVerification());
const [rows] = await appPool().query("SELECT id, verification_status s FROM articles WHERE id IN (?)", [rest]);
const [[ev]] = await appPool().query("SELECT COUNT(*) n FROM verification_events WHERE actor=\"cascade\"");
await closePools();
if (rows.some((x) => x.s !== "unverified") || r.cascaded.length !== rest.length || Number(ev.n) !== rest.length) {
  console.error("cascade failed: " + JSON.stringify({ r, rows, ev })); process.exit(1);
}
console.error("cascade ok: rejected " + a1 + " -> downgraded " + r.cascaded.map((c) => c.id).join(","));
' "$AIDS"

echo "SMOKE OK"
