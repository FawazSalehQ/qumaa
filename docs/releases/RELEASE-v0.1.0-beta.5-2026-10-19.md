# Qumaa 0.1.0-beta.5 — rebuilt 2026-10-19

This build replaces the installers published in the `v0.1.0-beta.2` GitHub
release on 11 October (code tagged `1ac5b98`). At the user's request the release
name, its URL and the application version are unchanged; the build date and the
checksums below tell the builds apart. Built from commit `96fb54f` on
`ui-modernize`. The `v0.1.0-beta.2` tag still points at `1ac5b98` until the user
moves it; the release notes link to the sign-off commit by hash.

## What changed since the published build

- **Bilingual wayfinding interface** (`1f9db63`, `b3b2ffc`, `6327450`): the hiring
  funnel reads as a line of stops with line badges and a graphite chrome;
  collapsible sections are rail stops; renderer copy trimmed to the facts the
  controls cannot show.
- **Sign in with ChatGPT** (`cc9df03`): an eligible ChatGPT subscription can power
  the optional AI rerank beside Anthropic and OpenAI API keys. OAuth runs in the
  main process with PKCE and a temporary `127.0.0.1` callback; tokens are
  encrypted with the OS credential store and excluded from portable backups;
  every send still needs evidence review and a native confirmation; plan usage
  never falls back to API billing.
- **Security hardening** (`e28dce5`): bounded document parsing, backup
  validation, date handling, Electron 43.7.11.
- **Arabic** (`0725362`, `ca8db16`, `d1dd22d`): terminology made consistent
  ([glossary](../ARABIC-TERMINOLOGY.md)), missing entries added, a coverage test
  guards literal strings. Agent-written Arabic since `1ac5b98` still awaits
  native review.
- **Code review of 19 October** (`96fb54f`): dead code and duplicated logic
  removed; nine defects fixed: impossible year ranges that could stop the library
  from opening, parser upgrades and portable restore re-normalising stored text,
  phone numbers and years on their own line deleted as page markers, false
  degree matches (`Scrum Master`, `Boston, MA`), digit-only names, a crash when
  the same CV was imported twice at once, backup export on drives without hard
  links, raw education codes in exports and the Library, and an Arabic font rule
  on form controls.

## Minimum requirements

| | macOS | Windows |
|---|---|---|
| Operating system | macOS 12 or later | Windows 10 or 11, 64-bit |
| Processor | Apple Silicon (M1 or later) | x64 |
| Memory | 4 GB (8 GB recommended) | 4 GB (8 GB recommended) |
| Disk | 550 MB plus the library | 680 MB plus the library |
| Display | 940 × 620 or larger | 940 × 620 or larger |
| Network | None (optional AI reranking needs internet access) | None (optional AI reranking needs internet access) |

## Files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `Qumaa-0.1.0-beta.5-arm64.dmg` (macOS, Apple Silicon) | 233911126 | `37fa023db831c9844c3f64babd4e5eab48839bad813f083ee3ed3465a36a9a03` |
| `Qumaa-0.1.0-beta.5-Setup-x64.exe` (Windows x64) | 219646999 | `0e62186e254e3bc27cebb1542a726e5595abf80fa3baef0f80b01b8444a927d9` |

`SHA256SUMS-v0.1.0-beta.5.txt` lists both installers, their blockmaps,
`latest.yml`, `latest-mac.yml` and the four recruiter-guide files, which are
unchanged since September.

## Data compatibility

Libraries from any earlier beta.5 build open unchanged; the schema stays at 12.
The resume derivation version moves from `2:arabic-sections-and-locations` to
`4:scoped-fields`, so on first launch every library re-derives sections, fields
and chunks from stored text and re-embeds once behind the startup readiness
screen. Re-embedding costs about what the original import's embedding step
cost, about two minutes per 3,000 one-page CVs on an M-series Mac. CV
identities, companies, jobs and recruiter records are kept; saved match evidence
is invalidated and saved matches are refreshed when prompted. An interrupted
rebuild resumes at the next launch. ChatGPT tokens never enter portable
backups.

## Verification

- `build:mac` and `build:win` each ran `verify-model`, both TypeScript projects
  and `electron-vite build`; all passed. `fetch-win-deps` found
  `@img/sharp-win32-x64@0.34.5` already present.
- 680 unit tests in 61 files and 330 Electron integration checks passed on the
  reviewed tree, including the two new checks (concurrent identical imports; a
  bulleted-year fixture through the parser-upgrade rebuild); `npm test` was run
  again at `96fb54f`.
- All 31 UI workflows passed against `out/`, then all 31 again against the
  packaged Mac app (`QUMAA_E2E_EXECUTABLE`), in 1.3 minutes. During that run all
  app processes together peaked at about 1.2 GB resident, the largest single
  process at about 585 MB (resident sizes count shared pages more than once).
- `app.asar` is 35,716,906 bytes on macOS and 35,717,386 bytes on Windows, about
  34.1 MiB each, so no second copy of the model is inside; both contain the new
  derivation code (`deriveStoredResumeText`, `4:scoped-fields`, `EDUCATION_LABELS`).
  The bundled model is 146 MB on both platforms.
- macOS: `codesign --verify --deep --strict` passed on the ad-hoc signature;
  `hdiutil verify` reports a valid checksum.
- Windows: the unpacked payload carries `better-sqlite3` `win32-x64.node`, ONNX
  Runtime `win32/x64` (`onnxruntime.dll`, `onnxruntime_binding.node`, DirectML)
  and `@img/sharp-win32-x64` with its libvips DLLs. No 7-Zip on the build
  machine, so the NSIS payload itself was not extracted; CI's Windows job tests
  the unpacked app from the same commit.
- GitHub Actions runs 39299500509 and 39299493843 for `2e2a35f` (this build's
  code plus docs) passed on macOS arm64 and Windows x64, including the 31 UI
  workflows against the unpacked Windows package.
- Not done: a human install of the Windows installer on a real machine, the
  native Arabic review, a live ChatGPT sign-in, `npm run eval`, `npm run bench`.

Tests used disposable libraries. The Mac app is ad-hoc signed without Developer
ID notarization; the Windows installer has no publisher certificate. Matching
scores and the bundled model are unchanged;
[cross-domain matching limitations](../../pilot/CROSS-DOMAIN-2026-09-27.md) remain.
