# Qumaa 0.1.0-beta.4 — local build, 2026-10-03

Company industries, locations, contact names and contact emails now support
multiple entries. Type a detail and click **Add** or press Enter; use the **×**
beside an entry to remove it. Saving includes any valid pending text, while
Cancel discards draft edits. Duplicate entries are prevented and new email
entries are validated. Contact names and emails are independent lists.

All entries are visible in company details and searchable in the directory.
Linked-job context and target-company maps display multiple industries and
locations. English and Arabic interfaces support the complete workflow.

Schema 11 reads existing single-value company records as individual entries.
It does not split commas/slashes or rewrite legacy records during migration.
Company identities, timestamps, linked jobs and recruiting history are retained.
Older builds cannot open a schema-11 library; use beta.4 or a newer compatible
build after upgrading. The existing `cv-filter` library location is unchanged.

## Files

- `Qumaa-0.1.0-beta.4-arm64.dmg`: macOS Apple Silicon.
- `Qumaa-0.1.0-beta.4-Setup-x64.exe`: Windows x64.
- `SHA256SUMS-v0.1.0-beta.4.txt`: installer and blockmap checksums.

## Verification

- Production build and all 507 unit tests passed.
- All 268 Electron integration checks passed, including raw legacy company
  upgrades, multiple values, stable job links and portable backup/restore.
- All 26 source UI workflows passed. The first run passed 13; the remaining
  13 initially could not launch because of an inherited Electron Node-only flag,
  then passed with that flag cleared.
- All four company UI workflows passed in the packaged macOS app, covering
  English/Arabic Add/Enter/remove controls, duplicates, email validation,
  pending-text saves, cancellation, secondary-value search, restart persistence,
  linked jobs, independent budgets and target-company research. Layouts inspected.
- Both packaged archives contain 54 current production files matching the build;
  relative runtime imports resolve and development helpers are excluded. Each
  archive is about 33.6 MiB. All five bundled model hashes match the pinned manifest.
- The mounted DMG matches all 443 regular files in the tested Mac app; image
  integrity and ad-hoc signature checks passed. The extracted Windows installer
  payload matches all 252 files in the Windows package. Windows runtime testing
  remains pending.
- Installer metadata sizes/hashes and SHA-256 checksums match the artifacts.

Verification used disposable libraries. No personal library or API keys are
bundled. The Mac app is ad-hoc signed without Developer ID notarization; the
Windows installer has no publisher certificate. No release was published or tagged.

This update does not change matching scores or the bundled model. The existing
[cross-domain matching limitations](../../pilot/CROSS-DOMAIN-2026-09-27.md) remain.
