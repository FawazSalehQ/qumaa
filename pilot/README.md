# Recruiter pilot: drilling engineer

Status: prepared protocol; no recruiter sessions or human relevance findings have been recorded. Use [BASELINE.md](BASELINE.md) for the frozen first baseline and [QUALITY-2026-09-23.md](QUALITY-2026-09-23.md) for the latest engineering checks and their limits. The expanded [recruiter workflow exercise](RECRUITER-WORKFLOW-2026-09-23.md) covers companies, budgets and the recruiter desk separately from blind relevance review.

The first pilot evaluates Qumaa for an **Oil & Gas Drilling Engineer** vacancy, using the dedicated [synthetic packet](../eval/pilots/drilling-engineer/README.md): 16 CVs, eight English and eight Arabic, with neutral IDs C01–C16. The [English posting](../eval/pilots/drilling-engineer/posting-en.txt) and [Arabic posting](../eval/pilots/drilling-engineer/posting-ar.txt) need human domain/translation review. It does not establish suitability for every engineering vacancy. Local matching is the default: leave AI reranking disabled and enter no provider keys.

## People and preparation

Proposed first round: **3–5 recruiters**, including at least two who screen drilling-engineering applicants. Include Arabic-first and English-first users, and cover macOS Apple Silicon and Windows x64 if both platforms will be deployed. Record gaps instead of treating an untested platform or language as passed. A drilling-domain reviewer should check the synthetic posting and relevance rubric before sessions.

Each participant completes blind CV relevance review before a **60-minute moderated session**. Allow a separate 30–45 minutes for blind review; extend this if needed. Use participant codes such as P01 in notes. Keep scheduling and contact details outside this repository. No invitations have been sent.

Facilitator checklist:

- [ ] Freeze the app version/build, posting, criteria and synthetic CV set; record them in [SESSION.md](SESSION.md).
- [ ] Give participants only the posting, [C01–C16 CVs](../eval/pilots/drilling-engineer/corpus/) and blank relevance form. Hide `labels.json`, the facilitator rubric, fixture README, expected rankings, generation notes and baseline results. Initial synthetic labels are agent-authored hypotheses, not human findings.
- [ ] Use all C01–C16 for each ranking comparison. The set contains relevant drilling profiles and adjacent roles to test discrimination. Prepare a separate, clearly fictional pasted-text CV solely for the later refresh task; it must not replace a core candidate or appear in the frozen comparison.
- [ ] Have at least two reviewers independently complete [RELEVANCE_REVIEW.md](RELEVANCE_REVIEW.md) before seeing Qumaa results. Resolve differences using CV evidence before exposing scores. Keep initial and agreed labels.
- [ ] Prepare equivalent English and Arabic posting text, reviewed by a bilingual domain reader. Preserve requirements across languages. Label any unreviewed translation as provisional.
- [ ] Include digital PDF and DOCX inputs as well as both CV languages; verify source content is equivalent when comparing formats. If the supplied fixtures are Markdown only, record PDF/DOCX coverage as pending until copies are prepared. Import one representation per candidate for ranking; use separate clean libraries for controlled format comparisons.
- [ ] Keep copies, completed forms and exports in the private local session folder. Commit blank templates and synthetic fixtures only; keep recruiter details, real CVs and completed feedback private.

## Start with an isolated library

The app's `QUMAA_E2E_USER_DATA` hook sets an absolute, disposable data directory before database startup. This is the same mechanism used by packaged UI tests, in [src/main/index.ts](../src/main/index.ts) and [test/e2e/app.spec.ts](../test/e2e/app.spec.ts). Use it through the facilitator's terminal; do not launch the usual desktop shortcut for a pilot session.

1. Quit all Qumaa windows and processes before launching the pilot. The app has a single-instance lock.
2. From the repository root, using Node 22 or newer, run the launcher preflight and then start a session:

   ```sh
   node scripts/start-recruiter-pilot.mjs --check
   node scripts/start-recruiter-pilot.mjs
   ```

3. Record the session folder and chosen executable printed by the launcher. Each normal launch creates a fresh isolated library under `.local/pilot/sessions/`; keep the folder for that participant. The launcher prefers the packaged app. A deliberately selected `--source` session uses the built checkout and does not validate the released installer.
4. Before importing, confirm Library and Jobs are empty, no watched folder is configured, and AI reranking is disabled. If existing records appear, stop and fix isolation; do not clear or restore the library.

For the restart task, quit Qumaa and run the exact reopen command printed by the launcher: `node scripts/start-recruiter-pilot.mjs --resume=drilling-XXXXXX`, replacing `drilling-XXXXXX` with the real session basename. This reopens the **same session**; omitting `--resume` creates a fresh participant session. At session end, quit Qumaa and retain the private session folder until findings are reconciled; then remove only that recorded folder under the agreed retention policy. Do not use app-wide deletion, backup restore or `npm run seed` to prepare a pilot.

## The 60-minute session

Explain: “We are testing the app. Please think aloud. Use the fictional records to show what you would do.” Use task goals first; give the control hints below only when needed, and mark assistance. Capture elapsed time, errors, help and the participant's words in [SESSION.md](SESSION.md). Stop a task after five minutes of being stuck, show the next step, and continue.

