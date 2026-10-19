# Qumaa session handover (Claude ⇄ ChatGPT)

Signed off **19 October 2026 (evening)** (Asia/Riyadh, UTC+3) by **Claude** (Claude Code). Earlier sign-offs: 19 October (afternoon) by Claude, 18 October by Claude (twice), 17 October by Claude, 16 October by **ChatGPT** (Codex); their full texts are in Git history (`git log -- handover.md`).

This is the shared sign-off record between the Claude and ChatGPT sessions that work on this repository. Each session reads it before starting and updates it before signing off, so that work in one session does not undo, repeat or contradict work in another. It records state and decisions; it is **not authorization**. Commits, pushes, merges, releases, tag moves and messages to other people happen only when the user asks for them in the current session.

## 0. How to use this document

**Before starting work**

1. Read this file, then [AGENTS.md](AGENTS.md) and [README.md](README.md). Read [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md) before any renderer change. Where this file and an older dated report disagree, the newer dated statement here wins; older reports are evidence of their own date only.
2. Run `git status --short` and `git log --oneline origin/ui-modernize..HEAD`. If they disagree with section 1, trust Git and note the difference in your sign-off.
3. Check section 2 (**In flight**). Do not start a change that overlaps an in-flight item without the user's say-so.
4. Check section 4 (**Decisions in force**). Do not reverse or re-litigate them unless the user asks.

**Before signing off**

1. Update section 1 (snapshot) and section 2 (in flight).
2. Add a dated entry at the top of section 3 (session log): agent, the user's request in their words, what changed with commit hashes (a commit cannot contain its own hash, so name the commit that carries this file by its subject), what you changed in another agent's work, verification with numbers and scope, and what remains unverified.
3. Update section 9 (open items) and any reference section your work made stale.
4. Commit this file together with the work when the user has authorized commits; otherwise leave it modified and tell the user.

