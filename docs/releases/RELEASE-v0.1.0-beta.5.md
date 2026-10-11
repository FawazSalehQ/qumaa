# Qumaa 0.1.0-beta.5 — local build, 2026-10-04

**Companies → select a company → Hiring Budgets & Costs** now supports saved
employment-cost plans, optionally linked to a job belonging to that company.
Enter basic, housing and fixed transport, or split a combined basic/housing
amount using editable percentages. Salary amounts start blank.

The shared calculation engine provides existing/new GOSI comparison, effective
rates, employee deductions and estimated take-home pay, separate contribution
and end-of-service wage bases, EOS provision, headcount totals, approved-budget
variance, annualised selected-month costs and actual-period monthly forecasts.
Inputs, notes, overrides and calculation versions persist locally and are included
in portable backups. English/Arabic CSV exports use the same canonical engine.

Estimates cover full calendar months and exclude medical insurance and other
cost items. The new-scheme transition month of July 2024 is unavailable in this
full-month planner; August 2024 is its first supported full month. Scheme
classification requires contribution-history review. The configured minimum
contribution wage remains reviewable. See the [budgeting guide](../HIRING-BUDGETS.md)
for formulas, official sources and assumptions.

Existing job salary ranges and hiring budgets remain independent. Schema 12 adds
bounded, referentially checked cost-plan records while preserving company/job
identities and recruiting history. Older builds cannot open a schema-12 library;
use beta.5 or a newer compatible build after upgrading. The existing `cv-filter`
library location is unchanged.

## Files

- `Qumaa-0.1.0-beta.5-arm64.dmg`: macOS Apple Silicon.
- `Qumaa-0.1.0-beta.5-Setup-x64.exe`: Windows x64.
- `SHA256SUMS-v0.1.0-beta.5.txt`: installer and blockmap checksums.

## Verification

- Production build and all 547 unit tests passed, including effective-date
  boundaries, rounding, salary splits, wage limits, overrides, reconciliations,
  EOS service transitions, monthly forecasts and localized money formatting.
- All 289 Electron integration checks passed, including schema 11→12 upgrade,
  stable recruiter records, stale-edit rejection, job/company references,
  restart persistence, portable backup/restore and complete wipe.
- All 29 source UI workflows passed: 28 in the full suite, then all three budget
  workflows (including the additional validation test) after final UI adjustments.
- All seven company and hiring-budget workflows passed in the packaged Mac app.
  Checks cover English/Arabic entry, scheme comparison, job isolation, restart,
  editing/cancellation, native CSV export, required inputs, split validation,
  registered wage justification, EOS component selection and the fifth anniversary.
  English and Arabic layouts were visually inspected.
- Both app archives contain 56 current production files, matching the build
  byte-for-byte, with all 145 relative main-process imports resolved. Development
  helpers and model weights are excluded from the archives; each archive is
  about 33.87 MiB. All five external model files match the pinned manifest.
- DMG integrity and strict deep ad-hoc signature checks passed. All 443 regular
  files and 14 symlink targets in its mounted app match the tested Mac bundle.
- All 252 regular files in the extracted Windows installer payload match the
  Windows package. Windows runtime testing remains pending.
- Installer metadata sizes/SHA-512 hashes and all four SHA-256 checksums match.

Tests used disposable libraries. The Mac app is ad-hoc signed without Developer
ID notarization; the Windows installer has no publisher certificate. The October 4 local verification preceded publication. On October 11, this
build replaces the assets of the existing `v0.1.0-beta.2` GitHub release; the
release title and URL are retained, while the application version is beta.5. Matching scores and the bundled model are unchanged;
[cross-domain matching limitations](../../pilot/CROSS-DOMAIN-2026-09-27.md) remain.
