# AGENTS.md

Context for AI agents working in this repo. Most of what follows was established
empirically — several items look like tidy-up opportunities and are not.

**قُمع (Qumaa)** is an offline Electron desktop app: ingest resumes into local
SQLite, paste a job description, get the best-matching candidates with evidence.
Matching and storage run on-device. Optional AI reranking uses an Anthropic or
OpenAI API key, or an eligible ChatGPT subscription connected through the
official Sign in with ChatGPT flow. It stays off until explicitly enabled and
each send requires evidence review and native confirmation. Sign-in, model
discovery and token refresh are also opt-in network operations; startup settings
must not decrypt credentials or contact a provider.

**Product scope: hiring across all domains.** F&B and drilling are existing
regression datasets, not the target market or a complete quality gate. Matching
must accept arbitrary job descriptions without an industry allowlist. Evaluate
general improvements across professions, seniority and Arabic/English, including
roles absent from the built-in skill vocabulary. The active quality plan is
`pilot/CROSS-DOMAIN-QUALITY.md`; narrow historical results do not establish broad
matching quality.

## Session handover

Claude and ChatGPT (Codex) sessions both work in this repository. `handover.md`
is their shared sign-off record: read it before starting (state, in-flight work,
decisions in force, open items) and update it before signing off. It records
context, not authorization to commit, push or release.

## Commands

```bash
npm test            # vitest tests, pure logic only; use run output for current count
npm run smoke       # integration check inside Electron (DB, model, ingest, search, wipe)
npm run bench       # capacity: ingest/dup-scan/search at 500/1500/3000
npm run eval        # ranking QUALITY against a labelled corpus (see below)
npm run eval:domains # multi-profession, bilingual synthetic regression suite
npm run dev
npm run build:mac   # release/Qumaa-<v>-arm64.dmg
npm run build:win   # release/Qumaa-<v>-Setup-x64.exe (cross-builds from macOS)
```

Node 22+ required. `npm run fetch-model` once after a fresh clone; weights are
gitignored.

## Things that will waste your time if you don't know them

**`better-sqlite3` is compiled for Electron's ABI, not Node's.** Any vitest test
that imports it crashes the worker with `ERR_IPC_CHANNEL_CLOSED`. That is why
there are no database unit tests. Database behaviour is tested in
`src/main/smoke.ts`, which runs inside Electron. Put DB tests there.

**`asar extract-file` writes to the current working directory.** Running it in
the repo root overwrites `package.json` with the packaged app's stripped
manifest, silently deleting every script and devDependency. Extract to a temp
directory.

**`sharp` must not be removed**, even though no code path passes it an image.
`transformers.node.cjs` requires it at module load, so dropping it crashes the
app on launch. It is the source of the libvips advisories in `npm audit`; they
are not reachable here.

**In `electron-builder.yml`, a platform's `files` list REPLACES the top-level
one rather than merging.** `mac.files` and `win.files` each repeat the shared
entries. Getting this wrong silently ships a second copy of the 128MB model
inside the asar. Check `app.asar` is ~33MB, not ~149MB.

**`npmRebuild: false` is deliberate.** Every native dep ships prebuilt N-API
binaries; enabling the rebuild breaks Windows cross-builds outright.

**userData is `cv-filter`, not `قُمع`.** Electron derives it from `name` in
`package.json`. Do not rename it: every existing install would open to an empty
library. If it must change, it needs a migration that runs before app-ready.

**Verify NSIS changes with a positive control.** `build/installer.nsh` compiles
into a compressed payload, so grepping the built `.exe` for your strings proves
nothing. Deliberately break the script and confirm the build aborts.

## Ranking invariants

**The embedding model is multilingual-e5-small and needs `query: ` / `passage: `
prefixes on BOTH sides.** BGE prefixed only queries; e5 does not. Omitting either
silently degrades every score. `src/main/embed/protocol.ts` owns this and the
model id — no caller supplies its own.

**Changing `MODEL_ID` forces a full re-index.** Vectors from two models are not
comparable and mixing them returns nonsense rankings without ever raising an
error. `src/main/embed/reindex.ts` detects the mismatch and re-embeds from stored
chunk text.

