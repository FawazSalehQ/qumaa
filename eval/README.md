# Evaluation corpus

Measures whether the app ranks the *right* candidates, not just quickly. The
capacity benchmark (`npm run bench`) already covers speed; this covers quality.

Qumaa targets hiring across domains. The default F&B corpus and the drilling
pilot are historical regression checks, not evidence of general coverage.
Follow the [cross-domain quality plan](../pilot/CROSS-DOMAIN-QUALITY.md) for the
next baseline. Report each profession and language separately as well as an
equally weighted summary across vacancies, so a large corpus in one profession
cannot hide failures elsewhere. `npm run eval:domains` runs the new
[cross-domain synthetic suite](cross-domain/README.md); `npm run eval` retains
the single-posting regression workflow below. Independent recruiter labels
are still pending.

## Where the files go

Drop the generated resumes into `eval/corpus/`. That directory is gitignored,
deliberately: the repo is public, and this is also where real resumes would land
if anyone ever evaluated against genuine applications.

## Filename convention

```
t<tier>_<nn>_<firstname>_<lastname>.docx
```

for example `t1_03_hannah_reid.docx`. The leading tier is the ground truth — how
well that candidate genuinely fits the posting being tested:

| Tier | Expected | Meaning |
|---|---|---|
| t1 | top 3 | Hits nearly every requirement |
| t2 | shortlist | Most requirements, missing one or two |
| t3 | ranked low | Same profession, wrong specialisation or seniority |
| t4 | ranked lowest | Adjacent profession; distractors |

The tier is safe to encode in the filename because **nothing in ranking reads
it**. FTS5 indexes only `raw_text`, and the scorer sees chunk embeddings,
`raw_text`, and extracted skills; `file_name` never reaches
`src/main/search/rank.ts`. It is carried through purely so results can be graded.

The same must be true of the resume text itself: if a document says "ideal
candidate" or otherwise states its own tier, that phrasing feeds the embedding
and the measurement is void.

## The posting

Save the job description the corpus was built against as `eval/posting.txt`,
verbatim, including messy formatting. Cleaning it up would strip exactly the
noise a real posting carries.

## Isolated pilot corpora

The default command remains `npm run eval`. A separate pilot can use neutral
filenames and a label manifest without replacing the original corpus or posting:

```bash
env -u ELECTRON_RUN_AS_NODE \
  QUMAA_EVAL_CORPUS=eval/pilots/drilling-engineer/corpus \
  QUMAA_EVAL_POSTING=eval/pilots/drilling-engineer/posting-en.txt \
  QUMAA_EVAL_LABELS=eval/pilots/drilling-engineer/labels.json \
  QUMAA_EVAL_RESULTS=eval/results/drilling-engineer \
  npm run eval
```

`env -u ELECTRON_RUN_AS_NODE` is useful in shells that set that variable; the
evaluation must run inside Electron. Paths may be absolute or relative to the
repository root. All overrides are optional; results default to `eval/results`.
Use `posting-ar.txt` for the equivalent Arabic posting, retaining the same corpus
and labels. The command above uses macOS/Linux shell syntax.
Keep real resumes and detailed results in ignored local directories. A custom
corpus path is **not automatically gitignored**.

The manifest is a JSON object such as `{"C01.md": 1, "C02.pdf": 4}`. It must
contain exactly one integer tier (1–4) for every supported corpus file and no
entries for missing files. Labels are read only by the evaluation harness and
are not passed to the search engine. Do not put labels or label rationales in
resume text. Do not import the manifest, rubric, or job posting as a resume.

Without a manifest, the legacy `t1_` through `t4_` filename convention applies.
Unlabelled files fail the run unless explicitly excluded with
`QUMAA_EVAL_IGNORE_UNLABELLED=1`. That option does not excuse invalid tier numbers
or incomplete manifests. The run fails if there is no tier-1 candidate, the
posting is empty, any labelled resume fails ingestion or is rejected as an exact
duplicate, or ranking fails to return every imported candidate exactly once.
Near-duplicate warnings remain visible for review.

## Metrics and baseline provenance

Each run evaluates one posting. Only tier 1 counts as relevant for precision and
recall; NDCG also rewards tiers 2 and 3.

| Metric | Definition |
|---|---|
| `precisionAt3` | Tier-1 candidates in the top three / 3 |
| `recallAt3` | Tier-1 candidates in the top three / **all tier-1 candidates** |
| `recallAt10` | Tier-1 candidates in the top ten / all tier-1 candidates |
| `top3TargetCoverage` | Tier-1 candidates in the top three / min(3, total tier-1 candidates) |
| `reciprocalRank` | 1 / rank of the first tier-1 candidate |
| `ndcg10` | DCG@10 / ideal DCG@10, using linear gains 3, 2, 1, 0 and log2(rank + 1) discount |

The `mrr` JSON field is retained as an alias of `reciprocalRank` for existing
consumers. It is only a mean reciprocal rank when aggregated across postings.
For fewer than three tier-1 candidates, precision@3 has a ceiling below 100%;
the console states that ceiling.

**Results before schema version 2 used the name `recallAt3` for
`top3TargetCoverage`.** For example, finding two of eight tier-1 candidates in
the first three positions gives 25% recall@3 and 66.7% top-three target coverage.
Do not compare the old and corrected recall fields directly.

Version 2 result files include SHA-256 fingerprints of every evaluated resume,
the whole corpus manifest, posting, labels, runtime evaluation bundle, source
tree and build inputs, plus the Git HEAD, model revision, and runtime versions.
Preserve the exact input files and result together when freezing a baseline.
`status: "completed"` means ingestion and grading completed; it does not mean
ranking quality passed a recruiter acceptance threshold.

Set `QUMAA_EVAL_DIAGNOSTICS=1` to include raw semantic/BM25 scores, the exact
lexical query, and each requirement's winning source passage in the local JSON.
This invokes the production scorer without changing the ranking. Diagnostic
output contains posting and CV text: keep real-CV results in the ignored local
results directory. Synthetic diagnostics can help separate query construction,
section attribution and score normalization effects before changing weights.

Set `QUMAA_EVAL_BENCH_INPUT=path/to/input.json` to export the exact query texts,
parsed passages, canonical skills and raw SQLite lexical scores for an isolated
model comparison. Create the destination directory first. This contains CV
text and must stay private for real candidates. Labels and filenames accompany
the evaluation record but are never embedded or supplied as matching features.
`scripts/benchmark-model.mjs` consumes these frozen inputs using a separately
downloaded local model; it does not change the application's model or database.

Synthetic corpora are preparation and regression checks. A recruiter pilot
needs independent labels based on the vacancy, representative Arabic/English
documents and actual received formats, and a held-out set that was not used to
tune the scorer. Review hard requirements and evidence for false positives and
qualified candidates missed below the shortlist. Record human observations
separately; these metrics do not measure usability or establish hiring validity.
