# Cross-domain matching baseline

This synthetic engineering suite samples 12 profession families and two
seniority levels. It is a regression and diagnosis tool, not proof of general
hiring accuracy. All career relevance labels and Arabic translations need
independent domain review.

Each family contains eight fictional careers in English and Arabic and two
vacancies with separate labels and rationales. Labels and rationales stay
outside the CV text passed to ingestion. The entire mixed-profession pool is
searched for each vacancy. Other-family careers provisionally receive tier 4;
reviewers must check this assumption for transferable or overlapping roles.

The development split uses ten families. Legal and education are reserved:
their careers and jobs are excluded from development runs. A reserved run
searches its vacancies against all 12 families, including development careers
as distractors. Thus development and reserved pool sizes differ and should be
reported separately. Reserved results become regression evidence after they
have been inspected; a future change needs fresh examples for another held-out
check.

## Run

```sh
env -u ELECTRON_RUN_AS_NODE npm run eval:domains
```

The runner builds the app, creates a disposable SQLite library, ingests the CV
text through production derivation/embedding, and searches through the actual
ranking path. It never opens the user's library and makes no cloud requests.
It aborts on missing candidates or incomplete labels; partial runs do not
produce a completed summary. Outputs default to a new timestamped directory in
ignored `eval/results/cross-domain/`.

Optional environment variables:

- `QUMAA_CROSS_DOMAIN_SPLIT=development|reserved|all` (default `development`).
- `QUMAA_CROSS_DOMAIN_COHORTS=mixed-a,mixed-b` (default). `english` and `arabic`
  also select whole-pool language variants.
- `QUMAA_CROSS_DOMAIN_RESULTS=path` selects an empty result directory. Existing
  case files are never overwritten.
- `QUMAA_CROSS_DOMAIN_BENCH_INPUT=path` exports frozen model-comparison inputs
  with actual SQLite scores and parsed passages. These contain CV text; keep
  real-data exports private. Use a new, empty directory.
- `QUMAA_CROSS_DOMAIN_FIXTURES=path` selects a different fixture root containing
  `manifest.json` and `families/<family>.json` with the same validated schema.

Mixed A alternates career language; mixed B uses its complement. Each run
contains exactly one translation of each person, so translations do not compete
as duplicate candidates. Both posting languages are tested against each pool.
These are repeated measurements of the same careers, not independent people.

The JSON summary includes each vacancy's precision@3, recall@3, recall@10 and
NDCG@10; per-family and posting-language results; relevant CV language
denominators; detected dictionary skills; and input/code/model fingerprints.
Macro averages weight vacancies equally, averaging each vacancy's repeated
language/cohort measurements first. Detected skill counts are dictionary hits,
not the fraction of requirements understood.

Three diagnostic ablations rerank the same component scores: without the
dictionary component, with semantics alone, and with dictionary weight scaled
by the fraction of extracted requirement clauses containing a recognized term.
This last fraction is a vocabulary-coverage proxy, not evidence of requirement
understanding. The ablations use no labels as ranking input and do not change
production scoring. Improvements are hypotheses to validate with regressions,
reserved cases and independent recruiter judgments.

## Offline model comparison

Export the development split with `QUMAA_CROSS_DOMAIN_BENCH_INPUT`, then run:

```sh
node scripts/benchmark-domain-model.mjs \
  --input-dir path/to/development-inputs \
  --model-dir resources/models --model-id multilingual-e5-small \
  --output eval/results/development-small.json
```

Node 22 and locally staged q8 model assets are required. Repeat sequentially
for each model with identical input files and batch size (default eight).
Use separate development and reserved runs. The runner never downloads assets;
it refuses inconsistent inputs and never replaces an existing result file.
It reuses each distinct query and passage embedding across cases, preserving
production prefixes, scoring, frozen SQLite scores and candidate order.

Compare the small-model run with actual Electron results first: quantized
inference with different batch composition can change scores and close ranks.
The output records per-case metrics, same/cross-language recall, input/model/code
hashes, unique-text timing and sampled Node RSS. These timings are not desktop
search latency or total application memory. Labels remain evaluation-only.

## Scope and provenance

The initial fixtures were authored in two independent batches without consulting
the scoring code, vocabulary, or ranking output. Freeze the family files and
manifest in `SHA256SUMS` before the first run. Do not rewrite labels or CVs to
improve measured ranking; reviewed label corrections require a new fixture
revision and a documented rationale.

Before the first run, identical generic working-practice appendices were removed
from both batches, preserving all career evidence and labels. The frozen profiles
are concise, authored text (roughly 88–122 words), so document-length and style
diversity remain limited. Their synthetic review status is not changed by passing
software validation.

This suite exercises Markdown text. PDF/DOCX extraction has separate smoke
coverage and still needs representative cross-profession document review.
The synthetic cases do not cover every profession, every level, or regional
credential rules. No resume here describes a real person.