| Time | Participant task | Facilitator checks / control hints |
| --- | --- | --- |
| 0–5 min | Explain how you currently screen drilling-engineering CVs and choose a UI language. | Record experience, language and expectations; do not disclose reference labels or ranking. |
| 5–12 | Import the prepared core CV set and check one English and one Arabic CV. Reimport one exact duplicate. | Library → Add files / Import folder. Record imported/skipped/failed counts and wall time. Inspect extracted text, role and dates. Image-only PDF OCR is outside the current product; do not count it as supported. |
| 12–20 | Search the drilling-engineer posting without creating a saved vacancy; inspect the first three candidates. Repeat with the paired-language posting, then keep the preferred posting as a job. | Jobs → Express search → description/requirements → Find matches. Record each unfiltered top 10 and time before changing the posting. Use Edit search for the paired run; restore the preferred posting and run again, then Save as job. Confirm no saved job until explicitly saved and the same final order after saving. |
| 20–30 | Explain why a top candidate fits and what remains uncertain. Review one strong candidate and one adjacent-role candidate against required criteria. | Open candidate → Score breakdown / Matching passages / CV text. Review → Evidence found / Needs clarification / Not stated. Save job-specific notes. Ask where supporting text came from; do not teach that missing text means rejection. |
| 30–37 | Record fictional availability or notice details, choose three shortlisted candidates and compare at least two. | Add details / Edit profile; Review → Shortlisted; Compare checkboxes → Compare candidates. Check required/preferred criteria and uncertainty are understandable. Keep hypothetical details clearly fictional. |
| 37–42 | Arrange the shortlist for a hiring manager and export PDF and CSV. Open both files. | Shortlist → arrows → Export PDF / Export CSV. Check the full selected order, notes, Arabic shaping and column readability. Export files into the isolated session folder. Exports are local files. |
| 42–49 | Record a hypothetical hire plus a different backup, quit/reopen the same isolated session, then import the reserved extra CV and refresh matches. | Change status → Filled; select hire and optional backup #2. Check dated history and View CV. Relaunch with the same override. Check saved job/reviews/shortlist/hiring record, stale/new-CV notice, then Refresh matches and preservation of decisions. |
| 49–55 | Switch UI language, read saved evidence and compare candidates again. Check an export. | Inspect RTL, mixed script, numbers, navigation and PDF/CSV controls. The paired ranking comparison was recorded before the refresh CV; do not substitute these later results. If time runs out, mark untested checks pending. |
| 55–60 | Debrief. | What was unclear? Which evidence changed your mind? What would prevent everyday use? Overall ease 1–5; confidence finding source evidence 1–5; single most valuable fix. |

Counterbalance English-first and Arabic-first searches across participants. Record UI language, posting language and CV language separately. If paired ranking review cannot fit, complete it in a separate measured follow-up on the same frozen core set and leave the metric pending until then. The facilitator and domain reviewer complete any remaining source-evidence audit after the session, identifying who performed each check; participant observations and facilitator checks stay distinct.

## Proposed decision criteria

These are first-round targets, not established product performance or statistical claims. Agree them before viewing human results. Count actual numerators/denominators; with 3–5 users, a single participant can materially change percentages.

| Area | Proposed target |
| --- | --- |
| Core usability | At least 80% of participants complete each of import, Express search/save, evidence/review, shortlist/compare/export and saved-job recovery without facilitator directions. Count assisted, failed and untested separately. |
| First result | At least 80% reach a usable result within five minutes of starting Express search, after import/indexing is complete. Report model/ingest/search time separately. |
| Human ranking | For each language on the frozen set, at least two of the top three have agreed grade 3 relevance; no grade 0 candidate is in the top three. Report P@3, R@3, MRR and NDCG@10 with the exact grade rule in the review form. |
| Evidence | Review the top three against three agreed job criteria. At least 80% of the nine checks per language lead to relevant source evidence or clearly recognized missing/uncertain evidence; zero claims incorrectly accepted as verified because of the UI. |
| Records and exports | All exercised saves, restarts and refreshes retain the intended notes, shortlist order and hiring records; opened PDF/CSV contain the intended shortlist and readable Arabic/English text. |
| Readiness | No unresolved S1 or S2 issue. Median overall ease rating at least 4/5. Document any untested platform, file type or language before proceeding. |

Treat a failed gate as a fix/retest item. Check extraction, posting interpretation and domain skill coverage before tuning ranking weights. The September 23 development source adds nine drilling concepts with Arabic aliases; the original baseline and September 22 packages predate that coverage. Examine detected requirements and record the exact build. Do not adjust relevance labels to fit app results. A small synthetic pilot does not measure real-world hiring outcomes or establish fairness; a later authorized, de-identified real-CV round is still required.

Severity: **S1** = real-library impact, unintended data sharing or unrecoverable record loss; **S2** = core task blocked, saved decisions wrong, materially wrong export or consistently misleading evidence; **S3** = recoverable friction or confusing presentation; **S4** = cosmetic issue. Record reproduction steps and impact, then prioritize by severity and how many sessions reproduced it. Use candidate/participant codes in issues.

## Human work still pending

- Select and schedule participants; no outreach is part of this kit.
- Domain-review both posting versions, blind-label the synthetic set, and freeze the final packet.
- Run the sessions on available target platforms and supported formats; collect actual observations.
- Review disagreements and failures, fix and retest the affected flows, then decide whether to expand to a real recruiting workflow.

UI behavior references: [FEATURE_IMPLEMENTATION.md](../FEATURE_IMPLEMENTATION.md), [English guide source](../presentations/source/build_guide.py), and [JobsView.tsx](../src/renderer/src/views/JobsView.tsx). Express export is the top three before filters; a saved-job shortlist export contains the entire chosen shortlist, including candidates hidden by display filters.
