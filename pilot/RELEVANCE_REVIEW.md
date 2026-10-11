# Blind relevance review: drilling engineer

Blank template — no recruiter labels or conclusions recorded. Complete **Part A before seeing scores, result order, baseline reports or fixture tier labels**. Store completed copies privately. Only the facilitator receives the reference mapping. Synthetic author labels are hypotheses, not recruiter ground truth.

## Part A — independent review

Reviewer code: ____; drilling-screening/domain experience: ____; date: ____.

Posting version/hash and language: ____; corpus version/hash: ____.

Agreed job-related requirements: ____.

Preferred criteria: ____.

The domain reviewer should confirm the intended scope: drilling-program planning and execution, well construction and operations, evidence of relevant technical work, safety responsibilities and the posting's experience/communication requirements. Assess the actual frozen posting, without inventing credentials or treating adjacent petroleum-engineering experience as automatically sufficient. Do not grade protected characteristics, names or nationality.

Use CV evidence to assign:

| Grade | Meaning |
| --- | --- |
| 3 | Strong shortlist candidate: direct evidence addresses the central drilling responsibilities and required experience; remaining details are screening questions. |
| 2 | Plausible: relevant drilling work, with an important requirement or scope needing clarification. |
| 1 | Limited fit: direct drilling-specialist or junior drilling experience, but insufficient breadth or responsibility for this engineer vacancy. |
| 0 | No demonstrated direct drilling-engineering scope; this can include adjacent reservoir, production, civil or data work despite overlapping terminology. |
| U | Cannot judge because the CV is unreadable, incomplete or the reviewer lacks the needed domain understanding. Resolve before computing metrics; do not silently turn U into 0. |

Missing text is an uncertainty to record, not proof the candidate lacks a qualification. Scores are role-fit judgments for this exercise, not hiring decisions. Review candidates in randomized ID order and record that order: ____.

The posting requires five years of direct drilling-engineering experience including
onshore work, not five years exclusively onshore. Judge missing technical ownership
separately from tenure. Human grades may differ from the provisional fixture labels;
record and explain those differences before revealing system scores.

| Candidate ID | CV language | Format | Grade | Requirement + source section/page supporting the grade | Missing/unclear requirement | Confidence low/medium/high |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Repeat for **every core candidate**, including those expected to rank poorly. Do not calculate recall or NDCG from a review of only the returned top candidates. Keep the reserved refresh CV outside the frozen ranking comparison.

Independent preferred shortlist (IDs, at most three): ____.

Independent review completed at: ____.

Scores/fixture labels previously seen? No / Yes (describe exposure): ____.

## Part B — agreement before score reveal

At least two reviewers first complete Part A independently. Discuss differences using evidence. Keep their original labels, then record agreed grades; use a domain adjudicator for unresolved cases. Freeze this table before viewing Qumaa ranking. Report unresolved cases and withhold aggregate metrics until every core CV is judged.

| Candidate ID | Reviewer A grade | Reviewer B grade | Agreed grade | Evidence-based reason for disagreement/resolution |
| --- | --- | --- | --- | --- |
| | | | | |

Exact agreement: ____ / ____ candidates. Unresolved: ____.

Adjudicator code (if used): ____; agreed label freeze time: ____.

## Part C — reveal and measure

Complete separately for each posting language. Use the same core library, frozen requirements and local matching with no AI rerank or display filters. Record UI language separately. A refresh after adding candidates is a different comparison and must not replace this result.

App version/commit: ____; posting language: ____; UI language: ____.

Core candidate count: ____; total grade-3 candidates **R**: ____.

Any change from the frozen posting/corpus, extraction failures or unjudged CVs: ____.

| Rank | Candidate ID | Agreed grade (0–3) | CV language / format | App score (after labels frozen) | Relevant source evidence or failure note |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |

Record the rank of the first grade-3 candidate beyond rank 10 if necessary: ____ (not retrieved: ____).

Metrics, with **grade 3** as the binary positive and linear grade as gain:

- **Precision@3** = number of grade-3 candidates in first three / 3: ____ / 3 = ____.
- **Recall@3** = number of grade-3 candidates in first three / R across the entire core set: ____ / ____ = ____. If R = 0, report not applicable.
- **Reciprocal rank** = 1 / rank of first grade-3 result, or 0 if none retrieved: ____. **MRR** is the mean over separately evaluated postings; a single posting has one reciprocal-rank value.
- **NDCG@10** = sum of `grade_i / log2(i + 1)` for ranks 1–10, divided by the same sum for the ten highest agreed grades from the complete core set: ____ / ____ = ____. If ideal gain is 0, report not applicable. Do not substitute exponential gain when comparing this measure with the repository eval.
- **Grade-0 results in top three**: ____.
- **Evidence audit**: ____ / ____ checks relevant or correctly uncertain; ____ misleading claims accepted as verified. See the session form.

If fewer than three results are returned, count empty top-three positions as non-positive. Explain every extraction/import failure; a score computed only after silently dropping a failed CV is not a complete-corpus result.

## Paired language / format interpretation

English posting P@3 ____; Arabic posting P@3 ____; top-three ID overlap ____ / 3; first-strong rank EN ____ / AR ____.

Differences traced to requirement translation, extraction, evidence retrieval or unresolved cause: ____.

CV language coverage: EN ____; AR ____; mixed ____. Input-format coverage: PDF ____; DOCX ____; Markdown ____; other ____.

Controlled format comparison (if run in separate clean libraries): same candidate/content IDs ____; source format pair ____; extraction differences ____; ranking differences ____.

Proposed targets met / failed / untested: ____.

Do not pool English and Arabic runs as independent recruiter samples, or claim language/format parity from a handful of synthetic examples. Keep human relevance results separate from automated fixture labels and engineering baseline results.
