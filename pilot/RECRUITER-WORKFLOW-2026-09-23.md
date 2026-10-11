# Recruiter workflow pilot — 23 September 2026

**Prepared task packet; no participant has completed this packet and no human findings are recorded here.** Run it on a frozen build after engineering checks. Human recruiter sessions and Windows runtime coverage remain pending until actual runs are recorded. An installer build or automated test is not a participant session.

This self-guided exercise covers the company-to-client workflow added to Qumaa. Allow 75–90 minutes, or split it into two sittings using the same isolated session. Copy this file into the private session folder and record results there. Use [SESSION.md](SESSION.md) for participant setup, issue severity, evidence attachments and debrief; the task table below replaces its task list for this exercise.

For **matching relevance**, use [the existing pilot protocol](README.md) and [blind relevance review](RELEVANCE_REVIEW.md). Complete independent labels before exposing reviewers to rankings or fixture labels. The existing synthetic labels remain provisional. The small fictional records below test workflow behavior; they are not relevance ground truth, and their search scores must not be reported as evidence that matching quality is acceptable.

## Record the build and session

| Field | Record before starting |
| --- | --- |
| Participant code / date / time zone | |
| OS version / CPU architecture / screen size | |
| App version and source commit, if known | |
| Installer or executable path and SHA-256 | |
| Packaged build or development checkout | |
| Starting UI language / second UI language | |
| Source session name and isolated library path | |
| Exact reopen command printed by the launcher | |
| Restore-test session name and isolated path, when created | |
| Observer or support person, if any | |

