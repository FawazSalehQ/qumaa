# Recruiter workflow implementation

Qumaa keeps the CV library, recruiting records, and matching on this computer.
The existing matching engine remains the basis for candidate discovery.
All six feature groups below are implemented.

## Integration order

1. **Saved jobs:** store the posting, job status, criteria, and last search. Open,
   pause, fill, or archive a job and return to it after restarting. Mark previous
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
- Jobs, recruiter profiles, reviews, and bounded search snapshots use
  validated main-process APIs. Keep content-bound resume identities.
- Open **Jobs** for the persistent workflow or **Match** for a quick search.
- Backups include recruiter-authored records. Search snapshots are discarded
  during portable backup/restore and regenerated from the restored CV library.
- Full deletion clears recruiting records as well as the CV library and settings.
- Preserve bilingual matching, the current model and tuned ranking weights, and
  the existing optional Claude consent flow.

## UI work

Use the existing Qumaa colours and fonts, consistent controls, clear empty and
loading states, responsive forms and tables, and visible keyboard focus.
Place **Fawaz Aljathnan** and a clickable LinkedIn icon at the bottom of Settings.
The icon opens `https://linkedin.com/fawazsalehq` in the system browser only when
clicked.

## Main implementation files

- `src/main/recruiting/`: persistence, validation, evidence, and version rules.
- `src/shared/recruiting.ts` and `src/main/recruiting-ipc.ts`: typed API contract.
- `src/renderer/src/views/JobsView.tsx`: jobs, reviews, shortlists, and comparison.
- `src/renderer/src/components/RecruiterProfile.tsx`: corrections and CV history.
- `src/main/export/`: PDF and Excel-compatible CSV generation.

## Verification

Verified on 2026-09-06: build, model integrity, 256 logic tests, Electron smoke,
and 9 UI tests pass. Primary views were inspected in light and dark themes.

- Pure tests: input validation, review/profile rules, and CSV escaping.
- Electron smoke: schema upgrade, persistence, search refresh, version linking,
  backup/restore, and deletion.
- UI tests: save/reopen a job, review and compare candidates, export a shortlist,
  edit a profile, and open the creator link through the fixed browser action.
- Build and visually inspect the primary views in light and dark themes.

OCR remains planned separately.
