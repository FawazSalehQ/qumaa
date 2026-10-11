# Drilling Engineer pilot baseline

Recorded 21 September 2026. **Synthetic preflight completed; the proposed ranking
gate failed in both posting languages. Human recruiter sessions have not occurred.**
The app is usable for an observed diagnostic session, but these results do not
support relying on its top three for this vacancy.

## What was tested

- The published beta.2 Mac app and matching source at `48cbbc0`; the only source
  code changes in this pilot are evaluation helpers, metrics and provenance.
  The matching model, scorer, skills dictionary and production UI were not changed.
- A fictional Saudi onshore Drilling Engineer vacancy in English and Arabic,
  grounded in the primary sources listed in the [fixture README](../eval/pilots/drilling-engineer/README.md).
- [16 neutral-ID Markdown CVs](../eval/pilots/drilling-engineer/corpus/): eight
  English, eight Arabic; four provisional candidates in each relevance tier.
  Each tier has two CVs in each language. Four tier-1 candidates are the strongest
  fits, so any three of those four would be an ideal top three.
- Labels and input hashes were frozen before scoring. A second agent reviewed
  the profiles and label rationales without seeing results and found no obvious
  contradiction. This is not a recruiter or drilling-expert validation.
- Both searches imported all 16 files with zero failures, exact duplicates or
  near-duplicate warnings. AI was disabled; all data were fictional and local.

## Ranking results

Only tier 1 counts as relevant for precision and recall. NDCG uses grades 3/2/1/0
for tiers 1/2/3/4. The proposed gate requires at least two tier-1 candidates in the
top three and no tier-4 candidate there, separately for each posting language.

| Measure | English posting | Arabic posting |
| --- | --- | --- |
| Top three | C02 (tier 1), C03 (tier 3), C05 (tier 2) | C07 (tier 1), C10 (tier 2), C06 (tier 3) |
| Precision@3 | 1/3 = 33.3% | 1/3 = 33.3% |
| Recall@3 | 1/4 = 25% | 1/4 = 25% |
| Recall@10 | 2/4 = 50% | 2/4 = 50% |
| Reciprocal rank | 1.000 | 1.000 |
| NDCG@10 | 0.7163 | 0.6625 |
| Tier-1 positions | 1, 4, 13, 15 | 1, 6, 12, 16 |
| Detected requirements | Training | Emergency Care, Training |
| Proposed ranking gate | Failed: fewer than two strong fits in top three | Failed: fewer than two strong fits in top three |

The best first result does not compensate for missing other suitable candidates.
With the English posting, the two tier-1 Arabic CVs (C07/C15) ranked 13/15. With the
Arabic posting, the two tier-1 English CVs (C02/C11) ranked 12/16. This demonstrates
missed cross-language candidates in this example. Because these are distinct CVs,
not translated copies of the same profiles, it does not isolate language as a cause
or establish a general fairness result.

Full frozen synthetic results: [English](baseline/2026-09-21-en.json),
[Arabic](baseline/2026-09-21-ar.json), and [packaged UI check](baseline/2026-09-21-ui.json).
Each evaluation result records input/source/model hashes. Input manifest:
[fixture-sha256.json](../eval/pilots/drilling-engineer/fixture-sha256.json).
Do not edit this first baseline after improving the app; create a new dated result.

## Confirmed findings and next investigations

