# Qumaa 0.1.0-beta.2 — local rebuild, 2026-09-22

These installers contain the current audited working-tree source, including the
company and recruiter workflows. They replace the earlier local installers while
retaining version 0.1.0-beta.2 and the existing `cv-filter` library location.
This local rebuild has not been published or tagged on GitHub.

## Included changes

- Company workspaces, company-specific jobs, target-company research maps, salary
  ranges and independent total hiring-budget ranges.
- Recruiter desk with contacts and prospects without CVs, CV linking/merging,
  contact history, follow-up reminders, manual talent pools and saved searches.
- Job pipelines, dated client submissions/feedback, screening-call kits and
  explicitly selected client presentation PDFs.
- Audit fixes for screening cancellation and fresh follow-up kits, saved-search
  review tracking, stale client-pack selections, cleared contact fields and large
  contact-history merges. Unused legacy APIs, styles and helpers were removed.
- English and Arabic interfaces, portable backup/restore, and existing matching,
  saved-job, Express search, review, shortlist and optional AI workflows.

## Files

| File | Purpose |
| --- | --- |
| Qumaa-0.1.0-beta.2-arm64.dmg | macOS installer for Apple Silicon |
| Qumaa-0.1.0-beta.2-Setup-x64.exe | Windows x64 installer |
| SHA256SUMS-v0.1.0-beta.2.txt | Current SHA-256 checksums for both installers and the four existing guide files |

The existing English/Arabic PDF and PowerPoint guides were retained unchanged.
They predate this rebuild and do not yet document the new recruiter workflows.

## Verification

- Audited source: production build, 434 unit tests, 234 Electron smoke checks and
  all 22 development UI workflows passed on macOS using disposable libraries.
- Packaged macOS app: all 22 UI workflows passed in one run.
- DMG: checksum and mounted application signature verified; all 443 regular app
  files match the tested package.
- Windows installer: extracted NSIS payload; all 252 files match `win-unpacked`.
  Windows runtime behavior was not tested in this local macOS rebuild.
- Both archives contain 51 production application files, all matching the current
  build and each other. Each archive is approximately 33.6 MiB, with no duplicated
  model weights, development entrypoints, pilot data or personal library.
- Both model trees match all five manifest files and hashes. Native dependencies
  have the correct architectures: five macOS arm64 and nine Windows x64 binaries.
- Installer metadata SHA-512/size values and the refreshed SHA-256 manifest match
  the actual release files.

The macOS app has an ad-hoc signature; no Developer ID notarization was performed.
The Windows installer has no publisher certificate. Optional AI requests were
mocked in tests; no live provider calls were made. No personal library or API key
is bundled.
