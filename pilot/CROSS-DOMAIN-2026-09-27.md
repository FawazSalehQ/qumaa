# Cross-domain implementation and quality check — 27 September 2026

Qumaa's scope is recruiting across professions. The previous hospitality and
drilling checks did not justify a general matching-quality claim. This pass
adds vacancy-specific requirement review and a broader frozen evaluation.
It does **not** establish acceptable accuracy across all domains.

## Implemented behavior

- Saved jobs and Express searches can import editable requirement clauses from
  the posting, including specialist terms absent from the skills dictionary.
  Original source wording is retained. Explicit required/preferred wording is
  recognized; ambiguous wording stays **Unspecified**. Recruiter edits survive
  reimport. This is a bounded drafting heuristic, not semantic understanding.
- Each criterion retrieves a nearest CV passage using local multilingual
  embeddings. Short leading identity headers are excluded when substantive
  evidence exists. Passages remain **Review needed**, including when the
  nearest text is irrelevant or contradictory. No assessment is set automatically.
- Saved scorecards support an explicit **Contradicted** assessment. Express
  searches expose read-only passages. Existing decisions, corrections, company
  links, budgets and recruiter records are retained.
- Importing the same source requirement no longer duplicates it in the search
  query. Newly added or changed wording still contributes. Existing saved match
  snapshots become stale and can be refreshed without deleting reviews.
- Candidate copy describes text similarity and recognized term mentions. A
  missing term is not presented as proof that a candidate lacks a qualification.
  Zero recognized requirements no longer produce an apparently perfect skills bar.
- Schema 10 identifies the expanded requirement/review JSON contract and blocks
  older readers. It does not rewrite legacy required/preferred assessments.

Everything above runs locally. OCR remains outside scope. Optional provider
reranking retains its existing explicit opt-in flow.

## Frozen baseline

The [fixture manifest](../eval/cross-domain/manifest.json) covers 12 profession
families, 96 fictional careers and 24 vacancies at two seniority levels. Each
career and vacancy has English and Arabic wording. Two complementary mixed
candidate pools contain one translation of each career, never both together.
Both posting languages are searched against each pool.

The development split searches 20 vacancies against 80 careers: **80 cases**.
Legal and education were reserved; their four vacancies search all 96 careers:
**16 cases**. Different pool sizes are reported separately. These are repeated
measurements, not 96 independent vacancies or additional translated people.

Fixtures and labels were frozen before evaluation. Actual production ingestion,
SQLite lexical search, embedding and ranking were used in disposable libraries.
Labels and filenames never enter the ranker. Macro averages weight vacancies
equally. Full provenance and per-case metrics are preserved in
[development results](quality/2026-09-27/cross-domain-development.json) and
[reserved results](quality/2026-09-27/cross-domain-reserved.json).

| Split | Precision@3 | Recall@10 | NDCG@10 |
| --- | ---: | ---: | ---: |
| Development, 80 cases | 42.9% | 49.8% | 0.557 |
| Reserved, 16 cases | 45.8% | 51.0% | 0.552 |

Development family results show that no single profession represents the app:

| Family | Precision@3 | Recall@10 |
| --- | ---: | ---: |
| Software | 50.0% | 50.0% |
| Construction | 29.2% | 37.5% |
| Energy | 58.3% | 50.0% |
| Healthcare | 41.7% | 58.3% |
| Finance | 41.7% | 62.5% |
| Manufacturing | 45.8% | 45.8% |
| Logistics | 29.2% | 41.7% |
| Sales | 50.0% | 60.4% |
| HR | 45.8% | 50.0% |
| Hospitality | 37.5% | 41.7% |

Across development cases, recall@10 was **113/128 (88.3%)** for relevant CVs
sharing the posting language and **15/128 (11.7%)** for relevant CVs in the other
language. These are pooled repeated exposures. The imbalance identifies
cross-language retrieval as a major remaining problem, not a defect specific
to hospitality. Fourteen cases recognized no dictionary requirements.

## Scoring experiments

The existing dictionary contributes 25% of the blend. Three diagnostic
alternatives reused the same raw component scores; none was deployed:

| Development variant | Precision@3 | Recall@10 | NDCG@10 |
| --- | ---: | ---: | ---: |
| Current blend | 42.9% | 49.8% | 0.557 |
| Remove dictionary component | 45.8% | 44.2% | 0.576 |
| Semantic component alone | 40.4% | 47.4% | 0.527 |
| Scale dictionary weight by vocabulary coverage | 46.7% | 45.8% | 0.580 |

Removing dictionary dependence alone did not solve recall. Some top-three
metrics improved while recall deteriorated. Production weights were retained.

