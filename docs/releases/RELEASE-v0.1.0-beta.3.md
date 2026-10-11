# Qumaa 0.1.0-beta.3 — local build, 2026-09-27

These installers include the current working-tree source, including the company
and recruiter workflows, September 23 extraction changes, and September 27
cross-domain requirement/evidence work. They retain the existing `cv-filter`
library location. No release was published or tagged.

## Changes

- Editable job requirements with original source wording and explicit required,
  preferred or unspecified importance. Arbitrary specialist terminology works
  without first changing the built-in skills dictionary.
- Local multilingual nearest-passage suggestions in saved and Express jobs.
  Suggestions require review; saved scorecards support contradictory evidence.
  Missing text never automatically disqualifies a candidate.
- Imported source clauses are not counted twice in ranking queries. Existing
  saved matches become stale and can be refreshed while retaining decisions.
- Candidate copy distinguishes relative text similarity and recognized terms
  from verified qualifications. No perfect skills bar for zero recognized terms.
- Arabic/Markdown section recognition, corrected employment-date and location
  parsing, Unicode lexical queries and the previous reviewed vocabulary additions.
- Evaluation/smoke entry points and their unused helper chunks are excluded from
  installers. No evaluation corpus or alternative benchmark model is bundled.

## Upgrade

Schema 10 retains existing recruiter data while adding requirement source and
assessment fields. Older applications cannot open the upgraded schema. Existing
libraries rebuild derived CV fields/passages from retained text when necessary;
the library's CV identities, recruiter corrections and histories are retained.
Saved matches and cached AI order require refresh after relevant version changes.
The bundled embedding model remains multilingual-e5-small.

## Files

- `Qumaa-0.1.0-beta.3-arm64.dmg`: macOS Apple Silicon.
- `Qumaa-0.1.0-beta.3-Setup-x64.exe`: Windows x64.
- `SHA256SUMS-v0.1.0-beta.3.txt`: checksums for installers and blockmaps.

The existing PDF/PowerPoint recruiter guides remain unchanged and predate these
workflows. Local superseded installers were removed after replacement builds.

## Verification

- Production build, 503 unit tests and 261 Electron integration checks passed.
- All 24 source UI workflows passed: 23 in the full run, then the remaining
  complete workflow after updating its stale expected passage label.
- The two new English/Arabic requirement workflows passed in the final packaged
  Mac app, including persistence and Express search. Layouts were inspected.
- The mounted DMG's 443 regular app files match the tested package. Disk-image
  integrity and the app's ad-hoc signature passed verification.
- The extracted Windows NSIS payload's 252 files match `win-unpacked`.
  Windows runtime behavior was not tested on this Mac.
- Both archives contain 54 current production application files, matching the
  build. Relative runtime imports resolve after removing development helpers.
  Each archive is about 33.6 MiB and does not duplicate model weights.
- Both bundled model trees match all five pinned manifest hashes. Five macOS
  arm64 and nine Windows x64 native binaries have the correct architecture.
- Installer metadata hashes/sizes and the SHA-256 manifest match the artifacts.

Tests used disposable profiles. No personal library or API keys were bundled,
and no live provider requests were required. The Mac app is ad-hoc signed,
without Developer ID notarization; the Windows installer has no publisher
certificate.

## Matching quality remains open

The new synthetic baseline covers 12 profession families, 96 bilingual fictional
careers and 24 vacancies. Development recall@10 is 49.8%; relevant CVs in the
other language are substantially harder to retrieve. Larger offline models gave
modest, uneven improvements at higher storage/runtime cost, so the small model
remains. Passing software checks does not establish hiring accuracy across all
professions. Independent recruiter/translation review and better cross-language
retrieval remain necessary. See the
[quality report](../../pilot/CROSS-DOMAIN-2026-09-27.md) and [roadmap](../ROADMAP.md).
