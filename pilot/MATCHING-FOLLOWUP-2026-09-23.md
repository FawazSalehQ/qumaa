# Matching follow-up — 2026-09-23

Status: source inspection and synthetic evaluation diagnostics; independent recruiter validation is pending. This memo does not establish that a pilot or release gate passed. No scoring weights, model, fixture labels, or corpus content were changed for this diagnosis.

## Recorded results

The frozen drilling packet contains 16 CVs with provisional author-assigned tiers. The four tier-1 CVs are the strong-fit reference set; these are not human-validated judgments.

| Posting | Precision@3, before → after | Recall@10, before → after | NDCG@10, before → after |
| --- | --- | --- | --- |
| English | 1/3 → 1/3 | 2/4 → 3/4 | 0.7163 → 0.7552 |
| Arabic | 1/3 → 1/3 | 2/4 → 3/4 | 0.6625 → 0.7494 |

Sources: [English before](quality/2026-09-23/comparison.json), [English after](quality/2026-09-23/after-drilling-en.json), [Arabic before](quality/2026-09-23/comparison.json), [Arabic after](quality/2026-09-23/after-drilling-ar.json). These preserved synthetic artifacts record runtime and fixture hashes. See the provenance caveat and subsequent controlled-language results in [the dated quality report](QUALITY-2026-09-23.md).

## Observations and source limits

- **Language separation remains.** With the English posting, Arabic strong-fit C07/C15 rank 10/15, with normalized semantic components 0.109/0.056 and lexical components 0. With the Arabic posting, English strong-fit C02/C11 rank 9/12, with semantic components 0.255/0.190 and lexical components 0. Same-language C03 (junior) and C13 (production engineer) respectively receive semantic component 1. These are pool-normalized components, not absolute similarity or confidence. The best reported cross-language passage similarities remain approximately 0.808–0.832; normalization stretches the relative differences. The mechanism is in [scoring.ts](../src/main/search/scoring.ts).
- **The lexical budget excludes later requirements.** [buildFtsQuery](../src/main/search/scoring.ts) keeps the first 60 unique surviving terms. This English query ends at “assemblies”; Arabic ends at “وحالات”. Both stop before the later well-control, AFE/NPT, cost and experience clauses. Arabic terms now consume the budget before AFE/NPT, removing those incidental shared Latin anchors. All English CVs have lexical component 0 for the updated Arabic query. This is a verified coverage limitation, not evidence that retaining those acronyms would fix ranking.
- **Mention detection is not ownership evidence.** [extractSkills](../src/main/ingest/skills.ts) checks phrase presence across raw CV text. C06 receives all six detected Arabic-posting skills, although its education text attributes well-design and torque/drag work to other engineers. C13 receives hydraulics and torque/drag credit from an analogous attribution. The detector does not resolve negation, supervision, responsibility or required tenure. C03's three years can therefore coexist with a high match against a five-year requirement.
- **Some education text still inherits experience classification.** [splitSections](../src/main/ingest/sections.ts) does not recognize C03's “Education and development” or C13's “التعليم والخبرة الفنية”; their bodies remain within experience sections. C03's “Selected project” also remains there. The misclassification is observed; its individual ranking effect has not been isolated. Resetting an unknown heading to `other` alone would not reduce its weight: `other` and `experience` both currently weight 1.
- **Evidence and query content include weak context.** Both postings produce 19 parsed requirements, including location metadata and the final evaluation instructions saying how to assess CVs and that CV language is irrelevant. These receive the same per-query averaging treatment as technical requirements. [chunkSections](../src/main/ingest/chunk.ts) also retains the first short chunk, including the two-word document header. Every inspected evidence bundle for C02/C03/C06/C07/C11/C13/C15 includes an `other` passage; section inspection identifies that sole `other` section as the header. The saved reports retain section/similarity, not full passages or per-requirement contributions, so they cannot quantify which query promoted each passage.

## Follow-up hypotheses and validation

Potential general corrections are distributing the fixed lexical budget across the whole posting, separating assessment instructions from explicit job requirements, recognizing independently justified education headings, and excluding short header-only chunks when substantive body chunks exist. Attribution-aware skill evidence needs a separate design. These are hypotheses for controlled tests, not fixes demonstrated by this comparison; do not tune them to candidate IDs or amend the frozen labels to fit results.

First capture raw per-requirement semantic contributions and selected evidence text in isolated synthetic diagnostics. Test each proposed change separately against independent examples and all existing ranking guards, retaining the frozen results above. Do not change model or scoring weights solely to improve this packet.

The Arabic and English CV groups contain **different candidate content**. Consequently these observations cannot establish a causal language effect or language fairness. Create a separate, domain-reviewed set of paired translations with identical qualifications and responsibilities. Have recruiters and a drilling-domain reviewer complete [blind relevance review](RELEVANCE_REVIEW.md) before seeing rankings; validate posting equivalence, ownership/negation judgments and omissions. Until those steps are complete, stronger recall in this synthetic run is progress, not proof of recruiter usefulness or release readiness.
