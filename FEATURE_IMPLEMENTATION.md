# Recruiter workflow implementation

Qumaa keeps the CV library, recruiting records, and matching on this computer.
The existing matching engine remains the basis for candidate discovery.
All six feature groups below are implemented.

## Integration order

1. **Express search and saved jobs:** paste a job description and requirements
   into **Express search**, beside **New job**, and find relevant CVs without
   saving. Inspect the results, optionally rerank with a selected AI model or export the top
   three, then discard the search or explicitly choose **Save as job**.
   Saving retains the exact posting, criteria, results, and any AI order and
   reasons without another search. Saved jobs retain status and last search;
   open, pause, fill, or archive them and return after restarting. Creation and
   each status change have timestamps. Filling a job requires a selected hired
   candidate, with optional backups in slots #2 and #3 and linked CV evidence.
   Mark previous
   matches stale when the library changes; preserve recruiter decisions.
2. **Review and shortlist:** record a job-specific review state and notes for each
   candidate. Choose and reorder the shortlist. Export chosen candidates to PDF
   or Excel-compatible CSV, including recruiter notes.
3. **Requirements scorecard:** edit required/preferred criteria, inspect suggested
   source passages, and record evidence found, clarification needed, not stated,
   or recruiter confirmation. Missing text never triggers automatic rejection.
4. **Candidate profiles:** retain CV extraction and recruiter corrections
   separately. Store salary expectations, notice period, availability, preferred
   location, tags, and notes. Filter candidates using the corrected profiles.
5. **Comparison:** compare two to four candidates against the same criteria,
   source evidence, screening details, and notes.
6. **History and rediscovery:** explicitly link or separate CV versions while
   retaining candidate reviews. Show new CV counts for saved jobs and refresh
   matches to rediscover candidates in the existing library.

## Storage and application flow

- Schema v4 adds a recruiting-record table to the existing SQLite database.
  Schema v5 extends its saved-search JSON with optional Claude order and reasons;
  schema v6 adds optional status history and hiring records. Older jobs retain
  their creation dates without inventing dates for unrecorded status changes.
  Schema v7 adds provider/model attribution to saved AI rankings; old Claude
  rankings retain their Sonnet 5 attribution.
- Jobs, recruiter profiles, reviews, and bounded search snapshots use
  validated main-process APIs. Keep content-bound resume identities.
- **Jobs** is the single matching workspace for express searches and saved
  jobs. Both use the same local matching engine and optional AI reranking.
- A temporary posting and result snapshot are owned by the main process and
  held in memory. They do not create SQLite job or snapshot records until the
  user explicitly saves, and posting text is not written to renderer localStorage.
  Only one temporary search is retained at a time;
  discarding it or quitting the app removes it.
- **Express search** sits beside **New job** and opens a simple form with two
  text areas for the job description and requirements. **Find matches** searches
  the existing CV library. **New job** opens the full editor and saves the job
  before matching.
- Express results offer **Edit search**, **Save as job**, **Discard search**,
  top-three PDF export, and optional AI reranking in the same Jobs workspace.
  The **Express search** badge and **Open express search** sidebar entry identify
  the current unsaved search separately from the saved-job list.
- Saving a temporary search stores its exact results, including AI order
  and reasons, without matching or reranking again. Save before recording persistent
  job reviews or choosing a shortlist.
