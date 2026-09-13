# Qumaa · قُمع

A self-contained desktop app for macOS and Windows that stores resumes in a
local database and surfaces the best-matching candidates with evidence. Each
saved job keeps the position, job description, requirements, and education or
certification criteria in separate fields. English and Arabic resumes can be
ranked against a posting written in either language.

The interface is available in **English and Arabic**. Choose
**Settings → Language → العربية** to switch immediately to the Arabic RTL
layout. Existing installations start in English; the choice is saved on this
device and included in portable backups. Candidate text and saved job content
keep their original language. Arabic and Persian digits are accepted in
experience fields, and Arabic exports include bundled fonts for offline use.

**Nothing leaves your machine by default.** Embeddings are computed locally by a
bundled ONNX model, and with no API key configured the app opens no network
sockets at runtime. The one exception is opt-in and off by default: an optional
AI rerank of the shortlist through Anthropic or OpenAI, which only runs once you
paste that provider's API key into Settings and switch it on.

## Requirements

Node 22+ (`nvm use` picks it up from `.nvmrc`). Electron 43 and better-sqlite3 13
both require it.

## Setup

```bash
nvm use              # Node 22
npm install
npm run fetch-model  # downloads multilingual-e5-small (~135MB) into resources/
npm run dev
```

`fetch-model` is required once after a fresh clone because the weights are
gitignored. It downloads from the immutable revision in
`scripts/model-manifest.json` and checks the size and SHA-256 of every file,
including an existing CI cache. Packaging also runs `verify-model` and fails
before producing an installer if a model file is missing or has changed.

Qumaa accepts digital PDF, DOCX, and Markdown (`.md` or `.markdown`) resumes.
PDFs must contain a usable text layer. Image-only scans and other file types are
outside the supported scope; the app does not perform OCR.

## Recruiting workflow

1. Import CVs into **Library**, then open **Jobs**.
2. Choose **Express search**, beside **New job**, for an ad hoc search. Paste the
   job description and requirements into the two text fields, then choose
   **Find matches** to search the existing CV library without saving a job.
3. Inspect the results, optionally rerank with your chosen AI model or export the top three,
   then choose **Discard search** when finished. **Save as job** explicitly saves
   the exact posting and results, including AI order, model, and reasons if used,
   without running matching or reranking again. To start with a saved vacancy,
   choose **New job**, complete the full editor, and **Save job** before matching.
4. In a saved job, review source evidence, save job-specific notes and decisions,
   and compare two to four candidates against the same requirements.
5. Choose and order your shortlist, then export it as a PDF or Excel-compatible CSV.
6. Reopen the saved job later. New CVs make its matches stale without erasing
   recruiter decisions; refresh when ready to review the new library.
7. Use **Change status** to open, pause, fill, or archive a job. The job shows its
   creation date and a timestamped status history. **Filled** requires choosing
   the hired candidate from the library; optional backups occupy **#2** and **#3**
   only. Recorded candidate cards link to their CVs, and hiring decisions remain
   visible after archiving or reopening the job.

Express searches stay in memory for the current app session. Their postings and
results are not written to the database or browser storage and are absent from
the saved-job list and backups. **Open express search** returns to the current
results after switching views. Discarding the search or quitting the app removes
it; **Save as job** retains its posting and results for later.

Candidate details include a separate recruiter profile for corrections, screening
notes, availability, salary expectations, notice period, and tags. Link updated
CVs explicitly as versions of the same candidate to retain their review history.
Requirement passages are suggestions for human review; absent CV text never
automatically disqualifies a candidate. **Jobs** is the matching workspace for
local results, optional AI reranking, reviews, and shortlists.
For saved jobs, the model's order and reasons are saved with the results and survive
reopening the app. Refreshing local matches resets that rerank while preserving
recruiter reviews and the chosen shortlist.

Use **File → New Job** (`Cmd/Ctrl+N`) to start a vacancy. Switch between **Jobs**,
**Library**, and **Settings** with `Cmd/Ctrl+1`, `Cmd/Ctrl+2`, and `Cmd/Ctrl+3`.

Portable backups include jobs, status history, hiring selections, profiles, and reviews. Cached matching results are
rebuilt after restoring the library; saved AI reranks are part of that cache
and are not included. Schema v6 adds status history and hiring records; schema v7
identifies the provider and model behind a saved rerank. Earlier jobs retain their creation dates; unrecorded
status-change dates are not inferred. See [FEATURE_IMPLEMENTATION.md](FEATURE_IMPLEMENTATION.md)
for the integration plan and verification scope.

Choose **Settings → AI reranking → AI provider**, then **AI model**:

