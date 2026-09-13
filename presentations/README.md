# Qumaa recruiter guide

The English and Arabic guides describe Qumaa `v0.1.0-beta.2` in 24 pages. Each
opens with an introduction and a table of contents, then explains the application
through a fictional Training & Development Manager assignment in Riyadh.

| Language | PDF | Editable presentation |
| --- | --- | --- |
| English | [Guide](Qumaa_Recruiter_Guide.pdf) | [PowerPoint](Qumaa_Recruiter_Guide.pptx) |
| Arabic | [الدليل](arabic/Qumaa_Recruiter_Guide_AR.pdf) | [عرض PowerPoint](arabic/Qumaa_Recruiter_Guide_AR.pptx) |

The guides cover the three-tab workspace, CV imports, saved jobs and Express
search, criteria and filters, evidence review, candidate profiles, comparison,
shortlists, CV versions, refreshing matches, timestamped job statuses, hiring
outcomes and backups #2/#3, Anthropic and OpenAI model selection, AI data review,
watched folders, and library backups. Page 24 explains where each kind of record
is retained. The contents cards link to their sections.

Text, tables, and workflow diagrams remain editable in PowerPoint. Detailed
instructions are in the speaker notes. The PNG preview provides an overview of
all pages. The PDF is a visual companion with rasterized page text and clickable
navigation; use the PowerPoint when editing or extracting text.

## Visual sources

The application screenshots show the actual packaged application in English and
Arabic. Capture scripts use an isolated temporary library containing fictional
CVs and recruiting records. No personal library, real API key, or live AI request
is used. A synthetic credential-storage stub allows the actual AI review dialog
to be opened and canceled, with outbound networking blocked. Screenshot manifests
record provenance, dimensions, and capture time.

Application views are captured directly, without generated or redrawn interface
elements. Comparison excerpts come from the same actual view. Native presentation
shapes explain the recruiting workflow and AI request sequence. The application
screenshots retain IBM Plex typography; editable text uses Arial. Colours and the
icon come from the repository's existing brand assets.

## Rebuild

Use Python 3 with `python-pptx` and `Pillow`, and the repository's Node/Playwright
dependencies. From the repository root:

```bash
env -u ELECTRON_RUN_AS_NODE node presentations/source/capture-guide.cjs
env -u ELECTRON_RUN_AS_NODE node presentations/arabic/source/capture-guide-ar.cjs
python3 presentations/source/build_guide.py
python3 presentations/arabic/source/build_guide_ar.py
```

Capturing requires the packaged macOS application at `release/mac-arm64/قُمع.app`.
Temporary application data is removed when the capture process closes. Normal
builds reject missing screenshots; `--allow-missing` is for development only and
must not be used for delivered documents. Arabic text and notes are maintained in
`arabic/source/translations.json`, with explicit right-to-left paragraph settings.

To render PDFs and preview sheets on macOS, provide a fresh directory for each run:

```bash
node presentations/source/render-guide.cjs /private/tmp/qumaa-guide-en-review
node presentations/arabic/source/render-guide-ar.cjs /private/tmp/qumaa-guide-ar-review
```

The renderer uses Quick Look, Swift, and an isolated headless Chrome session.
It renders temporary single-slide copies without notes to avoid Office preview
importer limitations. The original PowerPoint retains its notes, editable shapes,
and links. Rendering reports check document structure, page counts, links, and
layout. Storyboards list the page copy and speaker notes in each language.
