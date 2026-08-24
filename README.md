# CV Filter

A self-contained desktop app for macOS and Windows that ingests resumes into a
local database and, given a pasted job description, surfaces the three
best-matching candidates with evidence for why they matched. English and Arabic
resumes are ranked against a posting written in either language.

**Nothing leaves your machine by default.** Embeddings are computed locally by a
bundled ONNX model, and with no API key configured the app opens no network
sockets at runtime. The one exception is opt-in and off by default: an optional
Claude rerank of the shortlist, which only runs once you paste your own API key
into Settings and switch it on.

## Requirements

Node 22+ (`nvm use` picks it up from `.nvmrc`). Electron 43 and better-sqlite3 13
both require it.

## Setup

```bash
nvm use              # Node 22
npm install
npm run fetch-model  # downloads multilingual-e5-small (~113MB) into resources/
npm run dev
```

`fetch-model` is a one-time step. The weights are gitignored; re-run it after a
fresh clone.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests + the ranking sanity suite (111 tests) |
| `npm run smoke` | Headless integration check inside Electron: DB, embedder, real PDF/DOCX, search |
| `npm run seed` | Dev only: fill the library with the ten-person test corpus |
| `npm run bench` | Capacity benchmark: ingest, duplicate scan, and search at 500/1500/3000 resumes |
| `npm run build:mac` | Produce `release/Qumaa-<version>-arm64.dmg` (Apple Silicon) |
| `npm run build:win` | Produce `release/Qumaa-<version>-Setup-x64.exe` (Windows 10/11 x64) |

Both installers are unsigned. On macOS the first launch needs right-click → Open.
On Windows, SmartScreen shows a "Windows protected your PC" warning, and the user
has to click "More info" then "Run anyway". Removing that needs an Authenticode
code-signing certificate, set via `win.certificateFile` in `electron-builder.yml`.

The Windows installer is per-user, so it triggers no admin prompt. It lets the
user pick the install directory and creates Start Menu and desktop shortcuts.

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

Ingest: extract text (`unpdf` / `mammoth`) → normalise → split into labelled
sections → chunk into ~200-word overlapping windows → embed each chunk → store
vectors as BLOBs in SQLite alongside heuristically extracted fields.

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
without ever raising an error.

### Beyond the ranking

- **Near-duplicate detection.** Content hashing only catches byte-identical
  text, so the same candidate reapplying with a lightly edited CV used to occupy
  two of the three result slots. Each resume stores a document vector (the mean
  of its chunk vectors) and a new import is flagged above 0.97 cosine. It is
  still imported: whether a near-duplicate is a second application or a
  different person is the recruiter's call, not the app's.
- **Optional Claude rerank.** Off unless you add an API key. It reorders the top
  15 local results, and any failure falls back to the local ranking rather than
  breaking the search.
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
src/renderer/       React UI (Match / Library / Settings)
test/               vitest suites + PDF/DOCX fixtures
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
blocked, and links are handed to the system browser only when the scheme is
`http`, `https`, or `mailto`.

With no API key configured the app opens no network sockets at runtime.
`env.allowRemoteModels = false` stops transformers.js reaching the Hugging Face
hub on a cache miss, and the model is vendored at build time. Matching itself is
entirely local: no resume text is transmitted anywhere.

The optional Claude rerank is the only code path that leaves the machine, and it
is inert until the user supplies a key and enables it. When it does run it sends
the job description and the top 15 candidates' evidence to the Anthropic API.
The key is stored through Electron's `safeStorage`, so it is encrypted by the OS
keychain rather than sitting in cleartext in the SQLite file; see
`src/main/secrets.ts`.

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
   seniority from accomplishments. That is what the optional Claude rerank over
   the top 15 is for, and it is the only feature that sends anything off the
   machine.

Scanned image-only PDFs are rejected with a clear message rather than imported
empty; there is no OCR.

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
