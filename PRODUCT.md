# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Agency recruiters and headhunters (confirmed 11 October 2026) who work several
client companies at once, in Saudi Arabia and the wider Gulf, in English and
Arabic. They screen incoming CVs against a vacancy, build and defend a
shortlist with evidence, keep client companies, contacts and pipelines in
order, and present candidates to clients. In-house HR teams can use the same
workflows but are not the design target.

Situation (confirmed): mostly on a laptop, in the evenings or on the move,
under mixed lighting. Sessions alternate between long screening passes over
tables of candidates and short administrative tasks such as logging a call,
changing a job status or exporting a client pack.

## Product Purpose

Qumaa (قُمع, "funnel") is an offline desktop recruitment workspace. It ingests
resumes (digital PDF, DOCX, Markdown, pasted text) into a local SQLite library,
matches them against a job description with local multilingual embeddings plus
keyword and skill-term signals, and shows the recruiter the passages that
support each match so the decision stays theirs. Around that core it keeps
companies, jobs with salary and hiring budgets, Saudi employment-cost plans,
contacts, follow-ups, talent pools, per-job pipelines, screening kits and
client PDF packs. Success is a recruiter who gets from a pasted posting to a
defensible, evidence-backed shortlist faster than by reading every CV, without
any candidate data leaving the machine.

## Positioning

Everything runs on the device: matching, storage and exports work with no
account, no server and no network. Scores are relative text matches with
visible evidence, never probabilities or verified qualifications, and missing
text never auto-rejects anyone; the product supports recruiter judgment rather
than replacing it. Arabic and English are peers: resumes in either language
rank against postings in either, and the whole interface mirrors into Arabic
RTL. Optional AI reranking uses the user's Anthropic/OpenAI API key or eligible
ChatGPT plan, with explicit per-send consent. Connecting a ChatGPT account and
refreshing its models or credentials also contact OpenAI. Neighbouring products are
cloud applicant-tracking systems with accounts, cloud pipelines and opaque
scores.

## Operating Context

- Workflow: import CVs (drag and drop, folder, watched folder, paste) → Jobs:
  Express search or a saved job → review candidates, scorecards and passages →
  shortlist, compare, export PDF/CSV → pipeline, screening kit, client pack →
  change job status and record the hire with up to two backups.
- Companies hold industries, locations, contacts, notes, jobs, target-company
  maps and saved Hiring Budgets & Costs plans (Saudi GOSI and end-of-service
  monthly planning in SAR).
- Recruiter desk holds people (from CVs or manual prospects), activities and
  follow-ups, and talent pools.
- Data: a library of hundreds to a few thousand resumes; names, contact
  details, skills, years, education; mixed English and Arabic documents, often
  with Latin acronyms inside Arabic text; Arabic and Persian digits accepted in
  numeric inputs.
- Environment: macOS Apple Silicon and Windows x64 Electron app; the window is
  often narrower than 1440px on a laptop; light, dark and system themes;
  English LTR and Arabic RTL interface, Gregorian dates in Arabic.
- Documents it produces: shortlist PDF/CSV, client pack PDF, budget CSV,
  portable backups.

## Capabilities and Constraints

- Local-first by contract: no background provider calls on startup. Network
  access requires an explicit API rerank or ChatGPT connection action; the
  renderer is sandboxed with context isolation and a strict CSP; only the named
  preload operations exist.
- Matching, extraction and ranking are outside the UI's remit. The UI presents
  relative scores, evidence passages and recognized skill terms honestly, never
  as verified qualifications, and never implies that unrecognized terminology
  means a missing qualification.
- OCR and scanned PDFs are out of scope; the UI says so where files are rejected.
- Hiring is across all domains; no industry-specific presentation.
- Playwright UI tests drive the real app by accessible names and a small set of
  class selectors (the candidate table, consent payload, job context and
  similar). A redesign keeps labels, roles and those hooks stable.
- Fonts are bundled (IBM Plex Sans, IBM Plex Sans Arabic, IBM Plex Mono) and
  nothing is fetched at runtime, so the design cannot depend on other faces.
- Arabic text is never tracked or case-transformed; mixed-script values are
  bidi-isolated; layout uses logical properties so one stylesheet serves both
  directions.
- `prefers-reduced-motion` disables non-essential motion.
- Terminology: Jobs, Express search, Companies, Recruiter desk, Library,
  Settings; candidates, shortlist, compare, pipeline, client pack, screening
  kit, talent pool, follow-ups; relative match score.
- Undecided: code signing and notarization; the published recruiter guides
  (PDF/PPTX) predate the current screens and are updated separately.

## Brand Commitments

- Name قُمع / Qumaa; the funnel mark (two tinted sheets over a solid funnel)
  and the ink app-icon tile from `brand/`. The Arabic lockup reads right to
  left with the mark to the right of the wordmark. Never recolour the funnel;
  below 20px the mark drops its top sheet.
- Palette commitments: ink #2b2733, violet #6d3fb0 (sheet tints #8f5fd6 and
  #c0a3ea), paper #f4f1f8.
- Typography commitments: IBM Plex Sans (Latin), IBM Plex Sans Arabic
  (Arabic), IBM Plex Mono (small all-caps labels at 0.24em tracking), all
  bundled.
- Creator attribution "Fawaz Aljathnan" with the LinkedIn link
  https://www.linkedin.com/in/fawazsalehq/ at the bottom of Settings.
- Confirmed visual rejections (11 October 2026): the generic SaaS dashboard
  look (grey sidebar, white cards, blue buttons); consumer-app softness (large
  radii, pastel gradients, illustrations, playful copy); the template looks
  that read as AI-generated (warm cream with serif display, neon on near-black).
- Confirmed: light, dark and Arabic RTL are equals; none is an adapted mode.

## Evidence on Hand

- Brand kit in `brand/` (SVG marks, `tokens.json`, `BRAND.md`) and the
  extended kit at `../../Qumaa` (lockups, favicons, letterhead and deck
  templates).
- Baseline screenshots of every screen in light, dark, English and Arabic with
  fictional data: `docs/ui/baseline-2026-10-11/screenshots/`, plus the written
  baseline spec beside them.
- Recruiter guides (English and Arabic PDF/PPTX) in `presentations/`, with
  real-app screenshots of beta.2.
- Only fictional fixture data exists. No real CVs, clients, testimonials or
  outcome figures are in the repository, and none may be invented.

## Product Principles

1. The recruiter decides; the interface shows evidence, never verdicts.
2. No candidate data leaves the machine except an AI rerank the user confirms
   each time; ChatGPT sign-in, account switching, model and token refresh and
   sign-out send account credentials and a per-installation identifier, never
   candidate data, and only as part of a user action.
3. Arabic and English are peers, in content and in chrome.
4. Screening is a table scan; the candidate table is the product.
5. Trust reads as restraint: state, selection and evidence earn colour,
   decoration does not.

## Accessibility & Inclusion

Keyboard operation with a visible focus ring on every control; roles and
accessible names on all interactive elements (the UI tests depend on them);
RTL mirroring with correct bidi isolation for mixed-script data; Arabic and
Persian digit entry; `prefers-reduced-motion` respected; text contrast must
hold in both themes.
