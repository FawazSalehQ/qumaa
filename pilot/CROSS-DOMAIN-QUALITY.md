# Matching quality across domains

Updated 27 September 2026. Qumaa is a hiring tool for all domains. A broader
engineering baseline and vacancy-specific requirement workflow are now
implemented. Their presence does not establish reliable hiring accuracy across
domains: the new evaluation labels are synthetic and have not been reviewed by
recruiters. This document records the implemented work and remaining acceptance
plan; measurements and limitations are recorded in the
[27 September cross-domain report](CROSS-DOMAIN-2026-09-27.md).

## Current capability and limitation

The matcher accepts arbitrary job descriptions. Semantic passage matching and
full-text lexical search operate on the supplied text without an industry
allowlist. Companies, jobs, budgets and recruiter workflows also do not require
an industry-specific implementation.

The constraint is uneven matching quality. The built-in dictionary contains
162 skills concentrated in a handful of professions. Exact skill overlap
contributes 25% of the current score. With no recognized requirements it returns
the same value for every candidate, so that component cannot distinguish them;
with sparse coverage it can overemphasize the few recognized terms. That is not
proof that the dictionary caused every observed ranking error. Cross-domain
dictionary ablations did not show a consistent recall gain, so this work has
not changed the scoring weights. Requirement parsing, passage selection and
language effects remain separate concerns to validate.

The existing F&B and drilling evaluations provide useful regressions. Neither
is a proxy for every profession. Existing model comparisons remain historical
evidence on those examples; broader results could warrant revisiting a decision.

## Implemented work and remaining validation

- **Frozen engineering suite:** 12 profession families, 96 synthetic careers and
  24 vacancies, with 80 development cases and 16 reserved cases. Candidate labels
  are separate from matcher inputs. Language variants are repeated measurements
  of the same careers, not additional independent people. These provisional
  fixtures provide regression coverage, not recruiter acceptance evidence.
- **Editable vacancy requirements:** saved jobs and express searches can derive
  drafts from description, requirements and qualification fields without a
  skills-dictionary allowlist. Original source wording is preserved alongside
  recruiter corrections. Explicit English/Arabic priority wording can suggest
  Required or Preferred; unclear priority remains Unspecified. Extraction is a
  bounded text parser, so recruiters must review the drafts and any omissions.
- **Per-requirement passages:** the app retrieves nearby canonical CV passages
  using the existing offline embeddings and section weighting. Suggestions are
  marked for review. Tiny leading identity/header chunks are excluded from this
  evidence view when substantive passages exist; short credentials in named
  education and skills sections remain eligible. Retrieval does not establish
  that a passage supports the requirement or that a candidate is qualified.
- **Recruiter assessments:** saved scorecards distinguish evidence found,
  contradictory evidence, information not stated, clarification needed and
  recruiter confirmation. Contradiction is recorded manually, never inferred
  from similarity or missing vocabulary. Express-search passages are read-only
  until the search is saved as a job. No criterion automatically rejects a
  candidate.
- **Ranking experiments:** dictionary ablations have been compared with the
  frozen development baseline. No consistent recall benefit justified a weight
  change. Existing ranking weights remain in place; broader quality validation
  and model comparisons are separate from the requirement workflow additions.

## Implementation and validation order

1. **Maintain and validate the broader baseline.** The manifest, frozen fixtures
   and evaluator runner now cover the 12 families below. Record per-case results
   and coverage gaps before changing ranking. Keep candidate tiers and posting
   requirements separate from text used by the matcher. Freeze new fixtures and
   labels before experiments, and obtain independent review of their realism
   and relevance judgements.
2. **Validate each vacancy's requirement drafts.** The implemented workflow
   derives editable requirements from the vacancy's actual description:
   responsibilities, specialist skills, experience,
   qualifications and explicitly requested credentials. Preserve source wording
   and recruiter corrections. Must-have versus preferred must be explicit or
   confirmed, not invented from a model's inference. Arbitrary terminology must
   be representable without first adding it to the global dictionary.
3. **Validate requirement evidence.** The implemented retrieval shows nearby
   passages for each requirement; measure whether they actually support it.
   Recruiter assessments can separate supported, explicitly contradicted and
   unverified requirements, but automatic semantic qualification is not
   implemented. A term absent from the dictionary, or omitted from a CV, does
   not by itself establish that a person
   lacks the skill. Test negation, ownership, tenure and transferable experience;
   avoid treating a course mention as proof of professional responsibility.
