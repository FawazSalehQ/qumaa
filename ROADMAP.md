# Qumaa roadmap

Updated 19 October 2026. Companies, company-linked jobs, salary and total
hiring budgets, target-company maps, recruiter contacts, follow-ups, talent
pools, pipelines, submissions, screening kits and client packs are implemented.
OCR is outside scope.

Since 11 October: the Wayfinding UI redesign was accepted; document parsing,
backup validation and date handling were hardened; Sign in with ChatGPT lets an
eligible subscription rerank candidates alongside API keys; CI runs the full
suite, including the packaged app, on macOS arm64 and Windows x64; and a full
code review on 19 October removed dead code, merged duplicated logic and fixed
nine ingest, backup and export defects.

Company industries, locations, contact names and contact emails now support
multiple entries with Add/Enter and individual remove controls. Existing details
and company/job links are retained; English/Arabic workflows and backup/restore
are verified. This is a workflow improvement; the matching-quality results below
remain the September 27 measurements.

Companies now also provide saved Hiring Budgets & Costs plans: salary components,
GOSI scheme comparison, EOS provision, monthly forecasts, headcount, approved
budget variance and English/Arabic CSV exports. Estimates cover full months and
exclude medical insurance. [Calculation scope and sources](docs/HIRING-BUDGETS.md).

**Product scope is hiring across all domains.** The existing F&B and drilling
corpora are regression checks within that scope. Their results do not establish
quality for other professions. The first
[cross-domain implementation](pilot/CROSS-DOMAIN-2026-09-27.md) is complete:
editable vacancy requirements with source wording, multilingual passage
suggestions, explicit recruiter assessments, and a frozen evaluation covering
12 profession families. Broad matching quality remains an open milestone.

| Order | Milestone | Current status | Completion evidence still needed |
| --- | --- | --- | --- |
| 1 | Matching and extraction quality across domains | Requirements/evidence workflows verified; 96 synthetic evaluation cases expose substantial cross-language recall gaps. | Independent review of requirements, translations and candidate relevance; better cross-language retrieval without regressions by profession; fresh held-out examples. |
| 2 | Recruiter pilot | Blind relevance protocol and expanded workflow packet prepared; no human sessions recorded. | Recruiter judgments, observed task outcomes, platform/format coverage, fixes and retests. |
| 3 | Release readiness | Installers rebuilt 19 October from `96fb54f` and published to the `v0.1.0-beta.2` release with minimum requirements; CI runs all 31 UI workflows on the packaged app on macOS arm64 and Windows x64. | A human install of the Windows installer, the native Arabic review, and closure of relevant quality/pilot findings. |
| 4 | Online resume intake | Source choice pending: email attachments, candidate upload form or recruitment-platform exports. | Choose one first source; define explicit import, source tracking, duplicate handling and review before implementing its adapter. |

## Current milestone: quality

Implemented Arabic/Markdown section recognition, Arabic place-name boundaries,
employment-date parsing correction, nine drilling skill concepts with Arabic
aliases, and Unicode lexical queries. Existing libraries automatically rebuild
derived fields and passages from retained text. Interrupted rebuilds retry;
CV identities, recruiter corrections and histories remain intact. Saved match
evidence is invalidated and must be refreshed.

The latest build passes **680 unit tests**, **330 Electron integration
checks** and **31 UI workflows**, on macOS arm64 and Windows x64 in CI. Job requirements now accept
arbitrary terminology, retain their source, and distinguish required, preferred
and unspecified importance. Nearest passages require human review; the system
does not automatically verify qualifications or reject missing CV text.

The broader frozen suite contains 96 fictional bilingual careers and 24
vacancies. The ten-family development split produced precision@3 of **42.9%**
and recall@10 of **49.8%**; the reserved legal/education split produced **45.8%**
and **51.0%**. Development recall@10 was **88.3%** for relevant CVs sharing the
posting language and **11.7%** for relevant CVs in the other language. These are
synthetic repeated measurements requiring independent review. Scoring-weight
ablations did not improve recall consistently, so the existing weights remain.
The small/base/large model comparison now spans all 96 cases. Larger models
offered modest, uneven development gains and no reserved recall gain, at
substantially higher storage/runtime cost. The small model remains bundled.
Do not mark this milestone accepted because software tests pass.

An independently authored six-career bilingual check finds three strong fits
in the top three in three language combinations and two in the remaining one.
That small controlled result does not override the failed original mixed-language
packet or replace human review.

See the [dated quality report](pilot/QUALITY-2026-09-23.md),
[remaining matching investigations](pilot/MATCHING-FOLLOWUP-2026-09-23.md), and
[independent paired-language packet](eval/pilots/drilling-engineer/holdout-2026-09-23/README.md).
The broader baseline and vacancy-specific requirements are now implemented.
Next, validate language-aware retrieval against balanced and unbalanced pools,
unknown terminology and fresh role families. Check explicit negation, ownership,
tenure and transferable experience with recruiters. Preserve frozen labels and
evaluate changes by vacancy, profession and language; neither hospitality nor
drilling alone determines the model or scoring design. Follow the remaining
[cross-domain quality plan](pilot/CROSS-DOMAIN-QUALITY.md).

## Next milestone: recruiter pilot

Use the existing [blind relevance protocol](pilot/README.md) and the separate
[recruiter workflow exercise](pilot/RECRUITER-WORKFLOW-2026-09-23.md). Record actual
outcomes and keep real CVs and participant details out of this repository.
The packets support self-guided preparation until reviewers are available.
No invitations or messages have been sent. Human acceptance, a human Windows
installation and representative drilling PDF/DOCX coverage remain pending.

Release preparation may proceed locally, but product acceptance depends on
recorded quality and pilot results. Historical installer checks certify only
the packages that were actually tested.