- Saved jobs have a dedicated **Change status** action and dated history. New
  jobs start Open; saving Express results starts their history at the save time.
  **Filled** requires a hire selected from the library, with at most two optional
  backups (#2 and #3). A candidate's linked CV versions cannot occupy multiple
  slots. Updating hiring selections records a separate hiring-details event.
  The previous hiring outcome remains visible after archiving or reopening.
  Deleting a selected CV removes its name and identity from hiring records while
  preserving the status dates. Legacy Filled jobs can add missing hiring details.
- AI order, provider/model, and reasons persist with saved results when a job is reopened or
  the app restarts. Refreshing local matches resets the rerank while retaining
  recruiter reviews and the chosen shortlist.
- **File → New Job** (`Cmd/Ctrl+N`) opens the job editor. `Cmd/Ctrl+1`,
  `Cmd/Ctrl+2`, and `Cmd/Ctrl+3` open Jobs, Library, and Settings.
- Backups include recruiter-authored records. Search snapshots are discarded
  during portable backup/restore and regenerated from the restored CV library;
  their saved AI order and reasons are discarded with them.
- Full deletion clears recruiting records as well as the CV library and settings.
- Preserve bilingual matching, the current model and tuned ranking weights.
  Optional AI reranking uses the selected provider's key and enablement in Settings,
  with the data summary reviewed in Jobs on first use of each provider/model or after consent is reset.
  An eye icon labelled **See exported data** expands the exact outbound request;
  it starts collapsed each time the notice opens. Every send requires native confirmation.
- **Settings → AI reranking** offers Anthropic (Sonnet 5, Opus 5, Fable 5.1) and
  OpenAI (GPT-4o mini, GPT-5.6, GPT-6 Astra). Provider-specific protected keys and
  selected models remain independent. Existing installations default to Sonnet 5;
  choosing a provider without its own key disables reranking. Saving a key never
  automatically enables it. Keys and sharing preferences are excluded from backups.
- The rerank button names the selected model. Saved results identify the model
  that actually produced their order, and a different model can rerank the same
  candidates without refreshing matches. Native confirmation names both provider
  and model. Switching provider/model, changing credentials, or resetting consent
  invalidates pending approval while keeping local matches available.
- Anthropic uses its Messages API; OpenAI uses Responses with `store: false`.
  Both send the exact reviewed request to a fixed provider endpoint. Calls have
  bounded output/time limits, no automatic retries or provider fallback, and
  sanitized errors. Refused or incomplete responses leave existing results intact.

## UI work

Use the existing Qumaa colours and fonts, consistent controls, clear empty and
loading states, responsive forms and tables, and visible keyboard focus.
Place **Fawaz Aljathnan** and a clickable LinkedIn icon at the bottom of Settings.
The icon opens `https://www.linkedin.com/in/fawazsalehq/` in the system browser only when
clicked.

## Main implementation files

- `src/main/recruiting/`: persistence, validation, evidence, and version rules.
- `src/shared/recruiting.ts` and `src/main/recruiting-ipc.ts`: typed API contract.
- `src/renderer/src/views/JobsView.tsx`: jobs, reviews, shortlists, and comparison.
- `src/renderer/src/components/RecruiterProfile.tsx`: corrections and CV history.
- `src/main/export/`: PDF and Excel-compatible CSV generation.

## Verification

The Express search, job-status, and provider/model updates were verified on
2026-09-12: build, 378 unit tests, the Electron smoke suite, and all 14 packaged
UI workflows passed. The tests cover Express search's
dedicated entry, two-field form, relevant matching without automatic saving,
editing, discard, explicit promotion, provider/model consent, and saved-job workflows.
Status checks cover creation and transition timestamps, required hires, optional
distinct backups, hiring updates, and posting edits preserving recorded decisions.
Provider checks cover all six models, separate keys and remembered model choices,
exact OpenAI request/preview equality, switching models without rematching, and
persisted attribution. English and Arabic search, hiring, history, settings, and
consent screens were inspected. Real API calls were not made; provider responses
and credentials were synthetic test fixtures.

The updated local macOS arm64 installer keeps the requested original filename,
`Qumaa-0.1.0-beta.2-arm64.dmg`, and replaces the earlier installer. Its bundle
signature, DMG checksum, version metadata, Express search, status/hiring, and all
six provider/model contents, schema 7, and 33 MiB
app archive were verified. Packaged UI tests use disposable data and mocked
provider responses.

- Unit tests: input validation, review/profile rules, CSV escaping, saved rerank
  ordering, and native consent with stale-request rejection. Temporary-search
  tests cover isolated memory state, newer-request generations, discard, and
  removal of deleted CV identities and reasons.
  Status tests cover hiring-slot validation, legacy history, consistent dates,
  bounded history, identity scrubbing, and unchanged hiring selections.
  Provider tests cover all six exact request bodies, redaction, credential isolation,
  strict model/provider validation, response limits, refusals and incomplete outputs,
  empty/invented rankings, and settings or credential changes during consent.
- Electron smoke: schema upgrade, persistence, search refresh, version linking,
  backup/restore, deletion, saved AI order/reasons, and independent shortlist order.
  Temporary-search checks cover no job or snapshot writes before saving,
  exact full-snapshot promotion beyond the 50-result consent cache, capacity
  rollback, canonical top-three export, and local save/export after rerank
  session expiry. They also cover generation guards and restore/wipe cleanup.
  Status checks exercise honest legacy dates, stale-dialog rejection, linked-CV
  duplicate prevention, unchanged ranking and reviews, restart/restore persistence,
  and deletion of private hiring identities while retaining decision dates.
  Provider attribution survives Express promotion and restart; local refresh
  clears it. Portable backup/restore excludes both API keys and sharing settings.
- UI tests: save/reopen a job, review and compare candidates, export a shortlist,
  edit a profile, and open the creator link through the fixed browser action.
  A mocked Claude response verifies consent, persistence, shortlist preservation,
  and display refresh after a duplicate import interrupts an in-flight request.
  Temporary-search flows cover editing, navigation across tabs, PDF export,
  explicit save/discard, and preservation of rerank order when saved.
  Hiring flows cover dated creation/status changes, hire-only decisions, adding
  backups #2/#3, source CV access, posting edits, reload, and Arabic presentation.
  Provider flows cover six selectable models, key separation, saved preferences,
  OpenAI exact-request consent, a second model on the same matches, and honest
  model labels in result headers and beside candidate explanations.

OCR remains planned separately.