An exploratory language-group normalization raised development recall@10 to
60.3%, but reduced precision in some families. It used known fixture languages
and balanced language pools; behavior with unbalanced pools or no relevant
candidate in one language remains untested. It is not shipped. The
[experiment summary](quality/2026-09-27/language-calibration.json) preserves its
formula, provenance and limitations.

## Offline model decision

The earlier hospitality/drilling comparison was too narrow to settle the model
choice for the application. The new development comparison changes only the
embedding model: identical frozen parsed passages, queries, SQLite scores,
skills and production scoring, with local q8 inference and batches of eight.
Each distinct query/passage is embedded once and reused across cases.

| Model | Precision@3 | Recall@10 | NDCG@10 | Model assets | Embedding time | Sampled Node RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| e5-small | 42.9% | 49.8% | 0.556 | 129 MiB | 7.15 s | 968 MiB |
| e5-base | 43.3% | 53.0% | 0.573 | 282 MiB | 14.91 s | 1,225 MiB |
| e5-large | 43.8% | 52.4% | 0.579 | 552 MiB | 55.02 s | 2,036 MiB |

Embedding time covers 373 unique query texts and 249 unique passages in these
80 cases, not per-search latency. Hashing warms the file cache before model
loading; RSS sampling excludes renderer processes. These are one-run cost
observations on this machine, not a population performance estimate.

**Keep e5-small for beta.3.** Base raises macro recall by 3.2 percentage points
but barely changes top-three precision, lowers software/finance precision and
lowers hospitality recall. Large raises recall by 2.6 points, lowers recall in
healthcare/software and lowers precision in several families. Neither resolves
the language gap: pooled cross-language recall@10 is 11.7% / 19.5% / 17.2% for
small/base/large. The modest, uneven gains do not justify their storage and
runtime costs in this build. This decision was made from development cases,
before the separate reserved model runs, and can change with stronger evidence.

The cached small-model benchmark matches actual Electron precision@3 and
recall@10 in every development case. Different quantized batch composition
changes close ranks: all full orders differ, 12 top-three orders/memberships
differ, and the maximum blended-score difference is 0.0145. MRR/NDCG also differ
slightly. Consequently model comparisons use the same cached runner throughout;
they are not claimed to reproduce every desktop rank exactly.

The subsequent 16 reserved cases did not establish a general improvement:

| Reserved model | Precision@3 | Recall@10 | NDCG@10 |
| --- | ---: | ---: | ---: |
| e5-small | 45.8% | 51.0% | 0.553 |
| e5-base | 50.0% | 49.5% | 0.549 |
| e5-large | 45.8% | 51.0% | 0.549 |

Input, scoring, script and dependency hashes agree across each split's model
runs. No text exceeded the model's 512-token window. Preserved
[development model results](quality/2026-09-27/model-comparison-development.json),
[reserved model results](quality/2026-09-27/model-comparison-reserved.json), and
[desktop parity comparison](quality/2026-09-27/model-parity-development.json)
contain per-case metrics and provenance. Detailed candidate ranks remain in
ignored local evaluation outputs, identified by SHA-256 in the summaries.

## Verification and remaining acceptance

The production build, **503 unit tests**, **261 Electron integration checks**
and **24 source UI workflows** passed. The full UI run passed 23 workflows; an
old expected passage label was corrected and that complete workflow passed on
rerun. English and Arabic requirement workflows cover arbitrary terminology,
cross-language passages, source retention, manual assessments, persistence and
Express search. All checks used disposable profiles.

The synthetic careers are concise authored text, not representative real CVs.
Arabic terminology, translations, requirement extraction and relevance labels
need independent professional review. Other-family candidates are provisionally
treated as distractors; transferable experience may require reviewed corrections
in a new fixture revision. These fixtures exercise Markdown ingestion; existing
PDF/DOCX smoke checks do not establish representative document coverage across
professions. Reserved results have now been inspected and become regression
evidence; future tuning needs fresh held-out examples.

Next quality work should test cross-language calibration or retrieval changes
against unbalanced pools, unfamiliar roles, explicit negation, ownership and
tenure evidence, alongside blind recruiter judgments. No human acceptance
sessions or Windows runtime checks were completed in this pass.

## Packaged delivery

Version **0.1.0-beta.3** packages this pass and the earlier September 23
extraction work for macOS arm64 and Windows x64. New requirement workflows are
also checked in the packaged Mac app. Development-only evaluation and smoke
entry points and their private helper chunks are excluded from both installers.
The model remains bundled once as an external resource, with pinned file hashes.
See [release notes](../release/RELEASE-v0.1.0-beta.3.md) for artifact verification.
No release was published or tagged.