4. **Continue measuring the dictionary's scoring role.** Retain useful synonym
   aliases as supplementary signals. Compare the current fixed skill weight with measured
   alternatives that handle sparse vocabulary coverage. The first ablations did
   not justify a change. Further changes need gains across professions and
   languages, with their tradeoffs recorded; this work adds no automatic
   rejection rules.
5. **Validate with recruiters across professions.** Use blind review of real
   vacancy requirements and consented or appropriately de-identified examples.
   Keep private CVs and detailed results in ignored local storage. Synthetic
   examples support engineering checks; they do not establish hiring quality.

All stages retain local operation. Optional cloud reranking remains optional;
OCR remains outside scope. Requirement extraction quality and runtime cost need
continued measurement. Model choices require separate quality, size and speed
comparisons; this plan does not pre-empt their outcome.

## Coverage matrix and expansion plan

The frozen suite samples these families; the example roles below describe the
coverage and expansion plan, not a claim that every listed role has been tested.
These are sampling families, not supported-industry limits. Add other roles as
they arise, and reserve entire role families from development to check whether
improvements generalize beyond familiar vocabulary.

| Family | Example roles for baseline construction |
| --- | --- |
| Software, data and IT | Backend developer, data analyst, systems administrator |
| Engineering and construction | Civil engineer, electrical engineer, quantity surveyor |
| Energy and utilities | Drilling engineer, power operations engineer |
| Healthcare and life sciences | Nurse, laboratory scientist, pharmacist |
| Finance and accounting | Accountant, financial analyst, internal auditor |
| Legal and compliance | Legal counsel, compliance officer |
| Education and research | Teacher, researcher, instructional designer |
| Manufacturing and skilled trades | Maintenance technician, machinist, quality engineer |
| Supply chain and logistics | Buyer, warehouse supervisor, logistics planner |
| Sales, marketing and customer service | Account executive, marketer, support specialist |
| HR and administration | Recruiter, HR specialist, office manager |
| Hospitality and food services | Hotel manager, chef, food-service supervisor |

For each sampled family, include distinct vacancies, different seniority levels,
strong fits, partial fits, adjacent-profession distractors and genuinely
unrelated candidates. Include credible transferable experience and candidates
whose skill wording differs from the posting. Candidate pools should contain
multiple professions, with enough relevant and distracting CVs that recall@10
is informative rather than guaranteed by the pool size.

Use Arabic, English and mixed-language documents. Paired translations must keep
qualifications and responsibilities equivalent; translation variants are repeated
measurements, not additional independent people. Test text-based PDF, DOCX and
Markdown extraction separately from language matching. Review technical terms
and role requirements before treating labels as acceptance evidence.

## Reporting and acceptance

- Preserve precision@3, recall@3, recall@10 and NDCG@10 by vacancy, family and
  language. Report denominators and corpus size alongside percentages.
- Summarize with equal weight per vacancy, also showing family averages and the
  weakest groups. A larger F&B pool must not dominate the summary.
- Report missing or unreviewed cases explicitly. An absent profession is
  unmeasured, not passed. A finite suite cannot establish universal accuracy.
- Measure whether displayed passages actually support the requirement, including
  unsupported claims of seniority, qualifications or ownership.
- Measure unknown terminology, mixed-language retrieval, irrelevant keyword
  stuffing, and roles withheld from development as separate checks.
- Set acceptance thresholds with reviewers before using a new frozen set to
  choose a model or scoring change. Retain existing regressions and explain
  material tradeoffs by affected profession; neither F&B nor drilling alone
  decides the application's direction.
- Preserve model/input/code hashes and report size, speed and memory under the
  same conditions. Do not trade broad matching quality for a single-case gain.

The immediate engineering deliverables are the frozen baseline, measured
failure report and implemented requirement/evidence workflow. The next quality
gate is independent review of vacancy requirements, candidate relevance and
passage support across professions and Arabic/English, followed by measured
corrections to the remaining failure patterns. Reviewers must set acceptance
thresholds before a new frozen set is used to choose changes. The September 23
results remain historical evidence; reliable accuracy across all domains is
not complete or established by this synthetic suite.
