---
name: Qumaa (baseline, pre-modernization)
description: The hairline instrument — Qumaa's interface as shipped in 0.1.0-beta.5, frozen on 11 October 2026 before the UI modernization
colors:
  ink: "#2b2733"
  ink-soft: "#3d3949"
  violet: "#6d3fb0"
  violet-deep: "#5a3395"
  violet-tint: "#d3bef1"
  violet-wash: "#efe9f8"
  paper: "#f4f1f8"
  white: "#ffffff"
  strip: "#faf9fc"
  hairline: "#e2dfe8"
  hairline-strong: "#c8c3d4"
  text-faint: "#7d7789"
  good: "#1f7a54"
  good-wash: "#e7f4ee"
  good-border: "#a4d8c1"
  bad: "#b3403f"
  dark-surface: "#1c1922"
  dark-input: "#232029"
  dark-hover: "#262230"
  dark-hairline: "#35303f"
  dark-hairline-strong: "#4a4356"
  dark-text: "#f1eef6"
  dark-text-dim: "#b7b0c4"
  dark-text-faint: "#8d8699"
  dark-accent: "#a982e0"
  dark-accent-hover: "#c0a3ea"
  dark-accent-wash: "#352c46"
  dark-accent-border: "#574569"
  dark-good: "#6cc79b"
  dark-good-wash: "#24382f"
  dark-good-border: "#3c6b53"
  dark-bad: "#e08585"
typography:
  headline:
    fontFamily: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline-feature:
    fontFamily: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.6px"
  title:
    fontFamily: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  body-dense:
    fontFamily: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 600
    letterSpacing: "0.24em"
    lineHeight: 1.2
  eyebrow:
    fontFamily: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "1.3px"
    lineHeight: 1.2
  wordmark:
    fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "0"
    lineHeight: 1
rounded:
  sm: "3px"
  md: "4px"
  pill: "20px"
  dialog: "9px"
  dialog-lg: "12px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
components:
  button-default:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
    height: "38px"
  button-default-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.violet}"
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "8px 15px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.violet-deep}"
    textColor: "{colors.white}"
  button-small:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
    height: "30px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "38px"
  input-dense:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  chip:
    backgroundColor: "{colors.violet-wash}"
    textColor: "{colors.violet-deep}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  chip-matched:
    backgroundColor: "{colors.good-wash}"
    textColor: "{colors.good}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  tab-active:
    backgroundColor: "{colors.white}"
    textColor: "{colors.violet}"
    padding: "16px"
  table-header:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    padding: "12px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  directory-pane:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
---

# Design System: Qumaa (baseline, pre-modernization)

This records the interface exactly as committed at `1ac5b98` (application
0.1.0-beta.5), captured on 11 October 2026 before the UI modernization began.
Values come from `src/renderer/src/styles.css`, `recruiting.css`, `talent.css`,
`companies.css`, `components/recruiter-profile.css`,
`components/companies/hiring-budgets.css`, `components/recruiting/client-pack.css`
and `components/recruiting/pipeline.css` at that commit. The characterizing
language (the north-star name, color names, rules) is a description written
for this record, not a decision the original authors wrote down.

## Overview

**Creative North Star: "The Hairline Instrument"**

The old Qumaa reads like a precision instrument drawn in ink on white paper.
Nothing is tinted or lifted to show structure; every boundary is a 1px
hairline, every surface is flat, and the brand violet is spent only where the
eye must land: the active tab, the primary action, the focus ring, matched
skill chips and the dot that says a job is open. The one exception to flatness
is deliberate: the candidate detail panel slides in over a scrim with a deep
soft shadow because it is the only surface that sits above the page.

Density is uneven by design history. The shell, Library and Settings run on a
14px base with 38px controls; the three feature workspaces (Jobs, Companies,
Recruiter desk) run a dense 12–13px register with 10px eyebrows, 30px small
buttons and tables padded 10–14px. Headings are quiet (600–650 weight, slight
negative tracking) and all-caps labels are set in IBM Plex Mono with wide
tracking, which is the strongest brand gesture on screen. Arabic mode mirrors
through logical properties, drops tracking and case transforms, and uses IBM
Plex Sans Arabic for everything including numerals.

**Key Characteristics:**
- Flat white surfaces; structure from 1px hairlines, never from fill or shadow.
- Near-square corners (3–4px) everywhere except pill chips and a few later dialogs.
- One accent (brand violet) used as a pointer, not a field.
- IBM Plex throughout: Sans for text, Sans Arabic for the wordmark and Arabic UI, Mono for tracked labels and numerals.
- Two registers of density: a 14px shell and 12–13px feature workspaces.
- A directory-plus-workspace layout in each feature view: narrow list on the strip tone, wide workspace on white.