Agent-private notes (Claude's memory, Codex state directories) are invisible to the other agent. Anything the next session needs belongs here or in the tracked docs.

Keep a single handover file, `handover.md` (an older `HANDOVER-CODEX.md` was removed at the user's request). It is tracked in a **public** repository: never write secrets, tokens, API keys, real candidate data, personal contact details or private client information into it.

## 1. Snapshot

| Item | State |
| --- | --- |
| Product | **قُمع (Qumaa)**: local-first Electron recruiting desktop app, English and Arabic |
| Scope | Hiring across all domains and seniority levels; OCR out of scope |
| Repository | [FawazSalehQ/qumaa](https://github.com/FawazSalehQ/qumaa) (**public**) |
| Checkout | `/Users/fawazalqahtani/Desktop/Directory/cv_filter` |
| Branch | `ui-modernize`. `main` is still at `1ac5b98`; [pull request #1](https://github.com/FawazSalehQ/qumaa/pull/1) merges the branch into it and awaits the user. |
| Pushed | Everything through the 19 October (evening) sign-off commit, the one that adds this text. The 19 October review landed as `96fb54f` (code, locales, CSS, tests) and `2e2a35f` (docs), pushed 21:04 Riyadh. |
| CI | `.github/workflows/verify.yml` passed on macOS arm64 and Windows x64 for `d1dd22d` ([run 39149814389](https://github.com/FawazSalehQ/qumaa/actions/runs/39149814389)). Runs [39299500509](https://github.com/FawazSalehQ/qumaa/actions/runs/39299500509) and [39299493843](https://github.com/FawazSalehQ/qumaa/actions/runs/39299493843) for `2e2a35f` (push and pull-request triggers) were in progress at sign-off; check them before relying on Windows parity for the review changes. |
| Working tree | Clean apart from the gitignored local-only files in section 11 |
| Application/package version | **`0.1.0-beta.5`**; package `name` must stay **`cv-filter`** |
| Public release | **`v0.1.0-beta.2`**, intentionally distinct from the package version. Assets replaced on 19 Oct with the build from `96fb54f` under the same filenames (`gh release upload --clobber`); release notes rewritten with what changed since 11 Oct, the minimum requirements, data compatibility and verification, linking the documents by commit hash. The tag still points at `1ac5b98`: the force-push needed to move it was refused by Claude Code's auto-mode check (open item 14). The four guide files were left as they were. |
| Local installers | `release/Qumaa-0.1.0-beta.5-arm64.dmg` and `release/Qumaa-0.1.0-beta.5-Setup-x64.exe`, built 19 Oct 21:03–21:04 from `96fb54f`; byte-identical to the published assets (table below). `release/RELEASE-v0.1.0-beta.5-2026-10-19.md` is a copy of the new release document. |
| Database schema | **12** |
| Resume derivation version | **`4:scoped-fields`** since `96fb54f` (`3:bounded-text-parsing` at `d1dd22d`; `2:arabic-sections-and-locations` in the build published 11 Oct). The bump re-derives fields and re-embeds every library once at next launch; identities and recruiter records are kept, saved match evidence is invalidated. |
| Embedding model | Bundled `multilingual-e5-small`, 384 dimensions |
| Electron | **43.7.11** |
| Notable dependency | **jose** `^6.2.12` (verified OAuth ID tokens) |
| Runtime tools | Node 22+, at `/Users/fawazalqahtani/.nvm/versions/node/v22.23.2/bin` on this machine |

The pushed branch, the local installers and the published GitHub release are three different artifacts. Do not describe one by another's state.

**Release artifacts in `release/` (gitignored).** Installers built on 19 Oct by Claude after the user asked to commit, push, rebuild and publish as an overwrite, not a new version; the version was therefore kept at `0.1.0-beta.5` (open item 4 had suggested beta.6). Uploaded to the `v0.1.0-beta.2` release the same evening.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `Qumaa-0.1.0-beta.5-arm64.dmg` | 233911126 | `37fa023db831c9844c3f64babd4e5eab48839bad813f083ee3ed3465a36a9a03` |
| `Qumaa-0.1.0-beta.5-Setup-x64.exe` | 219646999 | `0e62186e254e3bc27cebb1542a726e5595abf80fa3baef0f80b01b8444a927d9` |

- `SHA256SUMS-v0.1.0-beta.5.txt` was generated outside the build scripts and lists ten files: both installers, their blockmaps, `latest.yml`, `latest-mac.yml` and the four recruiter-guide files (`Qumaa_Recruiter_Guide{,_AR}.{pdf,pptx}`). `build:mac` and `build:win` do not regenerate it, and `prune-releases` keeps it while the version is unchanged, so regenerate it after any rebuild (done 19 Oct with `shasum -a 256` in that file order).
- `release/` also holds the guide files and the `RELEASE-v0.1.0-beta.{2,3,4,5}.md` and `RELEASE-v0.1.0-beta.5-2026-10-19.md` notes; keep them when rebuilding. electron-builder's `builder-debug.yml` is deleted after each build.
- macOS builds are ad-hoc signed, not Developer ID signed or notarized. Windows builds have no Authenticode publisher certificate.

## 2. In flight

- **Pull request #1** (`ui-modernize` → `main`), opened 18 Oct by Claude. A direct push to `main` was blocked by Claude Code's auto-mode safety check as a merge without review, so the user merges it. Use **Create a merge commit** so the hashes cited here stay valid. Later pushes to `ui-modernize` update the pull request; the 19 October pushes did.
- **Native Arabic review**, started 18 Oct by Claude. The review page is a private claude.ai artifact owned by the user: https://claude.ai/artifact/AjzUW6dV7pLDt376gWo6wv. Version 3 lists 221 strings the app uses: the 114 agent-written strings added since `1ac5b98`, plus 107 older strings changed in the consistency work (`ca8db16` and the follow-up commit). Rows changed for consistency show the previous Arabic. No agent flags remain open. The reviewer marks each row Approved or Needs change and can type corrected Arabic. Decisions are stored in the page's database, collection `reviews`, documents `s001`…`s221`, fields `status` (`approved` or `change`), `arabic` and `note`. A Claude session reads them with the ArtifactData tool; anyone can use **Export CSV** on the page and hand the file to a ChatGPT session. To finish: apply each `change` to `src/shared/locales/`, update `docs/ARABIC-TERMINOLOGY.md` if a term changes, run `npm test` and `npm run test:ui:built`, then rebuild the installers (open item 4).

When a session leaves work half-done (an uncommitted change, a long-running build, a decision waiting on the user), list it here with the date, the agent, the files involved and what is needed to finish it.

## 3. Session log (newest first)

### 19 October 2026 (evening), Claude

User request: *"commit, push the changes to github, create installers, publish as an OVERWRITE NOT A NEW VERSION. Include minimum requirement specs as well."*

- Committed the review as `96fb54f` (114 files: code, locales, CSS, tests, the new `limits.ts`, `csv.ts`, `launch.ts` and two fixtures) and `2e2a35f` (docs and the audit move), staged by explicit path lists, then pushed `ui-modernize`; pull request #1 updated itself. The handover-suggested three-way split was not used: the fixes and the merges touch the same files, so a clean split would have needed hunk-level staging.
- `npm run build:mac` and `npm run build:win` from `96fb54f` (21:03–21:04). Verified: `app.asar` about 34.1 MiB on both platforms with the new derivation code inside; `codesign --verify --deep --strict` and `hdiutil verify` passed; all 31 UI workflows passed against the packaged Mac app in 1.3 minutes; the Windows payload carries the x64 native binaries. `SHA256SUMS-v0.1.0-beta.5.txt` regenerated (ten files).
- Published as an overwrite: `gh release upload v0.1.0-beta.2 --clobber` replaced the dmg, exe, both blockmaps, `latest.yml`, `latest-mac.yml` and the manifest under the same filenames. Release notes rewritten, linking the documents by commit hash. Moving tag `v0.1.0-beta.2` from `1ac5b98` to this sign-off commit needs a forced tag push, which the auto-mode check refused; left to the user (open item 14).
- Minimum requirements written into the release notes, `README.md` (Requirements → Installed app) and `docs/releases/RELEASE-v0.1.0-beta.5-2026-10-19.md`: macOS 12 or later on Apple Silicon (Electron 43's `LSMinimumSystemVersion` is 12.0; the DMG is arm64-only), Windows 10/11 x64, 4 GB RAM minimum with measured figures, download and installed sizes, a 940×620 window, no network. Found while checking the Windows payload: `onnxruntime.dll` and `onnxruntime_binding.node` import `MSVCP140.dll` and `VCRUNTIME140.dll`, which the installer does not ship, so the Microsoft Visual C++ 2015–2022 Redistributable (x64) is a stated requirement (open item 13).
- Decision: the version stays `0.1.0-beta.5` because the user asked for an overwrite, not a new version; the build date and checksums distinguish the builds.

### 19 October 2026 (afternoon), Claude

User request: *"review the entire code and run smoke tests to verify that everything works as intended. Also, I want you to look for any redundancies or dead code and delete it. Keep the directory simple and organized."* Committed the same evening as `96fb54f` and `2e2a35f` (entry above).

- Method: fifteen subsystem reviewers read the whole repository (77 bug reports, 325 dead-code or redundancy candidates, 58 organisation notes). Deletion candidates got three adversarial verifiers each (123 confirmed, 27 refuted, the rest cut off by the plan's session limit and then checked by hand or by deterministic scans); the ten high and medium bugs got two verifiers each (nine confirmed, one refuted).
- Deleted: 88 Arabic entries whose English text left the code before `1ac5b98` (the old express-search screen, pre-ChatGPT rerank and dialog wording) and the four raw education-enum entries; unused CSS (`.field-label`, `.score-ring`, `.recruit-editor-top`, unread `--warn`/`--warn-soft`/`--ease-in-out`, no-op RTL/Arabic resets and `min-width` repeats, `.talent-confirm-body ul`, `.pipeline-add .hint`, duplicate `th` declarations); the unwired lexical evidence suggester and its two tests; `EvaluationFamily`, `ApiRerankModel`, the `CLAUDE_RERANK_*` constants and a type re-export; `StagedRestore.sourcePath`; an unread `COUNT(*)`; the `start` script; the `dist/` ignore; `LineBadge`'s unused `className`; two class tokens no stylesheet knew.
- Merged duplicates: one `JOB_STATUS_LABELS` and one `STAGE_LABELS`; `requireResume`, `nowAfter` and `pruneSnapshot` in the recruiting storage layer; `csvCell` in `src/main/export/csv.ts`; `hiringDecimal` and `localizeHiringAssumption` shared by the renderer and the CSV; extraction limits in `extraction-protocol.ts`; `RERANK_PROVIDERS`; `DATABASE_LIMITS` in the new dependency-free `src/main/db/limits.ts`; the evaluation diagnostics reuse `lexicalScores`; `pragmaNumber`, `removeDatabaseFileSet` and the restore-marker name shared with `replacement.ts`; window minimums from `windowState.ts`; the chunk limit from the database limits; `vectorToBlob` in the backfill; one extractor queue helper; `stripIpcError`, `errorMessage(error, fallback)`, `splitLabels` and the talent date helpers reused; `SettingsView.load()` returns the settings it copied; test helpers in `test/fixtures/async.ts`, `test/fixtures/temporary.ts` and `test/e2e/launch.ts` (which also stops an inherited `ELECTRON_RUN_AS_NODE` from breaking `app.spec.ts`); `arabicCatalogs` exported for the consistency test; three duplicate test cases dropped and `talent-pools.test.ts` folded into `talent.test.ts`.
- Fixed (confirmed by two verifiers each): (1) `fields.ts` accepted any four-digit year in `Jan 1015` or `01/1442` forms, so one bad range could store 1,000 years of experience and the startup validator then refused to open the whole library; every form is now bounded to 1950–next year and parsed values above `DATABASE_LIMITS.yearsExperience` become unknown. (2) `normalizeText` is not idempotent, yet parser upgrades and portable restore re-normalised stored text, so a CV with a bulleted year line would mis-hash, fail the upgrade and, on restore, lose its recruiter records; `deriveStoredResumeText` now derives stored text as it is. (3) Lone digit lines of any length were deleted as page markers, so phone numbers and years on their own line vanished from the canonical text; only one to three digits count now. (4) Bare `Master`, `MA` and `BA` anywhere in a CV counted as degrees (Scrum Master, Boston MA, business analyst); short tokens now need an education section or degree context. (5) Arabic-Indic digit lines could be stored as a candidate's name. (6) Two concurrent imports of identical text crashed the second with a SQLite UNIQUE error instead of reporting a duplicate. (7) Backup export failed on file systems without hard links (exFAT, many shares); it now falls back to an exclusive copy. (8) English exports and the Library/detail views printed the stored enum (`bachelors`) instead of a label; one `EDUCATION_LABELS` map serves all five sites. (9) An Arabic-only CSS rule made selects and textareas inherit their label's font instead of the control font.
- Refuted and left alone: the claim that OpenAI rejects the `maxLength` keyword in the strict rerank schema (current OpenAI accepts it for non-fine-tuned models; stripping it is optional hardening).
- Docs: `CODE_AUDIT.md` moved to `docs/CODE-AUDIT-2026-09-22.md`; README layout map, scripts table, intake sentence and advisory paragraph refreshed; two broken links fixed; `brand/BRAND.md` threshold corrected to 20px; `FEATURE_IMPLEMENTATION.md` points at the release notes for the September figures; `docs/ARABIC-TERMINOLOGY.md` stale note dropped; `presentations/README.md` names its checksum manifest; `ROADMAP.md` refreshed.
- Verification: build, 680 unit tests in 61 files, 330 smoke checks (two new: concurrent identical imports; a bulleted-year fixture through the parser-upgrade rebuild), 31 UI workflows on `out/`. Not run: packaged builds, Windows, `eval`, `bench`.
- Suggested commits, in this order: "Remove dead code and merge duplicated logic" (src, locales, CSS, package.json, .gitignore, the three new modules), "Fix the ingest, backup and export defects found in review" (ingest, backup, exports, limits, derivation version, the new tests and smoke checks), "Consolidate test helpers and refresh the docs" (test/, docs). The smoke and shared files overlap, so one commit is also defensible.

### 18 October 2026 (later), Claude

User request: *"Fix the arabic consistencies"*.

- `ca8db16` **Make the Arabic terminology consistent.** 178 catalog entries in 13 catalogs plus two Arabic labels in `src/main/export/hiring-budget-csv.ts`, so each concept has one term and each UI pattern one form. The 48 decisions are in `docs/ARABIC-TERMINOLOGY.md`. Main ones: a screening kit is `استمارة فرز` (so `نموذج` means only an AI model); a ChatGPT account link is `ربط`, not `اتصال`; provider is `المزوّد` everywhere; recruiter-desk contacts are `الأشخاص`; a vacancy is `الوظيفة`; passages are `المقاطع`; the Pipeline view is `مسار المرشحين`; a recruiter profile is `الملف التوظيفي`; exports are `التصدير`. Count labels use `Label: {count}` or `(العدد: {count})` to avoid number-agreement errors. Static prose uses Arabic-Indic digits, `٪`, `ًا` and shadda spellings.
- Method: 8 area specialists proposed changes, an editor merged them into one glossary, and separate language and consistency checkers approved each change. A completeness pass on the full catalog found 18 more, including entries on multi-entry lines the first inventory had missed. No test hard-codes any changed string.
- Updated the review page to version 2 (section 2) and committed the glossary as `docs/ARABIC-TERMINOLOGY.md`.
- Follow-up (user: *"Did you fix the arabic?"*, then *"Fix"*): fixed the last open flag (`Could not open ChatGPT usage` = `تعذّر فتح صفحة استخدام ChatGPT`) and the backup sentence's `إعدادات المظهر واللغة`. Every "returned" string now uses `أرجع`, which removes the `أعاد … أعد` clash (glossary row added). Removed 79 Arabic entries whose English text had been removed from the code since `1ac5b98` and is referenced nowhere now; 5 similar entries whose text fragments still appear in code were kept. Review page version 3.
- Verification: build, 678 unit tests, 328 smoke checks and 31 UI workflows passed. Arabic captures of Jobs, Recruiter desk and Settings showed no overflow. The committed `docs/ui` after-sets predate this wording and are labelled with their commit.

### 18 October 2026, Claude

User requests: *"What do you recommend I do"*, then *"Other than testing chatgpt sign in, do your recommendations."*

- Pushed `ui-modernize` (`1c19871`). CI passed on both platforms: 676 unit tests, smoke, 31 UI workflows on the build and 31 on the packaged app, each on macOS arm64 and Windows x64. This is the first Windows run of this code.
- Opened pull request #1 to merge into `main` (section 2).
- `0725362` **Add missing Arabic entries and test Arabic coverage.** Added `Not specified`, `Unnamed person` and `Preparing…`. New `test/i18n-coverage.test.ts` fails when a literal `t('…')` or `translate(language, '…')` string has no Arabic entry, naming the file and line. A positive control (one entry removed) failed as expected.
- `26d286b` **Correct the watched-folder description.** The copy pass's *"including while Qumaa is closed"* implied imports run while the app is closed; the watcher catches up at the next launch.
- Arabic pre-review: an agent pass built a 44-term glossary of the app's established Arabic, checked all 114 strings and had a second agent challenge each flag. 15 flags survived; the watched-folder fix resolved one, and 14 are shown on the review page as hints, not verdicts.
- Verification: build, 678 unit tests and 31 UI workflows passed locally after each change. The review page's database was checked with one write, read and delete.
- Not done, by design: the ChatGPT sign-in test (the user's choice); installer rebuild (after the Arabic review).

### 16–17 October 2026, Claude

User requests, in order: read the 16 October handover; *"I don't like the overly descriptive and cluttery nature of the application. It contains too much descriptive text that looks 'AI'"*; *"change the design of the collapsing sections like 'view job description and criteria'"*; *"Commit the changes"* (the user chose to commit only Claude's UI work first); *"Commit the remaining changes"*; then: handover.md is the Claude/ChatGPT sign-off document, *"Commit all the changes that do not conflict with the build's logic and ensure that everything works as intended."*

| Commit | What it is |
| --- | --- |
| `b3b2ffcd8c24dcc693cab69f22a6c4687d5daa2a` | **Trim renderer copy to the facts controls cannot show.** Removed taglines, section intros and reassurance lines across Jobs, Companies, Recruiter desk, Library detail and Settings; helper text now carries one fact a control cannot show. The AI reranking send notice was kept in full; the card's intro line (provider and model choice, keys protected by the operating system) was removed, and that fact now appears only in the key-saved and key-migrated toasts. Rule recorded in DESIGN.md Do's/Don'ts and `.impeccable/design.json`. Removed the empty local-note strip CSS. 21 new Arabic entries. |
| `6327450c8546aa7fd412f58865cf9ac41d3cfaf8` | **Redesign collapsible sections as rail stops.** One shared disclosure treatment for all 14 `<details>` sites (section 5). The user picked "Rail stop" from three designs ranked by a design panel. An adversarial code and screenshot review found six defects, all fixed before the commit. |
| `cc9df036af5180b796054f9751a974c7bdfab423` | **Add ChatGPT subscription sign-in for AI reranking.** The ChatGPT session's integration from 16 October, committed unchanged apart from the two Settings copy edits below. A scan before committing found no keys, tokens or real account data. |
| `4ccc94252de3b8a23e912db9dad62d485547465e` | **Correct the Settings backup description.** The backups sentence Claude wrote into `cc9df03` said backups hold "all local records and preferences". They hold only theme and language among settings and drop saved matches. Now: *"Backups hold resume text, recruiting records, theme and language. They leave out original files, API keys, ChatGPT connections, AI settings and watched folders. They are not encrypted. After a restore, refresh saved jobs to rebuild their matches."* The Arabic entry was replaced. Found by the 17 Oct review of this handover. |
| Documentation commits after that | The ChatGPT session's 16 October handover as written; `docs/ui/` (baseline spec with its revert section rewritten for the current branch, before/after captures, after-sets re-captured from `4ccc942`); the design-decision records in `.impeccable/mocks/` and `.impeccable/questions/`; then this rewrite, `.gitignore` entries for the local-only files, a pointer to this file in AGENTS.md, the copy-rule exception and a stale tagline sentence in DESIGN.md (and its sidecar), and the network-contract wording in README.md, PRODUCT.md and FEATURE_IMPLEMENTATION.md. |

**Changes Claude made to ChatGPT-session work.** In `cc9df03`: the Settings paragraph *"Choose a provider and model. Use your own API key, or connect an eligible ChatGPT subscription…"* was removed (its Arabic entry is now unused), and the backups description was shortened; that wording was then corrected in `4ccc942`. In the documentation commit: README.md and PRODUCT.md no longer say AI reranking is the only outbound feature (ChatGPT sign-in, account switching, model and token refresh and sign-out send account credentials and a per-installation identifier, never candidate data), and FEATURE_IMPLEMENTATION.md gained a ChatGPT-mode bullet. No ChatGPT logic was changed.

How the commits were made: the working tree mixed both sessions' edits in shared files (Settings, styles, locales), so `b3b2ffc` and `6327450` were rebuilt from `e28dce5` plus Claude's own edit specs and staged without touching the working tree. The ChatGPT code was then committed as `cc9df03`. Per-commit verification is in section 8.

### 15–16 October 2026, ChatGPT (Codex)

User requests: commit and push the Wayfinding UI; fix validated security findings; *"I want someone to be able to use their ChatGPT subscription to use their paid subscription with Qumaa. They should have both API and non-API integration."*; rebuild and overwrite the local installers; write the handover.

| Commit | What it is |
| --- | --- |
| `1f9db634caa51419f24b5e6c44107150570ab743` (pushed) | **Modernize Qumaa UI with bilingual wayfinding design.** Claude's 11–12 October Wayfinding redesign, accepted by the user. |
| `e28dce5e320b869d1a37e669a8356e1a65375086` (pushed) | **Harden document parsing, backup validation, and date handling.** Four validated findings fixed: pathological text parsing, invalid restored timestamps/date rendering, DOCX verifier/consumer archive disagreement, executable SQLite schema constraints in backups. Electron 43.4.1 → 43.7.11. Derivation version bump reaches existing libraries and keeps identities and recruiter records. No model or ranking-weight change. |
| (uncommitted then, now `cc9df03`) | ChatGPT subscription integration (section 6). Local installers rebuilt with it. |

The security report is machine-local at `~/.codex/state/plugins/codex-security/scans/cv_filter/artifacts-9f7c6da30ddf6597252ac42e4b42db4989ab2c61f913168ea801519547aa0b76/artifacts/fix_report.md`. Its statements that nothing was committed or packaged were superseded by the later commits and builds. Its last dependency query listed 23 affected package entries (2 critical, 10 high, 11 moderate), Electron no longer among them. That is neither a clean audit nor 23 exploitable Qumaa findings; do not remove Sharp or blindly upgrade the stack to suppress counts.

### 11–12 October 2026, Claude

Built the Wayfinding renderer redesign (Riyadh Metro/KAFD wayfinding: line badges, the hiring funnel as a line of stops, graphite chrome) after freezing the previous UI in `docs/ui/baseline-2026-10-11/`. The user chose Wayfinding over the assigned "Ruled Page" direction (seed key `9bd6e20f`); the choice records are in `.impeccable/mocks/decision/` and `.impeccable/questions/`. Committed by the ChatGPT session as `1f9db63`.

## 4. Decisions in force

- **Scope:** hiring across all domains, English and Arabic as equals. F&B and drilling are regression datasets, not the target market. OCR stays out of scope.
- **UI:** Wayfinding is the house style; DESIGN.md and `.impeccable/design.json` are its contract. No revert is requested. Do not discard the renderer changes or delete `ui-modernize`; it also carries the security and ChatGPT work.
- **Copy:** helper text appears only when it carries a fact the controls cannot show (a consequence, an exclusion, a format rule, the next action in an empty state), in one short sentence. No taglines, section intros or reassurance lines. The user rejected those as clutter that "looks AI". **Exception** (worded the same in DESIGN.md and its sidecar): consent, privacy and data-handling disclosures (the AI rerank send notice, the backup and wipe descriptions) keep every fact they carry, in their shortest form, even across several sentences. The ChatGPT welcome and the account, usage and billing lines (`ChatGptWelcome.tsx`, the ChatGPT block in `SettingsView.tsx`, `JobRerank.tsx`) follow OpenAI's Sign in with ChatGPT UI guidance (section 6) and were not part of the copy pass; do not trim them without rechecking it and asking the user.
- **Arabic terminology:** follow `docs/ARABIC-TERMINOLOGY.md` (one term per concept, one form per pattern). Change it only with the user's say-so or a native reviewer's correction, and update the document in the same commit.
- **Collapsible sections:** every `<details>` uses the Rail stop disclosure (section 5). Never add a bare `<summary>`.
- **ChatGPT plan use:** offered through the official Sign in with ChatGPT flow alongside Anthropic and OpenAI API keys. Connecting never enables reranking; every send needs evidence review and native confirmation; a failed plan request never falls back to API billing (section 6).
- **Release naming:** keep the public release name `v0.1.0-beta.2` distinct from package version `0.1.0-beta.5` unless the user changes it.
- **Model:** small/base/large benchmarks showed inconsistent gains; `multilingual-e5-small` stays bundled. Do not repeat the comparison without a new hypothesis.
- **Data identity:** package `name` stays `cv-filter` (userData folder).
- **Stored resume text is canonical.** Only ingest normalises; parser upgrades and portable restore derive `raw_text` as stored (`deriveStoredResumeText`), so `content_hash` is always `sha256(flatten(raw_text))` and a rebuild can never change a CV's identity.
- **Stored-data limits live in `src/main/db/limits.ts`.** `DATABASE_LIMITS.yearsExperience` is the one bound for parsed, validated and recruiter-entered experience; a parsed value above it is unknown, never clamped.

## 5. UI system reference

The **Wayfinding** direction draws on Riyadh Metro/KAFD signage while keeping conventional desktop controls. Preserve:

- Brand: IBM Plex families, ink `#2b2733`, violet `#6d3fb0`, paper `#f4f1f8`, funnel mark and RTL lockup. Light, dark and Arabic are peers.
- Identity line tones (`violet`, `blue`, `teal`, `orange`) versus state tones (`green`, `amber`, `red`, `neutral`), controlled by `src/renderer/src/components/LineBadge.tsx`.
- Rounded-square identity/stop badges, dot pills for states, mono score boxes. Accessible text carries identity; decorative badges are hidden from assistive technology.
- Labels, eyebrows and table heads: Plex Mono 10.5px/500/uppercase/0.24em. Arabic resets tracking and case and uses Plex Sans Arabic.
- Inline `<bdi>` for short mixed-language identities; `dir="auto"` for prose and inputs; logical properties and start alignment.
- Depth by tone and 1px rules, shadows only on overlays, hover gated by `(hover: hover)`, reduced-motion support, inline SVG icons from `Icons.tsx` (directional ones mirror in RTL), bundled fonts, no network assets.
- Stable accessible names and class hooks used by Playwright. After renderer edits run `npm run build` and then `npm run test:ui:built` (or `npm run test:ui`, which builds first); `test:ui:built` tests whatever is in `out/` and passes against a stale build.
- **Arabic copy.** Use the terms in `docs/ARABIC-TERMINOLOGY.md`. Every `t('…')` string needs an Arabic entry keyed by the exact English text, with the same `{placeholders}`, in its area's catalog under `src/shared/locales/` (Settings and shell: `common.ts`; library and matching: `matching.ts`; native dialogs and menus: `native.ts`; Jobs: `recruiting.ts`; and so on). `translate()` falls back to English silently. `test/i18n-coverage.test.ts` fails when a literal `t('…')` or `translate(language, '…')` string has no entry; strings passed through a variable (`t(LABELS[x])`) are not covered, so check those by hand. `test/i18n.test.ts` checks placeholders and that a key repeated across catalogs has one translation. When you reword an English string, re-key or delete its old entry. Add every agent-written Arabic string to open item 5 for native review.

**Disclosure (Rail stop), added in `6327450`.** Markup: `<details className="disclosure [inline|entry] <site-class>">` whose head is `<DisclosureSummary>label</DisclosureSummary>` (`src/renderer/src/components/DisclosureSummary.tsx`: chevron, then a label span that is the summary's only text). Body children need no wrapper. The CSS is one block in `src/renderer/src/styles.css` under the comment "disclosures: stops on the line".

- Closed: 14px chevron in Text Faint pointing along the reading direction (left in Arabic), 13px 500 label in Text Dim, 34px row; `inline` is a fit-content 28px row at 12px for bars, notices and fields; `entry` fills a bordered list card (screening kits).
- Open: chevron turns down in the accent, label to full ink, body hangs from a 1px Border Strong rail under the chevron with text level with the label, 200ms unfold through `::details-content` with `interpolate-size`; reduced motion snaps.
- Status history keeps its own timeline instead of the rail and holds its full-width basis through the 200ms close (`recruiting.css`), then returns to the end of the status bar. When opened it moves to its own line; the panel chose that deliberately.
- `ChevronDownIcon` must never get `directional-icon`, whose RTL `scaleX(-1)` would fight the rotation.

**Captures.** `scripts/capture-ui.mjs` seeds fictional data in a throwaway library and captures 24 views (light, dark, Arabic). `docs/ui/baseline-2026-10-11/` freezes the pre-redesign UI and its README carries the per-file revert plan; never check out `src/renderer` from `1ac5b98` wholesale. `docs/ui/wayfinding-2026-10-11/` holds the after-sets captured from `4ccc942`; the 19 October CSS removals were verified by the UI suite, not re-captured.

## 6. ChatGPT integration reference (`cc9df03`)

Open **Settings → AI reranking → OpenAI** and choose **API key** or **ChatGPT subscription**. **Continue with ChatGPT** opens the system browser. The user can reconnect a saved account, add another account, select an account, refresh available models, manage usage and sign out. English and Arabic controls, account disclosures, keyboard focus handling and a first-plan-connection welcome modal are implemented.

Connecting a credential never enables reranking automatically. The user selects a model and enables it. Each send still requires a main-owned evidence preview capability and a native operating-system confirmation. Plan usage limits or failures retain local results; there is **no automatic fallback to separately billed API credentials**. The feature does not add a general chat interface, email intake, a ChatGPT plugin or browser automation.

| Concern | Files |
| --- | --- |
| OAuth protocol, callback, tokens, identity validation | `src/main/chatgpt/oauth.ts` |
| Protected storage and local registration metadata | `src/main/chatgpt/store.ts` |
| Accounts, refresh, model discovery, cancellation, lifecycle | `src/main/chatgpt/index.ts` |
| Shared account/config contracts | `src/shared/chatgpt.ts`, `src/shared/rerank.ts`, `src/shared/types.ts` |
| Main/preload IPC and runtime validation | `src/main/index.ts`, `src/main/ipc-validation.ts`, `src/preload/index.ts`, `src/shared/channels.ts` |
| Config, approval and account binding | `src/main/search/rerank-settings.ts`, `rerank-consent.ts`, `sessions.ts` |
| Canonical redacted request and streamed response handling | `src/main/search/rerankPrivacy.ts`, `rerank.ts` |
| Saved result compatibility | `src/main/recruiting/schema.ts` |
| Settings, welcome, rerank/usage UI | `src/renderer/src/views/SettingsView.tsx`, `components/ChatGptWelcome.tsx`, `components/recruiting/JobRerank.tsx` |
| Bilingual copy | `src/shared/locales/{common,matching,native}.ts` |
| Auth tests | `test/chatgpt-oauth.test.ts`, `test/chatgpt-session.test.ts` |
| Other regression coverage | `test/rerank-{settings,consent,privacy,request}.test.ts`, `test/recruiting.test.ts`, `test/backup-policy.test.ts`, `test/e2e/app.spec.ts`, `src/main/smoke.ts` |
| Dependency, notices, docs | `package.json`, `package-lock.json`, `scripts/make-notices.mjs`, `THIRD-PARTY-NOTICES.md`, `AGENTS.md`, `PRODUCT.md`, `README.md` |

**Supported protocol and eligibility.** Official OpenAI documentation was checked on 16 October 2026. Do not assume the old blanket statement that ChatGPT subscriptions cannot be used by third-party desktop apps still applies. The implementation uses the documented open-source **Sign in with ChatGPT** flow, targeting this repository's open-source local desktop distribution. OpenAI controls plan eligibility and allowance; a successful identity login without plan permission is not authorization to run inference. Paid or remotely hosted distributions require OpenAI approval under the guidance reviewed. References: [Quickstart](https://developers.openai.com/siwc/quickstart), [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [UI/UX guidance](https://developers.openai.com/siwc/ui-ux-guidelines), [Distribution eligibility](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt). Recheck them before changing protocol or eligibility behavior.

**Auth and privacy invariants.**

- OAuth runs entirely in main. Initial registration uses `dynamic_agent_client`, `agent_name_hint=Qumaa` and a stable local `urn:uuid:` host ID. The issued client ID is retained before exchange and reused; the bootstrap ID is not an exchange credential.
- The temporary callback listener binds only `127.0.0.1`, uses `/auth/callback`, and opens before the system browser. Fresh state, nonce and PKCE S256 bind each attempt. Invalid callbacks are ignored or rejected without leaking tokens or consuming an unrelated legitimate flow.
- Token exchange uses `https://auth.openai.com/api/accounts/oauth/token`. ID tokens are verified with jose against trusted discovery/JWKS, issuer, audience/authorized party, expiry, issue time and the sign-in nonce. A returning account's identity must match the selected registration.
- Scopes include `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Only returned granted scopes authorize plan use. Distinct registrations stay separate even when emails match.
- Token bundles use Electron `safeStorage` inside local SQLite settings. Status and model metadata are renderer-safe; tokens never cross IPC. Opening Settings or starting the app does not decrypt credentials, fetch models or refresh tokens.
- Refresh is serialized per account. Rotated credentials are saved encrypted before a later JWKS fetch can fail; `identityPending` forces verification before use. A logical connection revision stays stable through ordinary rotation and restart but changes on identity, permission or session changes.
- Account switches cancel inference but let a still-saved account's token rotation finish safely. Sign-out cancels requests, attempts remote refresh-token revocation and removes local tokens while keeping registration metadata. A failed remote revocation is disclosed.
- Restore, wipe and quit invalidate outstanding auth operations. Database reads and writes happen under maintenance leases; waiting for the browser never holds a long library lease. Late callbacks or refreshes cannot repopulate credentials after library replacement.
- Portable backups keep only theme/language settings; ChatGPT credentials, host ID, pending registration, accounts and sharing choices are excluded. Restore and wipe remove local connections. Account identifiers are not stored in saved match snapshots or outbound candidate evidence.
- Legacy `{provider, model}` configs remain API-key configs. Plan configs add `authMode: 'chatgpt'` with provider `openai`. API and plan model preferences are independent. An empty plan model is a pending Settings choice, never a valid send or saved AI result.
- Plan models come from the authenticated `/v1/models` catalog (`visibility: 'list'`). Catalogs refresh on account changes; startup uses cached metadata without networking.
- Plan inference uses fixed `https://api.openai.com/v1/responses` with `store: false`, `stream: true`, input arrays and instructions. Unsupported preview parameters, including `max_output_tokens`, are omitted. Only validated `response.completed` output counts; partial, refused, failed or incomplete streams never become rankings. Responses are capped at 1 MiB and 90 seconds.
- The reviewed request is the body actually sent. Approval is bound to auth mode and logical credential revision, rechecked after native confirmation, token refresh and inference. Never retry through another provider or account or fall back to API billing.
- Ordinary matching, local storage and exports remain offline. Explicit sign-in, model refresh, credential refresh/revocation and approved AI sends are the optional network operations. The old "no networking unless an API key exists" wording is obsolete.

## 7. Product and quality context

Implemented recruiter workflows: local file/paste/watched-folder intake; companies with multi-entry details; structured saved jobs and Express search inside Jobs; company links, salary ranges and hiring budgets; target-company research; candidate reviews, comparisons and ordered shortlists; contacts, activities, follow-ups, talent pools, pipelines, screening kits and client packs; saved Hiring Budgets & Costs under Companies. These are working features, not a backlog. See [FEATURE_IMPLEMENTATION.md](FEATURE_IMPLEMENTATION.md).

Workflow contracts to preserve:

- Intake accepts digital PDF, DOCX, `.md`/`.markdown`, pasted text and watched folders. Multi-column PDF extraction remains heuristic. OCR and dedicated email, job-board, scraping or candidate-upload integrations are absent; no online intake source has been chosen.
- Saved vacancies have structured fields, statuses `open`, `on-hold`, `filled`, `archived`, dated placement history, a hire and up to two backups. Company assignment is optional; per-person salary ranges and total hiring budgets are independent.
- Express search lives **inside Jobs**, in main-process memory until saved. Saving keeps the posting, results and applicable AI ordering without another search. Requirement passages are read-only until saved. Requirements keep source wording and required/preferred/unspecified importance; assessments distinguish confirmation, uncertainty and contradictory evidence.
- Company details, budgets and target-company research never rewrite postings, affect ranking, enter AI payloads or exclude candidates. Multi-entry fields use Add/Enter; legacy whole values are not split on commas or slashes. Contact-name and email lists are independent, not paired person records. A hiring company cannot target itself; an `excluded` research target does not reject its candidates.
- Recruiter records support manual prospects without CVs, explicit CV linking/merging and preserved history. Logging emails/messages does not send them; follow-ups are in-app reminders. Client PDF packs support up to ten people, main-owned canonical previews and one-use freshness tokens; internal notes are excluded, and blind mode does not guarantee anonymous narrative evidence.
- Hiring Budgets & Costs lives under **Companies**. Saved plans may link to that company's jobs but stay separate from job salary/budget fields; linking does not populate salary. Detach linked plans before reassigning a job to another company. Engines: `src/shared/hiring-costs.ts`, `hiring-money.ts`; rule changes need explicit compatibility/version decisions for `saudi-hiring-costs-2024-2028-v1` and `saudi-gosi-wage-limits-v1`. It is the narrower Saudi monthly planning calculator in [docs/HIRING-BUDGETS.md](docs/HIRING-BUDGETS.md); its geography does not limit the app's scope, and its legal assumptions are dated.

Matching quality remains unfinished. The active plan is [pilot/CROSS-DOMAIN-QUALITY.md](pilot/CROSS-DOMAIN-QUALITY.md); the 27 September measurements are in [pilot/CROSS-DOMAIN-2026-09-27.md](pilot/CROSS-DOMAIN-2026-09-27.md). Relevant-CV recall@10 was 88.3% in the posting language versus 11.7% across languages in that synthetic development evaluation. The frozen suite has 96 fictional bilingual careers, 24 vacancies and 12 profession families (80 development, 16 reserved cases); translated exposures are not independent people or vacancies. No experimental language-group normalization was deployed. Labels, translations and human recruiter acceptance remain unreviewed; reserved families have been inspected, so future acceptance needs genuinely fresh held-out data. No human pilot sessions are recorded ([pilot/README.md](pilot/README.md)). Relevance scores are relative text matches, not probabilities or verified qualifications.

The English and Arabic recruiter guides (24-slide decks, PDFs, screenshots, builders) are in [presentations/README.md](presentations/README.md) and [presentations/arabic/README.md](presentations/arabic/README.md). They predate the newest Companies/budget workflows, the Wayfinding UI, the copy pass, the disclosure redesign and the ChatGPT settings. Arabic materials must keep the English template, use real Arabic app screenshots and contain no U+2014 em dash. `presentations/arabic/source/build_guide_ar.py` imports the English builder, so English builder changes may need translation-dictionary updates.

Visible creator attribution stays **Fawaz Aljathnan** with `https://www.linkedin.com/in/fawazsalehq/`. Package author metadata is separately `Fawaz Alqahtani`.

## 8. Verification

**19 October 2026 (evening), Claude, on `96fb54f` and the packaged build:** `npm test` at HEAD; `build:mac` and `build:win` including `verify-model`; 31 UI workflows against the packaged Mac app (`QUMAA_E2E_EXECUTABLE=release/mac-arm64/قُمع.app/Contents/MacOS/قُمع npm run test:ui:built`), peak resident memory about 1.2 GB across all app processes; `codesign --verify --deep --strict` and `hdiutil verify`; asar sizes and content; Windows payload binaries and their import tables. Not run: NSIS payload extraction (no 7-Zip on this machine), Windows runtime, `eval`, `bench`. CI for `2e2a35f` was in progress.

**19 October 2026 (afternoon), Claude, on the review tree before it became `96fb54f`:** `npm run build`, 680 unit tests in 61 files, 330 Electron smoke checks (`npm run smoke`) and 31 UI workflows on `out/` (`npm run test:ui:built`) passed on macOS arm64. Not run: the packaged app, Windows, `npm run eval`, `npm run bench`. The dead-CSS and unused-key scans report nothing left; the 49 catalog keys with no literal use are built at runtime (zod messages, provider error templates, hiring-cost assumption notes).

**18 October 2026, GitHub Actions on `1c19871`** ([run 39080572186](https://github.com/FawazSalehQ/qumaa/actions/runs/39080572186)): on both macOS arm64 and Windows x64, `npm ci`, the model fetch, 676 unit tests, the Electron smoke suite, 31 UI workflows on `out/`, the unpacked package and 31 UI workflows on the packaged app all passed. Later commits were checked locally (build, 678 unit tests, 31 UI workflows) and re-run in CI on push.

**17 October 2026, Claude, on the code at `cc9df03`** (the documentation commits change no code). Parity with `.github/workflows/verify.yml` on macOS; packaging was written to a scratch folder so `release/` was not touched.

| Check (CI step) | Result |
| --- | --- |
| Model integrity (`npm run verify-model`) | Passed |
| Generated icon and notices (`make-icon`, `make-notices`) | Regenerated with no change to tracked files |
| Build (`npm run build`) | Passed |
| Unit tests (`npm test`) | 676 passed in 61 files |
| Electron smoke (`npm run smoke`) | 328 checks passed, including ChatGPT backup exclusion |
| UI workflows on `out/` (`npm run test:ui:built`) | 31 passed |
| macOS package (`electron-builder --mac --arm64 --dir`) | Built and ad-hoc signed; `app.asar` 35,782,326 bytes (34.12 MiB) |
| UI workflows on the packaged macOS app (`QUMAA_E2E_EXECUTABLE`) | 31 passed |
| Windows package (`electron-builder --win --x64 --dir`, cross-built) | Assembled; `app.asar` 35,782,806 bytes; Sharp's Windows binary unpacked; model outside the asar. **Not run on Windows.** |
| Tracked files after the run | Unchanged |

**Re-run on the final code, 17 October** (the working tree that became `4ccc942`, after the backup-copy fix): every step above passed again. 676 unit tests, 328 smoke checks, 31 UI workflows on `out/`, 31 on the packaged macOS app (`app.asar` 35,782,859 bytes), Windows package assembled (`app.asar` 35,783,339 bytes, Sharp's Windows binary unpacked); generated notices and icon unchanged; the run left the working tree unchanged.

Per-commit checks on 17 October, in isolated worktrees: the two UI commits were first verified in their pre-rewrite form (`2c0b110` and `29ec4ac`, which differ from `b3b2ffc` and `6327450` only by one Arabic entry later moved to `cc9df03`): both built and passed 573 unit tests (the ChatGPT tests were not yet present), and `29ec4ac` passed its 29 UI workflows. `6327450` itself then built and passed the 573 unit tests. The disclosure redesign went through two adversarial reviews (code: four lenses, two refuters per finding; screenshots: light, dark and Arabic, open and closed, hover, focus, reduced motion); six confirmed defects were fixed and re-verified with per-frame measurements of the status-history close.

**16 October 2026, ChatGPT (Codex), on `e28dce5` plus the then-uncommitted ChatGPT code:** production build passed; 676 unit tests (51 auth-focused, 96 request/privacy-focused); 328 Electron smoke checks including ChatGPT backup exclusion; 31 macOS UI workflows; both ChatGPT workflows 2/2 against the packaged macOS app; English/Arabic settings, consent and usage-limit screenshots inspected; packaged payloads matched `out/` (56 production files, 145 relative main imports resolved, packaged jose matched the lockfile); five model files matched pinned hashes; macOS arm64 and Windows x64 native binaries verified with Sharp retained; both `app.asar` files about 34.12 MiB; DMG contents and ad-hoc signature and the NSIS payload verified; installer metadata and the SHA-256 manifest verified.

The end-to-end subscription tests use the real loopback callback listener, signed ID-token verification, catalog handling, main/preload, evidence consent, streaming, saved ordering, quota recovery and revocation. Browser launch, provider responses and credential protection are simulated with fictional accounts and data; no real subscriber session or allowance was used.

**Still unverified:** live ChatGPT account eligibility, provider acceptance and real plan usage; a human install of the Windows NSIS installer on a real machine (CI on GitHub's Windows runner tests the unpacked app); human installation/upgrade acceptance. No ranking-quality evaluation, capacity benchmark or fresh security scan was run for the ChatGPT feature or the UI changes, and none is claimed.

Machine-local evidence (may be cleaned by the OS): from 16 Oct, `/private/tmp/qumaa-chatgpt-release-knDQbi/` (staged builds, `unit-tests.txt`, `artifact-verification.txt`, container logs, `replacement-summary.json`, `older-builds/`) and `/private/tmp/qumaa-chatgpt-{build,smoke,unit}.log`; from 17 Oct, Claude's session scratchpad under `/private/tmp/claude-501/` (`verify-run/` for `cc9df03`, `verify-run-2/` for the final tree, `pkg/` and `pkg2/` scratch packages, `wt1-*`, `wt2-*` and `wt2b-*` per-commit logs). `test-results/` holds screenshots from the latest UI run (17 Oct), not the 16 Oct ChatGPT run.

## 9. Open items

Listed for continuity, not as authorization.

1. **Live ChatGPT check.** A real eligible sign-in and one controlled request, done with the user. Do not spend their allowance or use real candidate data without their go-ahead.
2. **Windows installer.** CI now runs the full suite, including the packaged app, on Windows. Still untested: installing the NSIS `.exe` on a real Windows machine. The payload needs the Microsoft Visual C++ 2015–2022 Redistributable (x64) for ONNX Runtime (item 13).
3. **Merge pull request #1** into `main` (section 2).
4. **Installers.** Current: built 19 Oct from `96fb54f` and published (section 1). The version stayed `0.1.0-beta.5` at the user's request. Rebuild again after the Arabic review (item 5) with `npm run build:mac` / `npm run build:win`, regenerate the SHA-256 manifest, and ask the user whether the next publication is again an overwrite.
5. **Native Arabic review**, in progress through the review page (section 2). Its scope is agent-drafted Arabic that no native speaker has reviewed: the ChatGPT strings in `cc9df03` (`common.ts`, `matching.ts`, `native.ts`), 22 copy-pass strings (21 in `b3b2ffc`, plus the backups sentence, rewritten on 17 Oct), and three pipeline strings from the redesign (`Open in pipeline`, `Open pipeline for {name}`, `Review · Stage`). The older inconsistencies the glossary pass found were fixed in `ca8db16`; the 106 older strings it changed are on the review page too.
6. **Unused Arabic entries:** 79 removed on 18 Oct and 92 more on 19 Oct (88 orphaned by earlier rewrites, 4 raw education enums). The 49 keys a literal scan still calls unused are dynamic (zod validation messages, `${provider}` error templates, hiring-cost assumption notes); keep them. If the review page holds a decision for a deleted key, skip it.
7. **Missing Arabic entries:** literal `t('…')` strings are guarded by `test/i18n-coverage.test.ts`. About a hundred main-process error strings (backup validation, restore markers, recruiting invariants, ingest failure reasons, `maintenance.ts`, `secrets.ts`) have no Arabic entry and reach the Arabic UI in English; most are internal, roughly twenty are user-reachable. Decide which to translate through the review page.
8. **Design follow-ups (not authorization for another redesign).** Pipeline stage strip wraps at 1440px; the 1180×820 first viewport shows two candidate rows; English screening questions right-align in the Arabic UI; numbered lists inside disclosure bodies keep the browser's 40px indent; Status history moving to its own line when opened may be revisited if the user prefers. CSS consolidation candidates from the 19 Oct review, behaviour-preserving in principle but visual, so do them with captures: four state-pill implementations (`.pill`, `.recruit-job-state`, `.recruit-review-state`, `.company-job-status`), three 28px badge sizes, three count-badge and tab-row sets, four field-wrapper sets, three directory/workspace shells across `recruiting.css`, `talent.css` and `companies.css`, and one eyebrow label set repeated in six places.
9. **Guides and decks** predate the current UI and the ChatGPT settings.
10. **Dependency advisories.** README's "Known advisories" was refreshed on 19 Oct from `npm audit` (23 advisories: 2 critical and most moderates in dev tooling; the runtime-reachable highs are libvips through `sharp`, and `undici`). Do not remove Sharp. Re-triage after dependency updates.
11. **Matching quality** per `pilot/CROSS-DOMAIN-QUALITY.md`.
12. **Low-severity findings from the 19 Oct review, reported but not fixed** (each is small; fix with a test when touching the file): `TalentView.tsx` stores `String(failure)` so the IPC prefix is never stripped; `App.tsx` cancels every drop, not only file drops, and the Library and Settings tabs lack `aria-current`; `LibraryView.tsx` puts `aria-sort` on the button instead of the header and `removeSelected()` has no catch; `JobsView.tsx` reads a stale `resumes` list when a CV is deleted mid-review; the macOS About panel's library count is computed once per menu build; `ingestPickFiles` opens without the parent window; `windowState.ts` writes without error handling; a very long ChatGPT model id makes `rerankConsentKey` exceed the 128-character settings-key bound; a crash between write and rename leaves `cv_filter.db.restore-in-progress.json.tmp` forever; the OAuth clock tolerance is 5 seconds, the callback listener is not closed by `cancel()` after a valid callback, and the account label is not refreshed on reconnect; the native consent dialog names a ChatGPT model by slug; name redaction has no word boundaries; `Jan 2019 to date` contributes no experience; the live watcher uses depth 8 against the catch-up scan's 16, ignores a watched root whose name starts with a dot, and has no `error` listener; `recruitingError` knows five of the eleven record kinds; `ResumeDetail` never leaves "Loading…" on a failed fetch; a hiring plan whose job was deleted renders "Linked job: Linked job"; `Candidate shortlist`, `Hiring budget` and `Untitled job` fall back untranslated; the shortlist PDF formats English dates as en-GB; the CSV's Arabic "GOSI scheme" differs from the UI catalog; the client-pack blockquote mixes logical and physical radii; `companies.css` omits `select` from its weight reset; `eval-cross-domain.ts` does not normalise path separators; `model-integrity.mjs` rejects a Finder `.DS_Store`; the benchmark scripts import `esbuild` without declaring it; `make-notices.mjs` omits the `@img/*` packages the installer unpacks; `fetch-win-deps.mjs` cannot start `npm` on a Windows host; `electron-builder.yml` excludes dev-only chunks by name; CI has no concurrency group. Optional hardening: strip `minLength`/`maxLength` from the strict OpenAI rerank schema.
13. **Windows runtime dependency.** `onnxruntime.dll` and `onnxruntime_binding.node` import `MSVCP140.dll` and `VCRUNTIME140.dll`; the installer ships neither, and `better-sqlite3`, `sharp` and libvips need neither. On a machine without the Visual C++ 2015–2022 redistributable the embedding process fails to load and the app never becomes ready. Options: ship the two DLLs next to the binding (app-local deployment of the redistributable DLLs is permitted by the Visual Studio licence), or detect the load failure and show the Microsoft download link. Documented as a requirement in the release notes and README meanwhile.
14. **Move the release tag.** `v0.1.0-beta.2` still points at `1ac5b98` while the published installers come from `96fb54f`; Claude Code's auto-mode check refused the force-push on 19 Oct. To move it: `git fetch origin && git tag -f v0.1.0-beta.2 origin/ui-modernize && git push --force origin refs/tags/v0.1.0-beta.2`. The release notes already link by commit hash, so nothing else changes; record the move here.

## 10. Environment and invariants

```bash
export PATH=/Users/fawazalqahtani/.nvm/versions/node/v22.23.2/bin:$PATH
unset ELECTRON_RUN_AS_NODE

npm run build            # tsc (node + web) and electron-vite
npm test                 # vitest
npm run smoke            # Electron integration checks in a throwaway userData
npm run test:ui:built    # Playwright workflows against out/ (QUMAA_E2E_EXECUTABLE=<binary> for a packaged app)
npm run dev              # opens the PERSONAL library
npm run build:mac        # release/ installers (overwrites the local ones)
npm run build:win
```

- The agent shell defaults to Node 20 and inherits `ELECTRON_RUN_AS_NODE=1`. Agent tool calls do not keep shell state, so prefix **every** build, test or Electron command with the PATH export and `unset ELECTRON_RUN_AS_NODE` (or `env -u ELECTRON_RUN_AS_NODE`).
- `test:ui:built` and `capture-ui.mjs` use whatever is in `out/`; run `npm run build` first.
- To check packaging without overwriting the user's installers, package into a scratch folder:

  ```bash
  npm run verify-model && npm run make-icon && npm run make-notices && npm run build
  npx electron-builder --mac --arm64 --dir --config.directories.output=<scratch>/release
  QUMAA_E2E_EXECUTABLE="<scratch>/release/mac-arm64/قُمع.app/Contents/MacOS/قُمع" npm run test:ui:built
  node scripts/fetch-win-deps.mjs && npx electron-builder --win --x64 --dir --config.directories.output=<scratch>/release
  ```
- `npm run dev` and the packaged app open the user's personal library. Tests and captures must use throwaway `QUMAA_E2E_USER_DATA` directories and fictional data; never use real credentials or CVs. One process per data directory: a second instance quits silently and focuses the first, so check for a running dev or packaged instance before launching.
- Portable backups contain candidate and recruiting data and are **not encrypted**. They exclude credentials, ChatGPT connections, local resume paths, watched-folder configuration and window state. Restore discards saved search snapshots, rebuilds FTS and re-embeds retained text. Older builds cannot open upgraded schemas; do not advise downgrading an upgraded library.
- `getJob()` creates a fresh search-session ID on each read; normalize it or compare persisted records in tests.
- Remote model loading is disabled; bundled model files are pinned and hash-verified. Main owns SQLite, ingestion and matching; inference runs in a utility process; PDF extraction uses a worker.
- Repository invariants (Electron-ABI `better-sqlite3`, `sharp`, `npmRebuild`, the platform `files` lists, asar size, `asar extract-file`, the `cv-filter` name, embedding prefixes, the derivation version, scoring purity, filename-free ranking) are stated once in [AGENTS.md](AGENTS.md). Current weights: semantic 0.55, lexical 0.20, skills 0.25; section weights experience/projects/other 1, skills/education 0.92, summary 0.88; changes need `npm test` **and** `npm run eval`.
- Parser or cache changes bump `RESUME_DERIVATION_VERSION` (now `4:scoped-fields`, since `96fb54f`) and reach existing libraries behind readiness; `src/main/smoke-derived.ts` covers the upgrade.
- API-key and ChatGPT status reads must not decrypt secrets at startup. The renderer stays sandboxed and isolated, without Node or direct IPC.
- Arabic dates keep Gregorian behavior (`ar-SA-u-ca-gregory`). Accept Arabic/Persian digits and store canonical numbers. Preserve bidi isolation and directional controls rather than stripping them indiscriminately. Export fonts stay bundled.
- Rebuild installers after source changes before claiming artifact parity. NSIS script edits need a deliberate failing positive control.

## 11. Repository hygiene and local-only files

The repository is public. Stage files by name; never `git add .` or `git add -A`.

Committed on 17 October (they do not affect the build): this file, `docs/ui/` (baseline spec, revert instructions, before/after captures of fictional data), `.impeccable/mocks/` and `.impeccable/questions/` (the design-direction decision records).

Local-only and gitignored since 17 October:

- `cv_filter.code-workspace`: the user's VS Code workspace, which also opens the brand kit folder outside the repository.
- `eval/posting.txt`: the `npm run eval` posting. It reads like a real job advert and its synthetic provenance is unconfirmed, so it must not enter the public repository.
- `.impeccable/review/`: regenerable design-review captures, detector output and review packets.

Already ignored: `out/`, `release/`, `resources/models/`, `eval/corpus/`, `eval/results/`, `.local/`, `test-results/`, `*.log`, `*.tsbuildinfo`.

`THIRD-PARTY-NOTICES.md` is generated by `npm run make-notices`; its `License: MIT  ` line uses a Markdown hard break and is the one expected `git diff --check` whitespace report.

## 12. Suggested opening prompt

> Continue work on Qumaa. Read handover.md and AGENTS.md first, then check `git status` and `git log --oneline origin/ui-modernize..HEAD`. We are on `ui-modernize`, fully pushed; pull request #1 merges it into `main`. Preserve the decisions in section 4 of the handover and update the handover before you sign off. My next task is: [state the task].