| Provider | Models |
|---|---|
| Anthropic | Sonnet 5, Opus 5, Fable 5.1 |
| OpenAI | GPT-4o mini, GPT-5.6, GPT-6 Astra |

Each provider retains its own protected API key and selected model. Existing
installations default to Sonnet 5. Jobs shows the selected model on its rerank
button and the model that produced a saved order; choosing another model allows
another rerank without refreshing local matches. Each provider/model requires
its own initial data review, with **See exported data** collapsed by default,
followed by native confirmation naming the destination and model. OpenAI requests
use `store: false`. No request automatically retries or switches providers.

Model IDs were verified against the [Anthropic model catalog](https://platform.claude.com/docs/en/models/overview)
and [OpenAI model catalog](https://developers.openai.com/api/docs/models).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run fetch-model` | Download or repair the pinned, SHA-256-verified local model |
| `npm run verify-model` | Verify the complete local model without using the network |
| `npm test` | Unit tests + the ranking sanity suite |
| `npm run smoke` | Integration check inside Electron: DB, embedder, real PDF/DOCX, search, PDF export, and wipe |
| `npm run test:ui` | Playwright flow through the real Electron UI and hardened preload boundary |
| `npm run verify` | Unit, Electron smoke, and UI suites together |
| `npm run seed` | Dev only: fill the library with the ten-person test corpus |
| `npm run bench` | Capacity benchmark: ingest, duplicate scan, and search at 500/1500/3000 resumes |
| `npm run build:mac` | Produce `release/Qumaa-<version>-arm64.dmg` (Apple Silicon) |
| `npm run build:win` | Produce `release/Qumaa-<version>-Setup-x64.exe` (Windows 10/11 x64) |

Each successful `build:mac` or `build:win` removes superseded local installers for
that platform. Cleanup can also be run with `node scripts/prune-releases.mjs mac`
or `node scripts/prune-releases.mjs win` after verifying a replacement.
The command reads the current version from `package.json` and operates only in
this repository's `release/` directory. It requires that platform's current
installer to exist as a nonempty regular file before removing other versions of
the same installer and their blockmaps. The other platform, current version,
unrelated files, symlinks, and build directories stay in place. An old checksum
manifest is removed only when neither platform's installer for that version
remains. Version numbers and timestamps are not compared because this project
has renumbered historical releases.

Both installers are unsigned. On macOS the first launch needs right-click → Open.
On Windows, SmartScreen shows a "Windows protected your PC" warning, and the user
has to click "More info" then "Run anyway". Removing that needs an Authenticode
code-signing certificate, set via `win.certificateFile` in `electron-builder.yml`.

The Windows installer is per-user, so it triggers no admin prompt. It lets the
user pick the install directory and creates Start Menu and desktop shortcuts.

### Where the library lives

The database is created on first launch; there is no setup step and no prebuilt
database ships inside the installer.

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/cv-filter/cv_filter.db` |
| Windows | `%APPDATA%\cv-filter\cv_filter.db` |

The folder is named after the package rather than the app, because Electron
derives it from `name` in `package.json` and electron-builder writes the Arabic
product name only into the bundle metadata. Keeping it as `cv-filter` is
deliberate: renaming it would strand the library of everyone who already
installed an earlier version, and an ASCII path avoids the encoding trouble that
Arabic in Windows paths invites.

**Uninstalling does not remove the library on either platform.** That is the
right default, since reinstalling then restores it, but it does mean the data
outlives the app unless it is removed deliberately. Two ways to do that:
Settings has a "Delete all data" action, and the Windows uninstaller asks
whether to remove the folder, defaulting to keeping it.

### Cross-building Windows from macOS

`npm run build:win` works from macOS and needs no Wine. It runs
`scripts/fetch-win-deps.mjs` first, which downloads `@img/sharp-win32-x64`.

That step is not optional. `sharp` ships one binary package per platform, and npm
refuses to install a package whose `os` field does not match the host, so a plain
`npm install` on macOS never fetches the Windows one. Without it the build still
succeeds and the app then dies on launch, because `transformers.node.cjs` requires
sharp at module load. The script fails loudly rather than letting that ship.

`better-sqlite3` and `onnxruntime-node` need no equivalent: each ships every
platform's prebuilt binaries in a single package.

## How matching works

Ingest: extract text (`unpdf` for PDF, `mammoth` for DOCX, direct reading for
Markdown) → normalise → split into labelled sections → chunk into ~200-word
overlapping windows → embed each chunk → store vectors as BLOBs in SQLite
alongside heuristically extracted fields.

Search combines the posting fields into one query while keeping the fields
separate in the interface and result context. Express search provides description
and requirements fields; saved jobs use the full four-field editor. This lets reviewers
edit or revisit the exact posting that produced a result without mixing it with
a later search.

Search blends three signals, min-max normalised across the candidate pool:

| Signal | Weight | Why |
|---|---|---|
| Semantic | 0.55 | Per-requirement max-similarity, averaged. Credits covering many requirements rather than nailing one. |
| Lexical (BM25) | 0.20 | SQLite FTS5. Embeddings smear exact tokens; this keeps hard requirements sharp. |
| Skill overlap | 0.25 | Gazetteer intersection, and the source of the matched/missing chips. |

Weights live in one place: `WEIGHTS` in `src/main/search/scoring.ts`.

E5 models are trained with a prefix on **both** sides: `query: ` on the posting
and `passage: ` on resume text. Omitting either silently degrades every score,
so `src/main/embed/protocol.ts` owns the rule and no caller supplies its own.
That file is also the single source of truth for the model id, and
`src/main/embed/reindex.ts` re-embeds the whole library when it changes: vectors
from two models are not comparable, and mixing them returns nonsense rankings
without ever raising an error. Search and every ingestion route wait for model
startup, any required reindex, and derived-data backfills to finish.

### Beyond the ranking

- **Near-duplicate detection.** Content hashing only catches byte-identical
  text, so the same candidate reapplying with a lightly edited CV used to occupy
  two of the three result slots. Each resume stores a document vector (the mean
  of its chunk vectors), but similarity alone is no longer enough at ordinary
  same-profession scores. Matching email or phone needs 0.90 cosine (and a
  shared phone cannot override conflicting full names), matching full names
  need 0.985, and records without comparable identity need 0.995. A flagged
  resume is still imported: whether it is a second application or a different
  person is the recruiter's call, not the app's.
- **Versioned skill extraction.** The bundled gazetteer has a content-derived
  version. When aliases or domains improve, stored resumes are re-extracted from
  their retained text before search opens, so existing libraries receive the
  same skill coverage as new imports.
- **Optional AI rerank in Jobs.** Off unless you add an API key and enable it
  in Settings. The first use shows a plain-language data summary; **See exported
  data** reveals the exact request when needed. Approval is remembered, and
  every send requires native confirmation. It reorders the top 15 local results
  while preserving candidates 16 onward, and any failure falls
  back to the local ranking rather than breaking the search.
- **Branded PDF export** of a shortlist, rendered offscreen with scripting
  disabled and every value HTML-escaped.
- Library sorting, filtering, and bulk delete; light, dark, and system themes.

## Capacity

Measured with `npm run bench` on an M-series Mac: synthetic resumes of roughly
300 words, which is two chunks each, the same shape as a real one-page CV.

| Library size | Ingest, per resume | Duplicate scan | Search | Chunks |
|---|---|---|---|---|
| 500 | 34 ms | 1 ms | 31 ms | 1,000 |
| 1,500 | 36 ms | 2 ms | 34 ms | 3,000 |
| 3,000 | 38 ms | 5 ms | 51 ms | 6,000 |

At 3,000 resumes the database is 39 MB and the app sits at about 257 MB RSS.

**A few thousand resumes is comfortable**, and the practical ceiling is patience
during bulk import rather than search: importing 3,000 files takes about two
minutes, all of it embedding, while a search over that library still returns in
under a tenth of a second. Ingest cost per resume is flat as the library grows,
so the import time scales linearly, not quadratically.

Search is a linear scan of every chunk vector, so it grows with library size:
the 500-to-3,000 jump costs 20 ms. Extrapolated, tens of thousands of resumes
would push a search into the several-hundred-millisecond range, which is the
point where an approximate vector index would start to earn its keep. Nothing in
the schema forecloses that.

## Architecture

- **Renderer**: React, UI only. `contextIsolation: true`, `nodeIntegration: false`.
- **Preload**: a narrow `contextBridge` surface; no raw `ipcRenderer`.
- **Main**: owns the database and orchestrates ingest and search.
- **Utility process**: runs ONNX inference, so a bulk import never freezes the UI.

Scoring math is deliberately split into `search/scoring.ts` with no Electron or
database imports, so the logic that decides the top three is testable without
booting an app.

## Layout

```
src/main/ingest/    extract → normalize → sections → chunk → fields → pipeline
                    plus duplicates.ts (near-duplicate scan)
src/main/search/    scoring.ts (pure math) + rank.ts (orchestration) + rerank.ts
src/main/embed/     utility-process client, worker, shared protocol, reindex
src/main/export/    branded shortlist PDF
src/main/db/        schema, migrations, vector (de)serialisation, queries
src/main/recruiting/ saved jobs, candidate profiles, reviews, and version history
src/renderer/       React UI (Jobs / Library / Settings)
test/               vitest suites + Electron Playwright flows + PDF/DOCX fixtures
```

## Brand

The visual identity lives in `brand/`, vendored from the Qumaa brand kit so
builds do not depend on anything outside the repo:

- `brand/svg/` the mark and app icons
- `brand/tokens.json` and `brand/tokens.css` the colour and type tokens
- `brand/BRAND.md` the usage rules

Colour and type values in `src/renderer/src/styles.css` are copied from those
tokens rather than hand-picked. `paper` is the surface tone, `ink` carries text,
and `violet` is reserved for accents and rules.

`npm run make-icon` rasterises `brand/svg/appicon-ink.svg` directly rather than
redrawing it, so the shipped icon cannot drift from the kit. The brand rules
forbid recolouring the funnel, which is the other reason nothing here
reconstructs the geometry.

Three rules the code enforces rather than documents:

- The Arabic lockup reads right to left, so the header sets `dir="rtl"` and the
  mark lands to the right of قُمع.
- Below 20px the mark drops its top sheet, because the two sheets stop resolving
  as separate strokes and smear into one block.
- Small all-caps labels use IBM Plex Mono at 0.24em tracking.

Typography is IBM Plex: Sans for Latin, Sans Arabic for the wordmark, Mono for
labels. All three are bundled, so rendering is identical on macOS and Windows and
nothing is fetched at runtime.

## Security and licensing

The renderer runs with `sandbox: true`, `contextIsolation: true`, and
`nodeIntegration: false`. It reaches the main process only through the named
operations in `src/preload/index.ts`; `ipcRenderer` is never exposed. A CSP
restricts the page to its own origin, navigation away from the local page is
blocked, and attempts to open additional windows are denied.

With no API key configured the app opens no network sockets at runtime.
`env.allowRemoteModels = false` stops transformers.js reaching the Hugging Face
hub on a cache miss, and the model is vendored at build time. Matching itself is
entirely local: no resume text is transmitted anywhere.

The optional AI rerank is the only code path that leaves the machine, and it
is inert until the user supplies a key and enables it. When it does run it sends
the structured posting and the top 15 candidates' redacted evidence to the
selected Anthropic or OpenAI API. New keys are stored separately through Electron's `safeStorage`; an older
plaintext key cannot be used until the user protects or removes it.

### Known advisories

`npm audit` reports **4 high-severity CVEs in libvips**, reachable through
`sharp`. They are image-decoding bugs, and there is no fixed release.

They are not reachable in this app. `sharp` is present only because
`transformers.node.cjs` requires it at module load; no code path passes an image
to it, and the app never decodes images at all. The one place sharp is genuinely
called is `scripts/make-icon.mjs`, at build time, on an SVG string this repo
generates itself.

Removing sharp is not an option: dropping it crashes the app on launch. If the
advisories matter for your context, the fix is upstream in libvips.

### Licences

MIT, in `LICENSE`. Everything redistributed inside the installer is permissive
(MIT, Apache-2.0, BSD-2-Clause, OFL-1.1), including the embedding model, which
is MIT from intfloat.

`npm run make-notices` regenerates `THIRD-PARTY-NOTICES.md` with the full text of
each bundled component's licence. It runs as part of both build scripts, and the
file ships inside the installer, because OFL-1.1 requires its terms to travel
with the font files and Vite compiles those fonts into the renderer bundle.

## Known limitations

Both follow from the no-LLM constraint:

1. **Structured extraction is heuristic.** Name and years-of-experience parsing
   will sometimes be wrong on creatively formatted resumes, especially multi-column
   PDFs, since text extraction interleaves the columns. Matching never
   depends on these fields, so a mis-parsed name cannot corrupt a result.
2. **Matching finds similarity, not judgement.** It reliably surfaces resumes
   about the same kind of work as the posting. On its own it cannot infer
   seniority from accomplishments. That is what the optional AI rerank over
   the top 15 is for, and it is the only feature that sends anything off the
   machine.

## Packaging notes

Four things in `electron-builder.yml` were established empirically, so don't
"tidy" them without re-testing:

- `onnxruntime-web` (136MB of WASM) is dropped, because inference runs through
  `onnxruntime-node`.
- `sharp` is **kept**, even though text pipelines never call it, because
  `transformers.node.cjs` `require`s it at module load. Removing it breaks the app.
- A platform's `files` list **replaces** the top-level one instead of merging, so
  `mac.files` and `win.files` each repeat the shared entries. Getting this wrong
  silently ships the whole project directory, including a second copy of the
  128MB model inside the asar.
- `npmRebuild: false`. Every native dependency ships prebuilt, ABI-stable N-API
  binaries, so nothing needs compiling; leaving the rebuild on makes cross-building
  for Windows fail outright, since node-gyp cannot cross-compile from source.