## Colors

A monochrome ink-on-white palette with a single violet accent and a green/red
pair for state, all taken from the brand kit.

### Primary
- **Brand Violet** (#6d3fb0): the only accent. Active tab text and underline, primary button fill, focus ring, selected-list edge bar, progress fill, score ring, "researching" and "on hold" state dots, timeline dots.
- **Deep Violet** (#5a3395): primary button hover, chip text, score numerals.
- **Violet Tint** (#d3bef1): accent borders on chips, notices and the express-search button.
- **Violet Wash** (#efe9f8): accent-soft fill for chips, notices, selected table rows, the empty-state mark tile, inline code and the AI reason block.

### Neutral
- **Ink** (#2b2733): body text, headings, the wordmark on light surfaces, the app-icon tile.
- **Ink Soft** (#3d3949): secondary text, table headers, descriptions.
- **Faint** (#7d7789): tertiary text, hints, eyebrows, placeholders, icon buttons at rest.
- **White** (#ffffff): page, chrome, cards, inputs, table bodies.
- **Strip** (#faf9fc): table headers, directory panes, stats bands, detail-panel header, filters band, status panel.
- **Paper** (#f4f1f8): hover rows, tab hover, count pills, the private-note band in client packs.
- **Hairline** (#e2dfe8) and **Strong Hairline** (#c8c3d4): every border and divider; strong on inputs, buttons and table-header bottoms.

### State
- **Good** (#1f7a54) with wash (#e7f4ee) and border (#a4d8c1): ready status, matched chips, shortlisted/contacted badges, hired card, success toasts, "open" job dots.
- **Bad** (#b3403f): errors, danger button hover, overdue dates, delete affordances, error toasts.

### Dark theme
Only role tokens change; brand values stay fixed. Surfaces drop to a near-black
violet-tinged ink (#1c1922, inputs #232029, hover #262230), hairlines to #35303f
and #4a4356, text to #f1eef6 / #b7b0c4 / #8d8699. The accent moves up the ramp
to Violet-300 (#a982e0, hover #c0a3ea) with wash #352c46 and border #574569
because base violet does not read on ink. Primary buttons invert to ink text
on the light accent. Good becomes #6cc79b on #24382f; bad becomes #e08585.

### Named Rules
**The Pointer Rule.** Violet points; it never fills a region. If more than a button, a tab underline and a few chips are violet on one screen, something is wrong.
**The Hairline Rule.** Separation is a 1px line. No tinted panels to group content, no shadows at rest, no elevation ladder.

## Typography

**Display Font:** none (no display face; headings use the body family)
**Body Font:** IBM Plex Sans Variable (fallback IBM Plex Sans, system-ui)
**Arabic Font:** IBM Plex Sans Arabic (wordmark; the whole UI when `lang="ar"`)
**Label/Mono Font:** IBM Plex Mono (tracked uppercase labels, tabular numerals)

**Character:** quiet, technical and even-handed. Weight does the hierarchy work (650/600/500/400), size steps are small, and the only loud gesture is wide-tracked mono uppercase for labels.

### Hierarchy
- **Headline** (650, 20px, 1.2, -0.015em): view titles in Library and Settings and the detail-panel name.
- **Feature headline** (600, 27px, 1.2, -0.6px): page titles in Jobs, Companies and Recruiter desk, each under a 10px eyebrow.
- **Title** (600, 16px, 1.3, -0.01em): section headings; feature workspaces use 19–20px for the workspace title, 13–14px for sub-sections.
- **Body** (400, 14px, 1.45): shell, Library, Settings, detail panel. Descriptions 13px at 1.6–1.65; hints 12px.
- **Dense body** (400, 12px, 1.55–1.75): Jobs, Companies, Recruiter desk, budgets, pipeline; 13px for candidate names and primary values.
- **Label** (600, 10.5–11px, 0.24em, uppercase, Plex Mono): evidence tags, AI-reason tag. Table headers use the same face at 11px with 0.08em.
- **Eyebrow** (600, 10px, 1.3px, uppercase, Plex Sans): "Your hiring desk", "Saved jobs", "Company profile".
- **Numerals**: Plex Mono with `tabular-nums` and slashed zero for scores, counts, years and the tab count pill.
- **Arabic**: body line-height rises to 1.7, tracking and `text-transform` are removed everywhere, and the mono stack falls back to Plex Sans Arabic.

### Named Rules
**The Mono Label Rule.** Anything set in uppercase is Plex Mono and tracked; never tracked Plex Sans, never uppercase Arabic.
**The Prose Measure Rule.** Descriptions cap at 76–90ch; empty-state bodies at 42ch.

## Layout

A fixed shell: a 64px top bar (brand lockup on the left, five text tabs with
an underline indicator, draggable on macOS with an 84px traffic-light inset)
above a single scrolling `main` padded 32px top, `clamp(20px, 3vw, 44px)` on
the sides and 48px bottom, with a stable scrollbar gutter. Feature views are
centred at max 1600px.

Each feature view is a two-column grid: a directory pane on the strip tone
(Jobs 230px, Companies 264px, Recruiter desk 275px) and a workspace on white,
20px apart, both hairline-bordered with 4px corners and `overflow: hidden`.
Workspaces stack a 22–26px-padded header, a three-up stats band on the strip
tone, an underline tab strip, then content. The Library is a plain full-width
table under a toolbar and a filters band. Settings is a two-column card grid
capped at 1080px, with wide cards spanning both columns.

Spacing follows a 4px scale (4/8/12/16/24/32) in the shell and ad-hoc pixel
values (5, 7, 9, 13, 15, 18, 22, 26) in the feature views. Breakpoints collapse
the feature grids to one column at 920–1050px, tighten padding at 1200px and
stack headers at 640–760px; the top bar wraps its tabs below 800px.

## Elevation & Depth

Flat by default. The page, cards, panes and tables carry no shadow; depth is
expressed by the strip tone (one step below white) and hairlines. Three
surfaces may lift: the candidate detail slide-over (`-14px 0 44px rgba(43,39,51,0.18)`,
mirrored in RTL; `rgba(0,0,0,0.5)` in dark), the status-change dialog
(`0 20px 80px #0005`) and the talent confirm dialog (reusing the panel shadow).
Scrims are translucent ink: `rgba(23,35,63,0.28)` behind the panel,
`rgba(31,27,38,0.62)` behind the consent dialog.

### Named Rules
**The One Lifted Surface Rule.** Only overlays cast shadows. Hover never lifts; selection is a tint or an edge bar.

## Shapes

Near-square. UI corners are 4px (cards, panes, tables, textareas, segmented
control) or 3px (buttons, inputs, selects, badges, toasts, count pills). Chips
are 20px pills; status dots are 5–7px circles; the brand tile keeps the kit's
22% radius. Later feature CSS introduced larger radii that the shell never
used: 8px stage-count buttons, 9–10px pipeline cards and entries, 10–12px
client-pack panels. Borders are 1px hairlines; selection is a 3px edge bar on
the inline-start side; evidence quotes carry a 3px accent-tint edge.

## Components

### Buttons
- **Shape:** 3px corners, 38px tall (30px small), 500 weight, 8×15px padding (4×10px small), nowrap.
- **Default:** white fill, strong-hairline border, ink text. Hover: paper fill, violet border and text.
- **Primary:** violet fill and border, white 600 text. Hover: deep violet. Dark: ink text on light accent.
- **Danger:** default styling; hover turns border and text red.
- **Text button:** no chrome, violet 11px text, underline on hover (`.recruit-text-button`, `.talent-text-button`).
- **Icon button:** 30px square, faint glyph, paper fill on hover.
- **Disabled:** 45% opacity, not-allowed cursor.
- **Focus:** 2px violet outline offset 1px on every focusable element.

### Tabs
- **Shell tabs:** text buttons 16px padded, faint 500 text, transparent 2px bottom border; active is violet 600 with a violet underline; hover shows a strip background. The Library tab carries a count pill (paper fill, mono tabular numeral).
- **Workspace tabs:** 12–13px text with a transparent 2px underline, 24–26px apart; selected is ink 600 with a violet underline; each carries a paper count pill.
- **Segmented control (Settings):** strip-toned box with 3px padding; the chosen segment is a white "primary" button with violet text.

### Inputs / Fields
- **Style:** white fill, strong-hairline 1px border, 3px corners, 38px tall (dense views: 12px text, 8–9px padding, no minimum height), textareas 4px corners at 1.6 line-height.
- **Focus:** border turns violet (plus the global outline).
- **Placeholder:** faint. **Disabled:** 65% opacity.
- **Field label:** stacked above the control, 12px 500 dim text, 7px gap.
- **Checkbox:** 15px native with violet accent color.
- **Entry lists (company details):** violet-wash pills with a 30px remove button.

### Tables
- **Library table:** white, hairline border, 4px outer radius rounded per cell, sticky mono uppercase headers on the strip tone, 11–12px cell padding, hairline row dividers, paper hover, violet-wash selected row.
- **Candidate table (Jobs):** collapsed borders, 10px 500 headers on the strip tone, 14px cell padding, violet-wash "reviewing" row, a 34×30px boxed mono score, review-state badges (hairline box; green for shortlisted/contacted, violet for maybe), 10px tag pills and 10px small action buttons.
- **Comparison table:** fixed 235px columns, 16px padding, strip-toned header column.

### Chips
- **Skill chip:** 11px 500, pill, violet wash + violet-tint border + deep-violet text.
- **Matched:** green wash/border/text. **Missing:** transparent, strong hairline, faint strikethrough text.

### Cards / Containers
- **Card:** white, hairline, 4px, 16px padding (Settings cards 24px).
- **Directory pane:** strip tone, hairline, 4px, list items 15–16px padded with a transparent 3px start edge that turns violet when selected (selected item also turns white).
- **Stats band:** strip tone, hairline top/bottom, three columns divided by hairlines, 23–25px 500 tabular numbers over 11px faint labels.
- **Notice:** violet wash with violet-tint top/bottom borders, 12px text. **Error:** red 1px border, red text, 4px corners.
- **Empty state:** centred, dashed strong-hairline border (shell) or borderless (feature views), a 46–56px violet-wash tile holding the brand mark or a glyph, 16–18px 600 title, faint 12–13px body.

### Detail slide-over
- Fixed to the inline-end edge, `min(560px, 92vw)` (620px in Arabic), white, hairline start border, panel shadow, 200ms ease-out slide from 16px and a 160ms scrim fade. Header on the strip tone with name, contact line and a 56px score ring; scrollable body in 24px sections; footer with file actions and Delete.
- **Score ring:** 7.7% stroke, violet on violet wash, bold deep-violet numeral. **Score bars:** 72px label / 8px violet track / mono value.
- **Evidence quote:** 3px violet-tint start edge, mono tracked tag (section · % match), dim 13px quote.

### Toasts
- Bottom inline-end stack, `min(380px, 100vw - 40px)`, white, hairline, 3px start edge in violet (info), green (success) or red (error), 11×12px padding, click to dismiss; 4s auto-dismiss, 8s for errors.

### Dialogs
- Native `<dialog>` elements: 18–26px padding, strong-hairline border, 4px corners, translucent ink backdrop; status dialog 620px wide, talent confirm 640px, consent dialog 660px with a 360px monospace payload box.

### Timelines
- Status history and contact history: 1–2px hairline rail on the inline-start side with 7–8px violet dots (ringed by the strip tone), 12px events, 10–11px faint timestamps.

### Progress
- Import progress: card with a 6px violet-wash track and a violet fill transitioning at 150ms.

### Brand lockup
- `dir="rtl"` lockup: 28px ink app-icon tile (white mark on dark), then the Arabic wordmark "قُمع" in Plex Sans Arabic 600 at 20px; the mark drops its top sheet below 20px.

## Do's and Don'ts

### Do:
- **Do** separate regions with 1px hairlines (#e2dfe8) and reserve the strip tone (#faf9fc) for headers, panes and bands.
- **Do** keep corners at 3–4px on controls and containers; pills only for chips.
- **Do** use Brand Violet only for the active tab, primary actions, focus, selection edges and accent chips.
- **Do** set uppercase labels in IBM Plex Mono with 0.24em tracking (0.08em for table headers) and numerals in Plex Mono with tabular figures.
- **Do** mirror with logical properties; in Arabic remove tracking and case transforms, raise line-height to 1.7 and widen the detail panel to 620px.
- **Do** honour `prefers-reduced-motion` by removing the panel, scrim and toast animations.

### Don't:
- **Don't** add shadows to cards, rows or buttons; only overlays lift.
- **Don't** tint panels to group content or fill regions with the accent.
- **Don't** change the brand values (ink #2b2733, violet #6d3fb0, paper #f4f1f8) or the IBM Plex families.
- **Don't** mix the 14px shell register and the 12px feature register inside one component.
- **Don't** track or uppercase Arabic text, and never uppercase anything set in Plex Sans.
