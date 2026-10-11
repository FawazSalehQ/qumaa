# Oil & Gas Drilling Engineer pilot fixture

This is a synthetic example prepared for Qumaa's recruiter pilot on 2026-09-21. It contains a fictional Saudi onshore vacancy in English and Arabic and 16 independently authored CVs: eight in English and eight in Arabic, with two of each language in each provisional relevance tier. Every candidate, employment history, project outcome and employer name is invented. Any resemblance to a real organization or person is coincidental. No real applicant data or contact details are included.

The vacancy asks for at least five years of direct drilling engineering experience and broad well-planning and execution responsibility. Neither language of CV authorship nor Arabic fluency is a selection requirement. The two vacancy files express the same responsibilities and requirements.

## Files and label separation

- `posting-en.txt` and `posting-ar.txt`: vacancy text for the two retrieval runs.
- `corpus/C01.md` through `corpus/C16.md`: neutral-ID candidate source documents. Filenames and CV text do not contain tier labels or judgments about suitability.
- `labels.json`: provisional relevance grades used only by the evaluator after ranking.
- `facilitator-rubric.md`: predeclared evidence rationale, CV language mapping and human-review procedure. Keep this outside candidate import.
- `fixture-sha256.json`: hashes of the authored postings, CVs, labels and rubric captured before scoring. A later fixture revision should be explicit rather than silently replacing a baseline.

Labels were fixed before any scorer was run or ranking output was seen by the fixture author. Four candidates are tier 1, so the ideal top-three set is any three from that group; there is no required within-tier order. The fixture includes a keyword-rich summary with data/reporting employment (C08), specialist drilling roles, and unrelated foundation-drilling terminology to probe evidence quality and false positives.

Markdown is a supported Qumaa import format and the source format for these reproducible text-ranking checks. A headless ranking run does not test DOCX/PDF extraction, visual resume layout, scanned PDFs, duplicate handling, the renderer, or recruiter usability. The separate packaged-app check exercises these Markdown files in the UI; generic extractor/integration checks elsewhere in the project are separate evidence. Derived PDF/DOCX files, if generated for a later format comparison, must retain the same source content and neutral IDs.

## Domain references

Primary references were checked on 2026-09-21 and used to ground role scope and terminology, not copied as the fictional vacancy or candidates:

- [SLB Drilling Engineer vacancy](https://careers.slb.com/jobdescription.aspx?id=87172): direct engineering experience, planning/execution/post-job responsibility, operational risk, performance and lessons learned. This referenced vacancy is in Angola; the Saudi scenario here is fictional and is not a claim about SLB hiring in Saudi Arabia.
- [Halliburton drilling and completions engineering](https://www.halliburton.com/en/products/drilling-and-completions-engineering): casing design, bit programs, fluids and hydraulic engineering within well planning.
- [SLB DrillPlan](https://www.slb.com/products-and-services/delivering-digital-at-scale/software/delfi/delfi-solutions/drillplan): integrated well-design analysis, including trajectories, casing, hydraulics, torque/drag, risk and cost planning.

The relevance rubric is authored for this example. It is not an industry certification standard or a validated hiring benchmark. A recruiter and a drilling subject-matter reviewer still need to check the vacancy, Arabic terminology, profiles and provisional grades independently before results are treated as hiring-quality evidence.

## Limits and next validation

This small, balanced corpus is useful for finding obvious domain-coverage gaps and ranking regressions. It is not representative of applicant prevalence, document quality, all drilling specializations or a real hiring decision. Do not present synthetic ranking scores as recruiter pilot success. Distinct English and Arabic CVs are not controlled translation pairs, so group results cannot by themselves establish language fairness.

Retain the first baseline, then run an observed recruiter session with import-ready fictional documents. Record independently chosen candidates and evidence before displaying system recommendations. Once the workflow is usable, a separately authorized, privacy-conscious real-world pilot can evaluate representative vacancies and applications. No recruiter outreach or external sharing is implied by creating this fixture.
