# CV Filter

A self-contained macOS desktop app that ingests resumes into a local database and,
given a pasted job description, surfaces the three best-matching candidates with
evidence for why they matched.

**Nothing leaves your machine.** Embeddings are computed locally by a bundled ONNX
model. There is no API key, and the app opens no network sockets at runtime.

## Requirements

Node 22+ (`nvm use` picks it up from `.nvmrc`). Electron 43 and better-sqlite3 13
both require it.

## Setup

```bash
nvm use              # Node 22
npm install
npm run fetch-model  # downloads bge-small-en-v1.5 (~133MB) into resources/
npm run dev
```

`fetch-model` is a one-time step. The weights are gitignored; re-run it after a
fresh clone.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests + the ranking sanity suite (87 tests) |
| `npm run smoke` | Headless integration check inside Electron: DB, embedder, real PDF/DOCX, search |
| `npm run seed` | Dev only: fill the library with the ten-person test corpus |
| `npm run build:mac` | Produce `release/CV Filter-<version>-arm64.dmg` (Apple Silicon) |
| `npm run build:win` | Produce `release/CV Filter-<version>-Setup-x64.exe` (Windows 10/11 x64) |

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

BGE models are asymmetric: the query side takes an instruction prefix, the
passage side takes none. `src/main/embed/protocol.ts` owns that rule so callers
cannot get it wrong.

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
src/main/search/    scoring.ts (pure math) + rank.ts (orchestration)
src/main/embed/     utility-process client, worker, shared protocol
src/main/db/        schema, vector (de)serialisation, queries
src/renderer/       React UI (Match / Library / Settings)
test/               vitest suites + PDF/DOCX fixtures
```

## Security and licensing

The renderer runs with `sandbox: true`, `contextIsolation: true`, and
`nodeIntegration: false`. It reaches the main process only through the named
operations in `src/preload/index.ts`; `ipcRenderer` is never exposed. A CSP
restricts the page to its own origin, navigation away from the local page is
blocked, and links are handed to the system browser only when the scheme is
`http`, `https`, or `mailto`.

The app opens no network sockets at runtime. `env.allowRemoteModels = false`
stops transformers.js reaching the Hugging Face hub on a cache miss, and the
model is vendored at build time.

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
is MIT from BAAI.

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
   about the same kind of work as the posting. It cannot infer seniority from
   accomplishments. If that becomes necessary, the clean upgrade is an LLM rerank
   over the top ~15, and the pipeline is shaped so that slots in without rework.

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
