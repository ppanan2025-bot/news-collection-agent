---
name: build-references
description: Build a formatted reference list for a research report using ONLY corroborated articles from newsdb, recording citations. Use when asked for references, citations, a bibliography or sources for a report.
argument-hint: "<report-slug> <topic> [apa|mla|chicago|markdown]"
allowed-tools: Bash(node .claude/skills/build-references/scripts/preview-references.mjs:*), mcp__newsdb__query_references, mcp__newsdb__cite_articles, mcp__newsdb__get_article, Write, Edit
---

# Build references

Arguments: `$ARGUMENTS`

1. Parse the report slug (must match `^[a-z0-9-]{3,128}$`), the topic and the style (default `apa`; also `mla`, `chicago`, `markdown`).
2. Call `mcp__newsdb__query_references {topic or query, since?}`. If it returns nothing, **stop** and tell the user to run `/collect-news` and then `/verify-sources`. **Never fall back to unverified articles, web search or memory** — not even "temporarily" or "as placeholders".
   Optionally preview the formatted list first with the read-only helper (project root):
   `node .claude/skills/build-references/scripts/preview-references.mjs --topic "<terms>" --style apa`. It reads only the
   corroborated `v_reference_ready` view as `news_ro` and records nothing; the preview is **not** a substitute for step 4.
3. Choose the relevant articles. Prefer more independent corroborators and the earliest report of each event. If several articles from different outlets cover the same story, cite one and list the rest as corroboration.
4. Record the citations only by calling `mcp__newsdb__cite_articles {report_slug, article_ids, style}`. The hook and the server deny anything that is not corroborated; do not work around a denial.
5. Write `reports/<slug>-references.md` from the returned `formatted` text exactly as returned. Add a header with the topic, generation date, style and the verification rule, and this footer line: "All sources corroborated by ≥N independent outlets; verification log in newsdb.verification_events" (N = `min_independent_outlets`).
6. If the user is drafting report text in `reports/`, any inline URL must be an article that was cited. The `guard-report-write` hook enforces this.
