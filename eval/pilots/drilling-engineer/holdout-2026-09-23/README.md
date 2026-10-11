# Drilling-engineer bilingual holdout packet

Authored on 2026-09-23. This packet is a synthetic evaluation fixture for a broad well-planning and drilling-engineering posting. It contains no real applicants, employment records or contact details. Employer names, career histories and project counts are invented. No protected attributes are specified or inferred.

## Contents

- `posting.en.txt` and `posting.ar.txt`: equivalent English and Arabic versions of one posting, requiring at least five years of relevant engineering experience and evidence across planning and operations.
- `corpus/H01.md` through `corpus/H12.md`: 12 neutral-ID resumes representing six distinct fictional careers. Each career appears once in English and once in Arabic.
- `labels.json`: evaluator-only mapping from resume basename to provisional integer tier, where 1 is the strongest intended fit and 4 the most distant intended fit.
- `facilitator-only.md`: pairing, language subsets, label rationale, evaluation cautions and review instructions. Keep this document outside the ingestion input.
- `sources.md`: primary engineering references consulted for terminology and plausibility, outside the ingestion input.
- `SHA256SUMS`: pre-evaluation hashes of every other authored file in this packet, using paths relative to this directory.

Only the 12 files under `corpus/` are resume inputs. The posting, labels, pairing, rationale, references and this README are not resume inputs. Filenames are neutral identifiers and must not supply ranking features.

## Paired construction

Each translation pair preserves employers, date ranges, job scope, education, tools and numerical claims. The prose was written for this packet, with Arabic versions expressing the same career facts in professional Arabic. IDs differ within a pair so the corpus does not embed a language or suitability cue in filenames. English software acronyms and fictional employer names may remain in Latin characters in Arabic resumes.

There are three broad well-engineering careers, one drilling-fluids career, one reservoir-engineering career and one civil/structural-foundations career. Thus there are only six distinct profiles, not 12 independent people. Pair mapping and exact language subsets are in the facilitator document.

For controlled language comparisons, use a single language version of each career per retrieval run: six resumes and three intended tier-1 careers. The equivalent postings support English-to-English, Arabic-to-English, English-to-Arabic and Arabic-to-Arabic runs. Pooling all 12 resumes creates translated duplicate identities and can change top-k results; if a mixed corpus is tested, report that condition separately and account for pairing.

## Label status and limitations

The labels and rationales are agent-authored, provisional judgments that need human validation by a bilingual reviewer with relevant engineering expertise. They are not verified ground truth, hiring recommendations, credential checks or a measure of real applicant quality. No certification or employment-standard requirement is asserted.

The author knew the target role and requested tier composition. The author did not inspect production ranking or skills code, other pilot resumes, labels or results, and did not run matching. That separation limits direct result-driven tailoring; it does not make agent-authored prose or labels independent human evidence. Similar writing style, explicit work evidence and deliberate coverage can make the task easier than real resumes.

The small, balanced set has limited role and writing-style coverage. It cannot establish general ranking quality, fairness or robustness. Human translation review remains necessary. Markdown text does not test PDF extraction, DOCX extraction, OCR, layout or corrupted input. Subtle degrees of fit within a tier are intentionally unspecified; a particular ordering among the three broad careers is not required by these labels.

## Freeze and results status

This authored packet is frozen before any matching results are shared. No matching was run by the author and no evaluation results are included at freeze time. `SHA256SUMS` excludes only itself; record its own SHA-256 hash with any subsequent run record. Verify the manifest before evaluating and preserve it with the reported results.

Human validation and any corrections should be documented as a new packet revision with a new manifest. Do not silently revise this frozen corpus or labels after viewing scores. Store generated results outside this packet so the pre-evaluation artifact remains reviewable.