| ID | Observation | Next action / verification |
| --- | --- | --- |
| D01 | No drilling-specific skills exist in the 153-entry dictionary. The English posting yields only Training. The Arabic posting also incorrectly yields the nursing skill Emergency Care from the generic word الطوارئ in contingency planning. | Add domain-reviewed drilling terminology and Arabic aliases; handle ambiguous clinical aliases without losing nursing detection. Check both vacancy languages and unrelated professions on a new held-out set. |
| D02 | Every returned evidence section is `other`. The parser recognizes neither hash-prefixed Markdown headings nor native Arabic headings. Summary claims therefore do not receive the intended summary weight in these files. | Recognize Markdown and Arabic section boundaries; cover real employment/summary text and ordinary sentences that must not become headings. Rebuild existing derived sections/chunks when deploying a parser change. Preserve the frozen inputs. |
| D03 | Strong cross-language candidates fall below the top ten; adjacent/specialist candidates outrank them. For Arabic, lexical matching uses the posting's Latin acronyms (for example AFE/NPT), while Arabic prose is excluded by the current FTS query builder. | Investigate component scores, bilingual requirement parsing and controlled translations. Separate retrieval, vocabulary and section effects before changing tuned weights. Rerun ranking sanity tests and the existing F&B evaluation as well as this set after a change. |
| D04 | The packaged Arabic results display location `الخبر` (Khobar) for C07/C10 although those CVs provide no location. The location fallback matches that substring inside `الخبرة` (experience). | Require appropriate Arabic token boundaries/context for place names. Verify genuine Khobar addresses still work and that experience headings leave location unknown. This metadata issue did not cause the unfiltered rankings above, but can mislead a recruiter or location filter. |

Relevant implementation: [skills dictionary](../src/main/data/skills.json),
[section detection](../src/main/ingest/sections.ts),
[text normalization](../src/main/ingest/normalize.ts),
[location extraction](../src/main/ingest/fields.ts),
[FTS and scoring](../src/main/search/scoring.ts).
These findings identify observable gaps; the relative contribution of each to
the failed ranking requires a controlled follow-up. No scorer tuning was performed
against these labels in this pilot.

## Engineering verification

- Fresh build passed; **393 unit tests passed** (378 existing plus 15 evaluation tests).
- **171 Electron integration checks passed** using a throwaway library.
- **14 packaged macOS workflow tests passed**, including Arabic/RTL, reviews,
  comparison, shortlist exports, job history, CV versions, refresh and restart.
  Provider tests use synthetic credentials and responses.
- A dedicated packaged-app check imported the actual 16 Markdown files through
  the file-import API, searched through Express search in English and Arabic UI,
  saved each result set as a job and retained both jobs. The top-three IDs matched
  the evaluation table above. The file picker was stubbed to select the fixture
  files; the engineering check is not a human usability observation.
  The [captured Arabic result screen](baseline/2026-09-21-ar-results.png) shows
  the actual example and the incorrect location metadata recorded as D04.
- The pilot launcher passed syntax and preflight checks; valid pilot sessions
  can resume, while invalid session names, missing sessions and mismatched library
  paths are rejected. No test used the normal candidate library.

The earlier restricted-shell attempts aborted Electron before app startup; the
completed runs above used desktop execution permission and isolated data.
Windows was not rerun locally for this pilot. Both platforms passed the previously
published beta.2 CI; that does not establish this new example's Windows result.
The new ranking runs and UI check used Markdown, so domain-specific PDF/DOCX
extraction and visual layout remain pending. Generic PDF/DOCX integration checks
are separate evidence. Timing from concurrent preflight runs is not a capacity benchmark.

## Reproduce and conduct the human pilot

From the repository root on macOS, build once, then run each posting separately:

```sh
npm run build
env -u ELECTRON_RUN_AS_NODE \
  QUMAA_EVAL_CORPUS=eval/pilots/drilling-engineer/corpus \
  QUMAA_EVAL_POSTING=eval/pilots/drilling-engineer/posting-en.txt \
  QUMAA_EVAL_LABELS=eval/pilots/drilling-engineer/labels.json \
  QUMAA_EVAL_RESULTS=eval/results/drilling-engineer/en \
  node_modules/.bin/electron out/main/eval.js
```

Repeat using `posting-ar.txt` and the `eval/results/drilling-engineer/ar` output
directory. The corrected evaluation reports true recall; old results called
top-three target coverage “recall.” See [evaluation definitions](../eval/README.md).

The [session protocol](README.md), [blank observation form](SESSION.md),
[blind relevance form](RELEVANCE_REVIEW.md), and
[isolated launcher](../scripts/start-recruiter-pilot.mjs) are ready. Next human
steps are domain review and independent labels, then observed recruiter sessions.
Keep the fixture rubric, this report and system scores hidden during blind grading.
Recruiter outreach, actual participant feedback and live AI-provider validation
remain outside the completed preflight.
