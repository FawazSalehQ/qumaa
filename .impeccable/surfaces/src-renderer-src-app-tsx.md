---
version: 1
slug: "src-renderer-src-app-tsx"
primary_target: "src/renderer/src/App.tsx"
related_targets: ["src/renderer/src/views/JobsView.tsx","src/renderer/src/styles.css"]
---

# Surface brief: Qumaa application shell and Jobs workspace (src/renderer)

Scope: the whole Electron renderer (Jobs, Companies, Recruiter desk, Library, Settings, candidate detail), first surface the Jobs workspace. Visitor mode: Operate.

Audience and job: an agency headhunter on a laptop, evenings or on the move, screening a bilingual candidate table against a vacancy, then moving people through a pipeline for a client. Task: read the ranked table, open evidence, decide review states, shortlist, act. Content: real local data only; fictional fixtures for captures. Constraints: brand kit pinned (IBM Plex families, ink #2b2733, violet #6d3fb0, paper #f4f1f8, funnel mark, RTL lockup); light, dark and Arabic RTL are equals; Playwright labels, roles and class hooks stay stable; no network, no new fonts; prefers-reduced-motion honoured.

Chosen direction: Wayfinding (user's pick on 11 Oct 2026 over the assigned Ruled Page). Memorable moment: the hiring funnel drawn as a transit line of stops in the job header, and every status, stage, job and client carrying a line badge.

Unresolved: whether companies-as-lines colour assignment should be user-editable (not in this round).

## Direction contract

THESIS: Qumaa reads like Riyadh's bilingual wayfinding: every job, client, stage and status carries a line badge, and the hiring funnel is a transit line of stops. It refuses the ATS arrangement of grey sidebar, white cards and kanban.

OWN-WORLD: graphite shell derived from brand ink (header band in both themes), white and paper grounds in light, tonal graphite ladder in dark; six line colours doing real jobs (violet action and selection, green open/shortlisted, blue contacted/filled, amber maybe/today, orange on-hold, red overdue/contradicted); IBM Plex Sans at signage weights, Plex Mono tabular numerals; rounded-square badges, pill states, arrow strips on row actions; flat surfaces, tone not shadow.

STORY: the recruiter sees at once which client line a job belongs to, where each candidate stands on the line, and what to do next; evidence is one click away and never implied as a verdict.

FIRST VIEWPORT: graphite header with lockup and five tabs; saved-jobs column with badge per job, company line colour; workspace header with job badge, status pill and actions; the funnel line of stops (Matched, Reviewed, Shortlisted, Contacted, Hired) replacing the stats band; underline tabs; the candidate table as a station board with score boxes, stage and review badges and an arrow-strip Review action; selection and primary action in violet.

FORM: Riyadh Metro / KAFD wayfinding, position 1 of 7 on the ranked list, presented as the pick card; seed key 9bd6e20f.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