Follow [Start with an isolated library](README.md#start-with-an-isolated-library). Quit every Qumaa instance first, run the launcher's preflight, and use its new session command. If the chosen build is a checkout, record that explicitly; do not describe it as installer validation. The launcher supports both release target platforms but requires their local unpacked build or built checkout. Ask the session organizer to prepare the launcher if necessary; record setup help separately from app-task help.

Before typing anything, verify **Library, Companies, Jobs and Recruiter desk are empty**, AI is off, no API keys are entered, and no watched folder is set. Confirm the library path belongs to this session. If any real records appear, stop and correct the launch target. Do not wipe a library to prepare this exercise.

Use only the invented information below. Email addresses and websites use reserved example domains; do not contact anyone or send a client pack. Calls, submissions and feedback are records of a fictional scenario. Leave optional AI disabled. OCR and scanned-image intake are outside this packet and the product scope.

## Fictional records

Create these companies:

| Record | Values |
| --- | --- |
| Hiring company | **Pilot Wellworks — شركة الاختبار**; industry **Energy**; location **Dammam**; contact **Dana Pilot**; email **dana@wellworks.example**; website **https://wellworks.example**; company notes **Internal pilot client context — do not include in presentation.** |
| Target employer | **Pilot Horizon Wells — آبار الاختبار**; industry **Energy**; location **الخبر**; website **https://horizon.example** |

Create the main job from **Jobs → New job**:

| Field | Value |
| --- | --- |
| Position | **Pilot Drilling Engineer** |
| Hiring company | **Pilot Wellworks — شركة الاختبار** |
| Job description | **Plan fictional onshore drilling work and coordinate safe field execution. This is a usability exercise.** |
| Requirements | **Experience preparing drilling programs.** and **Describe a well-control responsibility.** on separate lines |
| Education and certifications | **Engineering degree; confirm supporting details during screening.** |
| Salary budget | **20,000–28,000 SAR monthly**, per person |
| Total hiring budget | **50,000–70,000 SAR**, for the vacancy |

Paste the following two CVs separately through **Library → Paste text**. Use titles **Workflow W01** and **Workflow W02** if prompted. These are purpose-written workflow records; do not add them to the frozen 16-CV relevance library.

```text
Nadia Pilot
Dammam, Saudi Arabia
nadia@candidates.example

SUMMARY
Fictional drilling engineer prepared for a software usability exercise.

WORK EXPERIENCE
Pilot Horizon Wells — Drilling Engineer
2019–2023
Prepared onshore drilling programs, reviewed well-control procedures and coordinated daily operations with field crews. Recorded technical decisions and reviewed project changes with the team.

EDUCATION
BSc Engineering, 2018

SKILLS
Drilling engineering, well control, drilling programs
```

```text
هدى التجريبية
الخبر، السعودية
huda@candidates.example

## الملخص المهني
مهندسة حفر افتراضية أعدت بياناتها لاختبار استخدام البرنامج فقط.

## الخبرة العملية
آبار الاختبار — مهندسة حفر
2019–2023
أعددت برامج الحفر البري وراجعت إجراءات التحكم بالآبار ونسقت العمليات اليومية مع الفرق الميدانية. وثقت القرارات الفنية وناقشت تعديلات المشروع مع الفريق المسؤول عن التنفيذ.

## المؤهلات العلمية
بكالوريوس هندسة، 2018

## المهارات التقنية
هندسة الحفر، التحكم بالآبار، برامج الحفر
```

Also create one **prospect without a CV** in Recruiter desk:

| Field | Value |
| --- | --- |
| Name | **Lee Pilot** |
| Current employer / role | **Pilot Horizon Wells / Drilling engineer** |
| Email / source URL | **lee@candidates.example / https://profiles.example/w03** |
| Location / contact skills | **Dammam / Drilling engineering, Well control** |
| Contact tags | **workflow-pilot** |
| Availability | **30 days after a fictional offer** |
| Contact notes | **INTERNAL-CONTACT-W03 — ask for a CV.** |

## Tasks and measurable outcomes

Start with the goal in the second column. The control names provide self-service directions; record when you first need them. An observer must not count a directed task as unassisted discovery. Record elapsed seconds and retries rather than treating the suggested session duration as a pass limit. Stop after five minutes stuck on a step, record the obstacle, and continue where possible.

| ID | Task and directions | Expected outcome to verify |
| --- | --- | --- |
| W01 | Create both companies through **Companies → + New company**. Open each again. | Exactly **2** companies; mixed-script names, location, hiring contact and company note retain the entered values. |
| W02 | Create **Pilot Drilling Engineer** from **Jobs → New job**, selecting **Hiring company** and both budget checkboxes. Save it, then open the company. | Exactly **1** job; the correct company and both ranges appear in Jobs and under the hiring company. Salary shows **SAR / month**; total hiring budget has **no pay period**. |
| W03 | Edit the main job's maximum salary to **30,000**. Keep its minimum, currency and pay period unchanged. Then use the hiring company's **+ New job for company** to create **Pilot Backup Assignment** with description **Separate fictional assignment**, leaving budgets off. | Main salary is **20,000–30,000 SAR monthly**; total stays **50,000–70,000 SAR**. The second editor prefills the hiring company. The company now has exactly **2** jobs; the second has no budget and does not overwrite the first. |
| W04 | In the main job choose **Target companies → Edit company map**. Add Pilot Horizon Wells; set **Researching**, target role **Drilling engineers**, note **Fictional sourcing research**; save. Edit its status to **Excluded**, save, then restore **Researching**. | Exactly **1** target remains, retaining role and note. The hiring company is unavailable as its own target. Excluded is described as a sourcing-plan status; it does not promise automatic removal of candidates from results. |
| W05 | Paste both CVs, inspect their extracted text, then open Recruiter desk. Create Lee Pilot from the table. | Exactly **2** CVs and **3** contacts. Nadia and Huda have CVs; Lee does not. The Arabic CV's experience heading is not evidence that the person lives in Khobar: here **الخبر** is justified by the separate address line. Check actual source text for any disputed field. |
| W06 | For Lee, choose **Log activity**: record a fictional call, summary **Discussed pilot role**, outcome **Interested**, next action **Arrange screening**, related job **Pilot Drilling Engineer**, and **Follow-up due yesterday at 10:00 local time**. Save. In **Follow-ups**, complete it, inspect Completed, and reopen it. | One activity is saved with the selected job and date. Its reminder appears overdue, then completed, then overdue again. Contact history remains present. This is local tracking; no message or OS reminder is expected. |
| W07 | Assign all three contacts to the main job, using **Add to job → Create assignment** or the job's **Pipeline → Person to add → Add to pipeline**. Edit Lee's stage to **Interested** and set internal notes to **INTERNAL-PIPELINE-W03**. Save, then edit toward Interviewing and **Cancel**. | Main job has exactly **3** distinct pipeline people, including Lee without a CV. Lee remains Interested after cancellation; saved stage changes are dated. The second job's pipeline stays empty. |
| W08 | For Lee, **Prepare screening kit**, then **Cancel**. Prepare again, title **Pilot screening W03**, edit a question to **Describe your well-control responsibility**, answer **I coordinated the fictional crew briefing**, mark **Candidate stated**, and add internal notes **INTERNAL-SCREENING-W03**. Save. Prepare a later kit and cancel it. | First cancellation leaves no saved kit. Exactly **1** kit remains after the complete task, with the edited question, answer and candidate-stated label. Preparing a later call does not overwrite the saved answer. A statement has not become recruiter-verified merely by saving it. |
| W09 | For Lee, **Log submission** to **Dana Pilot**, notes **Fictional submission recorded for usability testing**, then **Record feedback**: **INTERNAL-FEEDBACK-W03 — arrange a discussion**. | Exactly **1** submission records recipient, date and hiring company. From Interested, Lee advances to Submitted with history. Feedback is attached and readable. No external send is expected. The vacancy's overall status remains unchanged. |
| W10 | For an optional reusable list, create a manual **Talent pool** named **Pilot follow-up list**, add Lee, and **Mark reviewed**. Toggle **New since last review** on and off. | Exactly **1** pool with **1** member. The reviewed member is hidden by the new-only filter and returns when the filter is removed; membership is not deleted. Mark this step untested if skipped. |
| W11 | Build and inspect the client presentation using the checklist below. Export the reviewed PDF locally and open it. | Exactly the selected **2** people, in the selected order, with the authored recommendations, one chosen CV passage and one chosen screening answer. Internal markers do not appear. Preview and exported content agree. |
| W12 | Save all record edits and switch **Settings → Language** to the other language. Reopen Companies, the main job, Lee's contact/pipeline and the saved screening. Build a second short presentation in the other UI language and open its PDF. | English/Arabic controls remain usable; Arabic layout is RTL; numbers, currency, emails, mixed-script names and exported Arabic are readable. Saved content retains its authored language. Record clipping, focus problems and mistranslated labels rather than treating a screenshot as a pass. |
| W13 | Quit and reopen the **same** session using its printed reopen command. Then perform the backup/restore exercise below. | The persisted-record ledger matches before quit, after restart, and in the separate restored session. Any difference gets an issue and remains unresolved until checked. |

## Exact client presentation check

Before choosing CV passages, open the main job and run **Find matches** (or
**Refresh matches**) against the two imported CVs. This supplies the saved
evidence choices. Record any search error, but do not grade ranking relevance
from these two workflow examples.

In the main job's **Client pack**, set firm name **Pilot Search**, introduction **Fictional client presentation for usability testing**, and select **Nadia Pilot first, Lee Pilot second**. Write a short fictional recommendation for each. For Nadia, select one CV evidence passage containing the drilling work. For Lee, select the saved screening answer and availability. Leave unrelated fields unchecked. If compensation is exercised, first record a fictional expectation in the CV recruiter's profile; job salary budgets are a different record.

Use the default **blind presentation** for the first export. Choose **Preview client presentation**, then compare each item below with **Export reviewed PDF** and the opened file. A blind layout hides names and contact fields but does not redact arbitrary identifying text: inspect the actual chosen passages and recommendations. Remove identifying free text before describing the sample as anonymous.

- [ ] Exactly two candidates, ordered Nadia then Lee; blind headings use candidate labels.
- [ ] Exactly the authored introduction and recommendations; no extra candidate is included.
- [ ] Nadia's selected passage agrees with her source CV; Lee has no invented CV evidence.
- [ ] Lee's selected answer retains its **candidate-stated / not independently verified** meaning.
- [ ] Only selected optional fields appear; names, emails and phone fields are absent in blind mode.
- [ ] None of **INTERNAL-CONTACT-W03**, **INTERNAL-PIPELINE-W03**, **INTERNAL-SCREENING-W03**, **INTERNAL-FEEDBACK-W03**, or the internal company note appears.
- [ ] Editing a recommendation after preview requires a new preview before exporting the revised content.
- [ ] English and Arabic PDFs are readable when opened outside Qumaa; record the viewer and file names.

After exporting, use **Reset presentation** to clear the working draft before moving on if needed. Presentation drafts are not part of the persistence ledger: preserve the exported PDFs outside the library, and rebuild a presentation from saved source records when required.

## Restart and restore into a separate empty session

This restore is an explicit test on a second disposable library. It is not a way to prepare or reset a participant's original library.

1. Complete the ledger below in the original session, quit, and reopen that same session. Check every saved value before creating the backup.
2. In **Settings → Back up…**, save a backup into the private session folder. Record its file name, size and creation time. Keep the original session and exported PDFs.
3. Quit Qumaa. Start the launcher **without `--resume`** to create a second empty isolated session. Record its different path and reopen command; verify all record lists are empty.
4. Use **Settings → Restore…** to select the backup. Read the replacement confirmation, confirm the destination is this empty test library, and wait for index rebuilding to finish.
5. Compare the restored ledger. Refresh saved-job matches if you choose to search: cached matches and saved AI ordering are rebuilt, not restored. Original-file paths, watched folders, API keys and provider consent are excluded. These pasted-text CVs should still have retained text.
6. Quit and reopen the **restored** session with its own command; repeat the ledger check. Open the previously exported PDF from its saved location. Keep both sessions until findings are reconciled.

| Saved record | Expected baseline | Original before quit | Original after restart | Restored | Restored after restart |
| --- | --- | --- | --- | --- | --- |
| Companies | 2; original names, locations and contact details | | | | |
| Jobs / company links | 2; both under Pilot Wellworks | | | | |
| Main-job budgets | Salary 20,000–30,000 SAR monthly; total 50,000–70,000 SAR | | | | |
| Backup-job budgets | Both unset | | | | |
| Main target map | 1; Horizon / Researching / original role and note | | | | |
| CVs / retained text | 2; readable English and Arabic source text | | | | |
| Contacts | 3; Lee has no CV and keeps source URL/availability | | | | |
| Activity / follow-up | 1 activity; reopened reminder; correct related job | | | | |
| Main / backup pipeline | 3 / 0; Lee Submitted with stage history | | | | |
| Submission / feedback | 1; recipient, company, date and feedback retained | | | | |
| Screening | 1; original question, answer and verification label | | | | |
| Manual pool, if exercised | 1 pool / 1 reviewed member | | | | |
| UI language | Last selected language | | | | |

## Record actual outcomes

For this guided packet, use **G** = completed using only this packet, **A** = completed with additional help, **F** = failed, **N** = not attempted. G establishes guided task completion, not unassisted discoverability. For a moderated discovery study, the facilitator should withhold directions and use the existing U/A/F/N definitions in [SESSION.md](SESSION.md).

| Task ID | G / A / F / N | Elapsed seconds | Directions needed / retries / issue IDs | Actual result and evidence location |
| --- | --- | --- | --- | --- |
| W01 | | | | |
| W02 | | | | |
| W03 | | | | |
| W04 | | | | |
| W05 | | | | |
| W06 | | | | |
| W07 | | | | |
| W08 | | | | |
| W09 | | | | |
| W10 optional | | | | |
| W11 | | | | |
| W12 | | | | |
| W13 | | | | |

Proposed acceptance for each exercised platform: every required task completes, the saved-record ledger matches in all checked sessions, and both PDFs match their reviewed content with no internal-note leakage. Record failures and assistance; do not erase a failed attempt when a retry succeeds. Agree broader participant success targets using the existing pilot protocol before sessions. A single guided run does not establish population usability, ranking relevance or release readiness.

| Human coverage | Current status | Completed session references |
| --- | --- | --- |
| macOS Apple Silicon workflow, English and Arabic | Pending | |
| Windows x64 runtime workflow, English and Arabic | Pending | |
| At least two independent domain relevance reviewers | Pending; use separate blind forms | |
| Observed recruiter sessions and consolidated usability findings | Pending | |

Finish the debrief and issue log in [SESSION.md](SESSION.md). Keep completed copies, screenshots, backup files and PDFs private. The repository retains this blank packet; actual participant identities and completed observations belong in the private pilot records.