**`SECTION_WEIGHT` in `src/main/search/scoring.ts` is tuned, not arbitrary.** A
match in a summary is a claim; the same match in a work history is evidence.
Without this the ranking is trivially gamed by pasting the job description into a
profile blurb — measured, on a 100-CV corpus: precision@3 went 0% → 66.7% and
MRR 0.20 → 1.00 when it was introduced.

An earlier, harsher setting (summary 0.75) scored better on NDCG@10 but broke
cross-profession separation and Arabic→English retrieval in
`test/ranking-sanity.test.ts`, and threw one genuine candidate from rank 30 to
67. **If you change these weights, re-run BOTH `npm test` and `npm run eval`.**
The sanity tests are the guard; the eval is the target. Improving one while
breaking the other is not progress.

**The skills gazetteer (`src/main/data/skills.json`, 162 entries) is
domain-limited.** It covers software, finance, nursing, hospitality/F&B, and a
first set of drilling/well-engineering concepts. Arabic drilling terminology
still needs independent domain review; sources are in `skills-sources.md`. For
an uncovered domain the skill component collapses toward a constant and a quarter
of the score stops discriminating. Symptom: `Detected requirements` in the eval
output lists only two or three generic terms. Full-text semantic and lexical
matching still run for arbitrary roles; vocabulary coverage is not an industry
support boundary. Adding validated entries and Arabic aliases can address a
specific terminology gap, but is not the general solution for all professions.
Prioritize job-specific requirement/evidence matching and validate how sparse
dictionary coverage affects ranking and explanations across domains. Do not
treat unrecognized terminology as evidence that a candidate lacks a requirement.
Retain the existing `{id, label, aliases}` shape for vocabulary additions.

**Parser changes must reach existing libraries.** `src/main/ingest/derivation-version.ts`
versions the section/field/chunk derivation. A version change rebuilds these
caches from stored text behind startup readiness, retaining CV identities and
recruiter records while invalidating saved match evidence. Interrupted rebuilds
retry on the next launch. Cover DB upgrade behavior in `smoke-derived.ts`;
portable restore also marks the completed derivation version.

## The evaluation harness

`npm run eval:domains` runs the mixed-language development families in
`eval/cross-domain/`; see its README for reserved families and output controls.
Keep fixtures and labels frozen before experiments. Report each profession and
language as well as equal-vacancy averages; the largest corpus must not dominate
quality decisions. All synthetic labels and translations remain unreviewed.

`npm run eval` grades ranking quality against `eval/corpus/` (gitignored) and
`eval/posting.txt`, reporting precision@3, recall@3, MRR, and NDCG@10.

Ground truth lives in the filename: `t1_03_name.docx`, where t1 should reach the
top 3 and t4 is an adjacent-profession distractor. **This is only sound because
nothing in ranking reads a filename** — FTS5 indexes `raw_text` alone, and the
scorer sees chunk embeddings, `raw_text`, and extracted skills. Keep it that way.

`node scripts/corpus-to-pdf.mjs` converts a tier-stratified slice to PDF through
Word, so ingest is exercised on both extractors rather than mammoth only.

## Architecture

- **Renderer**: React, UI only. `sandbox: true`, `contextIsolation: true`, no `ipcRenderer`.
- **Preload**: narrow `contextBridge` surface.
- **Main**: owns the database, ingest, and search.
- **Utility process**: ONNX inference, so bulk import never freezes the UI.

`src/main/search/scoring.ts` is pure math with no Electron or DB imports, so the
logic deciding the top three is testable without booting an app. Keep it that way.

Secrets go through `src/main/secrets.ts` (`safeStorage`). `hasApiKey()`
deliberately does not decrypt, because it runs on the startup settings read and
the first keychain call can block on an OS prompt.

ChatGPT OAuth lives in `src/main/chatgpt/`; its tokens are protected by
`safeStorage` in local SQLite settings and excluded from portable backups.
Keep OAuth in main, with PKCE, state/nonce, verified ID tokens, and a temporary
127.0.0.1 callback opened only during sign-in. Account changes invalidate pending
rerank approvals; token rotation must preserve the logical connection revision.
Restore, wipe and quit invalidate outstanding auth work before it can commit.
Subscription requests use the authenticated model catalog and streamed Responses
with `store: false`; accept only a completed response. Never fall back to paid
API credentials when plan usage fails. Validate with synthetic accounts and
mocked provider responses, not real credentials or candidate data.
