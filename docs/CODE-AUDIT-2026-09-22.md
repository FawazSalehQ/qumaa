# Code audit — 2026-09-22

Reviewed the current development source for the company and recruiter workflows,
their renderer/preload/main integration, record persistence, export selection,
backup/restore and deletion. This was a functional code audit with regression
testing and a reference-based cleanup of obsolete scaffolding.

## Findings fixed

- **Cleared contact fields resurfaced in client packs.** Export fell back to old
  profile values when the canonical contact's email, phone or availability was
  blank. A cleared contact field now stays blank. A pure export regression covers
  all three fields.
- **Client-pack choices became stale across views.** Returning after contact or
  pipeline changes now refreshes available people and evidence without discarding
  authored recommendations. Unavailable selections stay visible for explicit
  removal, and preview is blocked until resolved. A UI regression covers changes
  made in Recruiter desk while a presentation remains open.
- **Screening preparation reused an earlier call.** Explicit preparation now
  creates a fresh kit while preserving previous answers. Cancelling a newly
  prepared kit removes its draft; cancelling edits preserves the saved screening.
  Saved screenings can be deleted with confirmation. Smoke and English/Arabic UI
  regressions cover these transitions.
- **Saved searches missed older contacts who newly matched.** Review now stores
  the matching membership snapshot. A skill edit or newly linked CV can therefore
  make an existing prospect new since review. Descriptive edits preserve the
  snapshot; changes to search criteria reset it. Pure and database tests cover
  these cases. Earlier development records without a snapshot show their current
  matches as new until reviewed again.
- **Contact merges repeatedly rescanned storage.** Related records are now
  validated and written in batches within the existing transaction. Batch limits
  follow each record kind's actual capacity. Integration checks merge 5,001
  activity records and verify complete rollback when a merge exceeds a limit.
- **Data-management copy omitted newer records.** English and Arabic backup and
  delete-all descriptions now include companies, contacts and recruiting records.

## Obsolete scaffolding removed

- The unused `window.api.search` surface, four legacy search IPC channels and
  handlers, their separate session, and exclusive validation helpers. Current
  Express search and saved-job matching/reranking/export retain their canonical
  recruiting APIs and regression coverage.
- Legacy posting/results/candidate-card CSS with no renderer references.
- The duplicate posting formatter, unused activity-delete API, unused single-person
  pool helper, and unused type re-exports. Formatter tests exercise the production
  posting formatter directly.

Reference checks found no whole source file safe to remove. Active seed, smoke,
benchmark, evaluation and pilot tooling remains in place.

## Verification

All checks used Node 22 and the local macOS development build:

- Production build and both TypeScript checks: passed.
- Vitest: **434 tests across 49 files passed**.
- Electron smoke: **234 checks passed**, including restart, backup/restore,
  referential validation, rollback, deletion and wipe.
- Playwright/Electron: **22 workflows passed in one run** using disposable data,
  including English/Arabic workflows and actual client PDF export.
- `git diff --check`: passed.

Matching scores and ranking evidence remain unchanged in the integration checks.
The ranking model and scoring weights were not changed. Windows runtime and real
provider API calls were not exercised in this audit.

Subsequent release build on the same date: both local installers were rebuilt,
and all 22 UI workflows passed against the packaged macOS app. DMG integrity,
packaged payloads, model hashes, native architectures and release checksums were
verified. See the local [release notes](releases/RELEASE-v0.1.0-beta.2.md).
