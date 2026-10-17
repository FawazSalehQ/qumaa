# Qumaa handover for Claude

Updated **16 October 2026**, timezone **Asia/Riyadh**. This is the single current local, untracked handover for the user's transfer from Codex to Claude. Useful prior project context is consolidated here.

**Current state:** the Wayfinding UI and security fixes are committed and pushed on `ui-modernize`. The subsequent ChatGPT subscription integration is implemented, tested and included in the replaced **local** installers, but its source changes are **not committed or pushed**, and the new installers have **not been uploaded to GitHub**. Real ChatGPT subscriber access remains unverified.

Read this file, [AGENTS.md](AGENTS.md), [README.md](README.md), and the live Git status first. Read [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md) before renderer changes. Workflow contracts and dated evidence are linked below; use the current branch, release-artifact, validation, privacy and derivation-version statements in this handover when interpreting historical reports.

This document supplies context, not new authorization to commit, push, merge, publish, contact others or start another feature. The current user request was the handover update only. Earlier explicit commit/push requests were fulfilled for the UI and security changes; the newest integration was reported to the user as local and uncommitted.

## 1. Repository snapshot

| Item | State |
| --- | --- |
| Product | **قُمع (Qumaa)**, local-first Electron recruiting desktop app, English and Arabic |
| Scope | Hiring across all domains and seniority levels; OCR remains out of scope |
| Repository | [FawazSalehQ/qumaa](https://github.com/FawazSalehQ/qumaa) |
| Checkout | `/Users/fawazalqahtani/Desktop/Directory/cv_filter` |
| Branch | `ui-modernize` |
| HEAD | `e28dce5e320b869d1a37e669a8356e1a65375086` |
| Upstream | Cached `origin/ui-modernize` points to the same commit; the earlier push was completed. No fresh fetch was needed for this document. |
| Current uncommitted work | ChatGPT subscription authentication, streaming reranking, settings/consent UI, tests and documentation |
| Application/package version | **`0.1.0-beta.5`**; package `name` must stay **`cv-filter`** |
| Public release name/tag | Historically retained **`v0.1.0-beta.2`**, intentionally distinct from the package version |
| Database schema | **12**, unchanged by the subscription integration |
| Resume derivation version | **`3:bounded-text-parsing`**, advanced by the security fixes |
| Embedding model | Bundled `multilingual-e5-small`, 384 dimensions; unchanged |
| Electron | **43.7.11** |
| New runtime dependency | **jose 6.2.12**, declared `^6.2.12`, for verified OAuth ID tokens |
| Runtime tools | Node 22+; local binary directory `/Users/fawazalqahtani/.nvm/versions/node/v22.23.2/bin` |

Do not treat the GitHub release, the pushed branch, and the local installers as the same artifact. The local installers contain the uncommitted subscription work on top of HEAD.

## 2. Work completed in the Codex session

### Committed and pushed

1. **`1f9db634caa51419f24b5e6c44107150570ab743` — Modernize Qumaa UI with bilingual wayfinding design.** The user explicitly requested committing the UI. The design direction is no longer an uncommitted proposal awaiting a keep/revert decision. `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`, the surface brief and `scripts/capture-ui.mjs` are tracked. Screenshot/review folders remain local.
2. **`e28dce5e320b869d1a37e669a8356e1a65375086` — Harden document parsing, backup validation, and date handling.** The four validated application findings were fixed: pathological text parsing, invalid restored timestamps/date rendering, DOCX verifier/consumer archive disagreement, and executable SQLite schema constraints in backups. Electron was updated from 43.4.1 to 43.7.11. The parser derivation bump reaches existing libraries and preserves identities and recruiter records. No embedding model or ranking weights changed.

The security fix report is at:

`/Users/fawazalqahtani/.codex/state/plugins/codex-security/scans/cv_filter/artifacts-9f7c6da30ddf6597252ac42e4b42db4989ab2c61f913168ea801519547aa0b76/artifacts/fix_report.md`

That report describes its earlier validation stage; its statements that nothing was committed/packaged were subsequently superseded by the completed commits and builds. The original scan remains historical evidence, not a fresh audit of the ChatGPT integration. Its last dependency query reported 23 affected package entries (2 critical, 10 high, 11 moderate), with Electron no longer listed. This is neither a clean dependency audit nor 23 independently established exploitable Qumaa findings. Do not remove Sharp or blindly upgrade the stack to suppress counts.

### Implemented locally after those commits

The user's request was: **“I want someone to be able to use their ChatGPT subscription to use their paid subscription with Qumaa. They should have both API and non-API integration.”**

The implementation adds subscription authentication to the existing optional AI reranking feature. It does not add a general chat interface, email intake, a ChatGPT plugin or browser automation. OpenAI API keys and Anthropic API keys remain supported. The subscription option avoids requiring an API key or separate API billing; technically it calls OpenAI's documented Responses endpoint using OAuth authorization.

The user then requested the current handover update and transfer to Claude. There is no additional active feature request in this handover.

## 3. ChatGPT integration: behavior and source map

Open **Settings → AI reranking → OpenAI** and choose **API key** or **ChatGPT subscription**. **Continue with ChatGPT** opens the system browser. The user can reconnect a saved account, add another account, select an account, refresh available models, manage usage and sign out. English and Arabic controls, account disclosures, keyboard focus handling and a first-plan-connection welcome modal are implemented.

Connecting a credential never enables reranking automatically. The user selects a model and enables it. Each send still requires a main-owned evidence preview capability and a native operating-system confirmation. Plan usage limits or failures retain local results; there is **no automatic fallback to separately billed API credentials**.

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
| New auth tests | `test/chatgpt-oauth.test.ts`, `test/chatgpt-session.test.ts` |
| Other regression coverage | `test/rerank-{settings,consent,privacy,request}.test.ts`, `test/recruiting.test.ts`, `test/backup-policy.test.ts`, `test/e2e/app.spec.ts`, `src/main/smoke.ts` |
| Dependency/notices/docs | `package.json`, `package-lock.json`, `scripts/make-notices.mjs`, `THIRD-PARTY-NOTICES.md`, `AGENTS.md`, `PRODUCT.md`, `README.md` |

The new auth directory, shared account file, welcome component and two auth test files are intentionally **untracked source awaiting a commit**. They must not be confused with disposable local screenshots or handover artifacts when staging a future authorized commit.

### Supported protocol and current eligibility

Official OpenAI documentation was checked on October 16, 2026. Do not assume the old blanket statement that ChatGPT subscriptions cannot be used by third-party desktop apps still applies. This implementation uses the documented open-source **Sign in with ChatGPT** flow, targeting this repository's open-source local desktop distribution. OpenAI controls plan eligibility and allowance; a successful identity login without plan permission is not authorization to run inference. Paid or remotely hosted distributions require OpenAI approval under the guidance reviewed.

Primary references:

- [Quickstart](https://developers.openai.com/siwc/quickstart)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [UI/UX guidance](https://developers.openai.com/siwc/ui-ux-guidelines)
- [Distribution eligibility](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

These links record the implementation basis; recheck official docs if changing provider protocol or eligibility behavior.

### Auth and privacy invariants

- OAuth runs entirely in main. Initial registration uses `dynamic_agent_client`, `agent_name_hint=Qumaa`, and a stable local `urn:uuid:` host ID. The issued client ID is retained before exchange and reused; the bootstrap ID is not an exchange credential.
- The temporary callback listener binds only `127.0.0.1`, uses `/auth/callback`, and opens before the system browser. Fresh state, nonce and PKCE S256 bind each attempt. Invalid callbacks are ignored or rejected without leaking tokens or consuming an unrelated legitimate flow.
- Token exchange uses `https://auth.openai.com/api/accounts/oauth/token`. ID tokens are verified with JOSE, trusted discovery/JWKS, issuer, audience/authorized party, expiry, issue time and the sign-in nonce. Returning-account identity must match the selected registration.
- Scopes include `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Only returned granted scopes authorize plan use. Distinct registrations stay separate even when emails match.
- OAuth token bundles use Electron `safeStorage` inside local SQLite settings. Status/model metadata is renderer-safe; tokens never cross IPC. Opening Settings/startup does not decrypt credentials, fetch models or refresh tokens.
- Refresh is serialized per account. Rotated credentials are saved encrypted before a later JWKS fetch can fail; `identityPending` forces verification before use. A logical connection revision stays stable through ordinary rotation and app restart but changes on identity/permission/session changes.
- Account switches cancel inference but allow a still-saved account's token rotation to complete safely. Sign-out cancels requests, attempts remote refresh-token revocation, and removes local tokens while retaining registration metadata. Failed remote revocation is disclosed.
- Restore, wipe and quit invalidate outstanding auth operations. Database reads/writes occur under maintenance leases; browser waiting never holds a long library lease. Late callbacks/refreshes cannot repopulate credentials after library replacement.
- Portable backups allow only theme/language settings; ChatGPT credentials, host ID, pending registration, accounts and sharing choices are excluded. Restore/wipe remove local connections. Account identifiers are not stored in saved match snapshots or outbound candidate evidence.
- Legacy `{provider, model}` configs remain API-key configs. Plan configs add `authMode: 'chatgpt'` with provider `openai`. The API model preference and plan model preference are independent. An empty plan model is a pending Settings choice, never a valid send or saved AI result.
- Plan models come from the authenticated `/v1/models` catalog (`visibility: 'list'`, slug/display name). Catalogs refresh on account changes; startup uses cached metadata without networking.
- Plan inference uses fixed `https://api.openai.com/v1/responses`, `store: false`, `stream: true`, input arrays and instructions. Unsupported preview parameters, including `max_output_tokens`, are omitted. Only validated `response.completed` output counts as success. Partial/refused/failed/incomplete streams do not become rankings. Responses are capped at 1 MiB and 90 seconds.
- The reviewed request is the actual sent body. Approval is bound to auth mode and logical credential revision, with rechecks after native confirmation, token refresh and inference. Never retry through another provider/account or fall back to API billing.
- Ordinary matching, local storage and exports remain offline. Explicit sign-in, model refresh, credential refresh/revocation and approved AI sends are the optional network operations. The old “no networking unless an API key exists” wording is obsolete.

## 4. Verification and its limits

Results below were recorded during the October 16 implementation/build work, not rerun merely to update this document.

| Check | Result and scope |
| --- | --- |
| Production build | Both TypeScript projects and Electron/renderer bundles passed on the final tree |
| Full unit suite | **676 tests in 61 files passed** |
| Auth-focused suite | **51 tests** within that total, including real signed JWT checks and session/storage/refresh races |
| Request/privacy-focused suite | **96 tests** within the total, including streaming bounds and cancellation |
| Electron smoke | **328 checks passed**, including explicit ChatGPT backup exclusion |
| Source UI suite on macOS | **31 workflows passed**; the two ChatGPT workflows passed again against the final built output |
| Packaged macOS app | Both ChatGPT workflows passed (**2/2**) using the actual packaged main/preload and JOSE dependency |
| UI inspection | English/Arabic settings, consent and usage-limit screenshots inspected for layout and RTL |
| Both packaged payloads | 56 production files match final `out/`; 145 relative main imports resolve; packaged JOSE runtime matches installed/locked dependency |
| Model/native checks | Five external model files match pinned tree/hashes; five macOS arm64 and nine Windows x64 native binaries verified; Sharp retained |
| Archive size | Both `app.asar` files approximately **34.12 MiB**; no duplicate model, unused browser ONNX runtime or dev entry points |
| Installer containers | DMG contents match 457 files/symlinks and strict ad-hoc signature passes; NSIS embedded payload matches 252 entries |
| Release metadata | Installer size/version/SHA-512 fields and all ten entries in the local SHA-256 manifest verified |

The end-to-end subscription test uses the **real loopback callback listener, signed ID token verification, catalog handling, main/preload, evidence consent, streaming, saved ordering, quota recovery and revocation**. Browser launch, provider responses and credential protection are simulated using fictional accounts/data. It does not open a real subscriber session or spend a real plan/API allowance.

**Still unverified:** live ChatGPT account eligibility, actual provider acceptance and real plan usage; this new Windows build running on Windows; human installation/upgrade acceptance. Historical Windows CI passed at the older published commit, not this uncommitted feature tree. Do not claim a current Windows runtime/CI pass or universal subscription eligibility.

No new ranking-quality evaluation, capacity benchmark or exhaustive security scan was run for the subscription feature. It does not establish improved hiring accuracy. The final documentation-only handover rename needs no application test rerun.

Evidence locations (temporary files may be cleaned by the OS):

- `/private/tmp/qumaa-chatgpt-release-knDQbi/`: staged builds, `unit-tests.txt`, `artifact-verification.txt`, container verification logs/scripts, `replacement-summary.json`, and `older-builds/` containing the replaced local builds.
- `/private/tmp/qumaa-chatgpt-build.log`, `/private/tmp/qumaa-chatgpt-smoke.log`, `/private/tmp/qumaa-chatgpt-unit.log`.
- `test-results/app-connects-ChatGPT-separ-e0711-ounts-in-English-and-Arabic/`: English/Arabic settings screenshots.
- `test-results/app-signs-in-through-the-r-a0805--consent-and-usage-recovery/`: English/Arabic consent and usage-limit screenshots.
- `/private/tmp/qumaa-installers-rhryu11j/`: earlier security/UI-only installer verification; superseded by the ChatGPT builds.

## 5. Local installers versus published release

The user asked to overwrite older builds. Both local installers, their blockmaps, `latest.yml`, `latest-mac.yml`, packaged application directories and `SHA256SUMS-v0.1.0-beta.5.txt` were replaced after verification. Existing recruiter guide assets were preserved. The version was not bumped.

| Local installer | Bytes | SHA-256 |
| --- | ---: | --- |
| [macOS arm64](release/Qumaa-0.1.0-beta.5-arm64.dmg) | 233947757 | `194f8f0adc6f3a6369ee3fdc0336c69f3d0efcff84fd93db1598e098c119dd20` |
| [Windows x64](release/Qumaa-0.1.0-beta.5-Setup-x64.exe) | 219672752 | `e91d6800db26bd125b52291f8aad6ee64d74018eacdef0c76f9b9aa3b2c38048` |

The builds contain HEAD plus the uncommitted subscription integration and generated third-party notices. No new commit, push, merge, tag move, release publication or GitHub asset replacement was performed for this feature. The historical public release is [v0.1.0-beta.2](https://github.com/FawazSalehQ/qumaa/releases/tag/v0.1.0-beta.2), last recorded as updated October 11 at `1ac5b984297db9803456103a27897e2289e71d5f`; this handover does not newly query remote release state.

macOS remains ad-hoc signed, not Developer ID signed/notarized. Windows has no Authenticode publisher certificate. Guides/decks predate the new interface and ChatGPT settings; updating them is separate work.

## 6. Product, quality and UI context to preserve

Implemented recruiter workflows include local file/paste/watched-folder intake; companies with multi-entry details; structured saved jobs and Express search inside Jobs; company links, salary ranges and hiring budgets; target-company research; candidate reviews, comparisons and ordered shortlists; contacts, activities, follow-ups, talent pools, pipelines, screening kits and client packs; and saved Hiring Budgets & Costs under Companies. These are working features, not a new backlog. See [FEATURE_IMPLEMENTATION.md](FEATURE_IMPLEMENTATION.md).

Preserve these workflow contracts:

- Intake accepts digital PDF, DOCX, `.md`/`.markdown`, pasted text and watched folders. Multi-column PDF extraction remains heuristic. OCR and dedicated email, job-board, browser-scraping or candidate-upload integrations are absent; a first online intake source has not been selected.
- Saved vacancies have structured fields, statuses `open`, `on-hold`, `filled`, `archived`, dated placement history, a hire and up to two backups. Company assignment is optional; per-person salary ranges and total hiring budgets are independent.
- Express search lives **inside Jobs**, in main-process memory until saved. Saving retains the posting, results and applicable AI ordering without another search. Requirement passages are read-only until saved. Job requirements retain source wording and required/preferred/unspecified importance; assessments distinguish confirmation, uncertainty and contradictory evidence.
- Company details, budgets and target-company research do not silently rewrite postings, affect ranking, enter AI payloads or exclude candidates. Multi-entry industries, locations, contact names and emails use Add/Enter; legacy whole values are not split on commas/slashes. Contact-name and email lists are independent, not paired person records. Hiring companies cannot target themselves; an `excluded` research target does not reject its candidates.
- Recruiter records support manual prospects without CVs, explicit CV linking/merging and preserved history. Logging emails/messages does not send them, and follow-ups are in-app reminders. Client PDF packs support up to ten people, main-owned canonical previews and one-use freshness tokens; internal notes are excluded, while blind mode does not guarantee that narrative evidence is anonymous.
- Hiring Budgets & Costs belongs under **Companies**. Multiple saved plans may link to that company's jobs, but remain separate from job salary/budget fields; linking does not populate salary. Detach linked plans before reassigning a job to another company. The shared engines are `src/shared/hiring-costs.ts` and `hiring-money.ts`; rule changes require explicit compatibility/version decisions for `saudi-hiring-costs-2024-2028-v1` and `saudi-gosi-wage-limits-v1`.

Hiring Budgets & Costs is the narrower, explicitly eligible Saudi monthly planning calculator described in [docs/HIRING-BUDGETS.md](docs/HIRING-BUDGETS.md). Do not infer that its geography/domain limits the recruitment app's scope. Its legal assumptions are dated; this handover is not a fresh legal review.

Matching quality remains unfinished. The active plan is [pilot/CROSS-DOMAIN-QUALITY.md](pilot/CROSS-DOMAIN-QUALITY.md); the September 27 measurements are in [pilot/CROSS-DOMAIN-2026-09-27.md](pilot/CROSS-DOMAIN-2026-09-27.md). Relevant-CV recall@10 was 88.3% in the posting language versus 11.7% in the other language in that synthetic development evaluation. Labels/translations and human recruiter acceptance remain unreviewed. Reserved families have already been inspected; use genuinely fresh held-out data for future acceptance. Do not tune only to F&B/drilling or equate test-suite success with ranking quality.

The frozen synthetic suite contains 96 fictional bilingual careers, 24 vacancies and 12 profession families, with 80 development and 16 reserved evaluation cases; translated exposures are not independent people/vacancies. Small/base/large model benchmarks were completed with inconsistent gains, so the small model remains bundled. Do not repeat that comparison without a new hypothesis. No experimental language-group normalization was deployed. Human pilot materials exist in [pilot/README.md](pilot/README.md), but no human sessions or accepted judgments are recorded. Relevance scores are relative text matches, not probabilities or verified qualifications.

The accepted **Wayfinding** direction draws from Riyadh Metro/KAFD signage while keeping conventional desktop controls. Preserve:

- Brand: IBM Plex families, ink `#2b2733`, violet `#6d3fb0`, paper `#f4f1f8`, funnel mark and RTL lockup. Light, dark and Arabic are peers.
- Identity line tones (`violet`, `blue`, `teal`, `orange`) versus state tones (`green`, `amber`, `red`, `neutral`), controlled by `LineBadge.tsx`.
- Rounded-square identity/stop badges, dot pills for states, mono score boxes; accessible text carries identity, decorative badges are hidden from assistive technology.
- Field labels/eyebrows/table headings: Plex Mono 10.5px/500/uppercase/0.24em. Arabic resets tracking/case and uses Plex Sans Arabic.
- Inline `<bdi>` for short mixed-language identities; `dir="auto"` for prose and inputs; logical spacing and start alignment.
- Depth by tone, restrained shadows, reduced-motion support, inline SVG icons, mirrored directional icons, bundled fonts.
- Stable accessible names/class hooks used by Playwright. Run relevant UI workflows after renderer edits.

Historical baseline and Wayfinding screenshots remain in `docs/ui/`; no revert is requested. Do not discard the renderer changes or delete this branch: it also contains security and subscription work. The historical 1440px pipeline wrapping/1180px density observations and native Arabic copy review remain design follow-up candidates, not authorization for another redesign.

Visible creator attribution stays **Fawaz Aljathnan**, with `https://www.linkedin.com/in/fawazsalehq/`. Package author metadata is separately `Fawaz Alqahtani`.

The English and Arabic recruiter guides are tracked and published, with 24-slide decks, PDFs, screenshots and builders; see [presentations/README.md](presentations/README.md) and [presentations/arabic/README.md](presentations/arabic/README.md). They predate the newest Companies/budget workflows as well as the UI/subscription work. Arabic materials must preserve the English template, use actual Arabic app screenshots and contain no U+2014 em dash in the deck or notes. `presentations/arabic/source/build_guide_ar.py` imports the English builder, so English changes may require translation-dictionary updates. No guide render was performed for this handover.

## 7. Environment and invariants

```bash
export PATH=/Users/fawazalqahtani/.nvm/versions/node/v22.23.2/bin:$PATH
unset ELECTRON_RUN_AS_NODE

npm run build
npm test
npm run smoke
npm run test:ui:built
npm run dev
npm run build:mac
npm run build:win
```

- `ELECTRON_RUN_AS_NODE=1` is inherited by agent shells and must be unset for Electron GUI/smoke tests. A first smoke launch failed for this environment reason; the corrected run passed all 328 checks.
- `npm run dev` normally opens the user's personal library. Tests/screenshots must use throwaway `QUMAA_E2E_USER_DATA` directories and fictional data. Never use real credentials or CVs for automated testing. Qumaa allows one process per data directory; do not assume old dev processes are absent/present without checking.
- `better-sqlite3` uses Electron's ABI. Vitest tests must mock DB imports; real database behavior belongs in Electron smoke tests.
- Keep `sharp`, `npmRebuild: false`, the platform-specific shared file lists and correct native architectures. Model weights remain external to the ASAR. `asar extract-file` writes into the current directory; use a temporary directory or in-memory API to avoid overwriting the source `package.json`.
- Never rename package `name` from `cv-filter`. Existing data lives at `~/Library/Application Support/cv-filter` on macOS and `%APPDATA%\cv-filter` on Windows. Preserve schema/migration safeguards and original CV files during wipe/restore.
- Portable backups contain candidate/recruiting data and are **not encrypted**. They exclude credentials, local resume paths, watched-folder configuration and window state. Restore discards saved search snapshots, rebuilds FTS and re-embeds retained text. Older incompatible builds cannot open upgraded schemas; do not advise downgrading an upgraded library.
- `getJob()` creates a fresh search-session ID on each read. Normalize that ephemeral ID or compare persisted records in tests; a changed session ID alone is not a database mutation.
- `src/main/embed/protocol.ts` owns model identity and **both** `query: ` / `passage: ` prefixes. A model change forces reindexing; vectors from different models cannot mix.
- Runtime remote model loading is disabled; bundled model files are pinned and hash-verified. Main owns SQLite, ingestion and matching; inference runs in a utility process and PDF extraction uses a worker.
- `scoring.ts` stays pure. Weights are semantic 0.55, lexical 0.20, skills 0.25; section weights experience/projects/other 1, skills/education 0.92, summary 0.88. Weight changes require both tests and ranking eval, with cross-domain/bilingual evaluation for broad claims.
- Ranking must never use evaluation filenames as relevance evidence. The 162-entry skills dictionary has limited coverage; unknown terminology never proves a missing qualification.
- Parser/cache changes must advance derivation version and reach existing libraries behind readiness while retaining identities/recruiter records. Current version is `3:bounded-text-parsing`.
- API-key status checks and ChatGPT status reads must not decrypt secrets on startup. Renderer stays sandboxed, isolated and without Node/direct IPC access.
- Arabic dates retain Gregorian behavior (`ar-SA-u-ca-gregory`). Accept Arabic/Persian digits and store canonical numbers; preserve bidi isolation and directional controls rather than stripping them indiscriminately. Export fonts remain bundled for offline use.
- Rebuild installers after source changes before claiming artifact parity. NSIS script edits need a deliberate failing positive control; compressed-string searches prove nothing.

## 8. Working tree and local-only files

At the handover, the uncommitted feature affects 33 tracked files plus the new source/test files listed above. Inspect `git status --short` and the actual diff; counts can change. `THIRD-PARTY-NOTICES.md` now includes both the previously generated Electron patch update and the newly bundled JOSE license. Its generated `License: MIT  ` line uses a Markdown hard break and is the sole noted `git diff --check` whitespace report; scoped source checks passed.

Preserve these intentional local artifacts and do not blindly `git add .`:

- `handover.md` — the single current handover, including useful prior project context.
- `cv_filter.code-workspace` and `eval/posting.txt` (the latter lacks confirmed synthetic provenance).
- `.impeccable/mocks/`, `.impeccable/questions/`, `.impeccable/review/`, and `docs/ui/` screenshots/specs.
- Ignored `out/`, `release/`, model weights, local corpora and generated test results.

This handover consolidation does not alter application source, builds or Git history. The older handover document was removed at the user's request; retain only `handover.md`. No new application tests were needed for this documentation-only update.

## 9. Continuing in Claude

First establish the live branch/status and read the source relevant to the user's next request. The most immediate verification gap is a real eligible ChatGPT sign-in and a controlled real request with the user, plus execution of this new build on Windows. Do not spend their allowance, access real candidate data, publish artifacts or commit the integration merely because this document mentions those gaps. The user has not requested further work beyond this handover.

If asked to commit later, stage only the feature source/tests/docs and required new files; keep the local artifacts separate. If asked to publish later, retain the deliberate beta.2 release-name decision unless the user changes it, and rebuild/verify the exact source being published. Historical CI and release hashes do not validate a new commit.

Suggested opening prompt:

> Continue work on Qumaa. Read handover.md, AGENTS.md and Git status first. We are on ui-modernize: UI commit 1f9db63 and security commit e28dce5 are pushed; the ChatGPT subscription/API integration is implemented but uncommitted. Local beta.5 installers include it and were replaced, but GitHub release assets were not updated. Final checks passed 676 unit tests, 328 Electron checks and 31 macOS UI workflows, plus two packaged ChatGPT workflows with simulated provider responses. Live subscriber access and this build on Windows remain unverified. Preserve the all-domain bilingual scope, Wayfinding UI, cv-filter data identity, protected credential/consent and ranking invariants, and local-only files. My next task is: [state the task].
