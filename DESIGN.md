---
name: Qumaa
description: An offline recruiting desk that reads like Riyadh's bilingual transit wayfinding
colors:
  ink: "#2b2733"
  ink-soft: "#3d3949"
  violet: "#6d3fb0"
  violet-300: "#8f5fd6"
  violet-200: "#c0a3ea"
  violet-100: "#d3bef1"
  violet-deep: "#5a3395"
  violet-wash: "#efe9f8"
  paper: "#f4f1f8"
  panel-white: "#ffffff"
  hover-wash: "#efebf5"
  strip: "#f9f7fc"
  sunken: "#ebe7f1"
  border: "#e0dbe9"
  border-strong: "#c5bdd3"
  text-dim: "#59526a"
  text-faint: "#716a81"
  chrome-graphite: "#1f1b27"
  chrome-text: "#f7f4fb"
  chrome-dim: "#b9b1c9"
  chrome-hover: "#2b2635"
  chrome-line: "#3b3447"
  accent-chrome: "#a982e0"
  line-violet: "#6d3fb0"
  line-blue: "#1d6fd1"
  line-teal: "#0f8b8d"
  line-orange: "#c84d1c"
  line-green: "#1a7f52"
  line-amber: "#9a6207"
  line-red: "#c0392b"
  line-neutral: "#716a81"
  good-wash: "#e4f3ea"
  good-border: "#a7d8bf"
  warn-wash: "#fbf0d9"
  bad-wash: "#f9e6e4"
  scrim: "rgba(23, 19, 31, 0.42)"
  dark-ground: "#181620"
  dark-panel: "#1f1c28"
  dark-raised: "#262231"
  dark-input: "#1c1925"
  dark-hover: "#2a2636"
  dark-strip: "#1c1925"
  dark-sunken: "#131118"
  dark-chrome: "#110f16"
  dark-chrome-dim: "#a79fb8"
  dark-chrome-hover: "#1d1a25"
  dark-chrome-line: "#2a2634"
  dark-border: "#2f2a3a"
  dark-border-strong: "#443d52"
  dark-text: "#f1eef6"
  dark-text-dim: "#b9b2c6"
  dark-text-faint: "#948ca5"
  dark-accent: "#a982e0"
  dark-accent-hover: "#c0a3ea"
  dark-accent-wash: "#302944"
  dark-accent-border: "#54466a"
  dark-badge-ink: "#161320"
  dark-line-violet: "#a982e0"
  dark-line-blue: "#6ea8f5"
  dark-line-teal: "#4fc1c3"
  dark-line-orange: "#f28b5f"
  dark-line-green: "#5ec993"
  dark-line-amber: "#e6b94a"
  dark-line-red: "#ef7b73"
  dark-line-neutral: "#948ca5"
  dark-good-wash: "#1f3328"
  dark-good-border: "#35604a"
  dark-bad-wash: "#3b2426"
  dark-warn-wash: "#3a2f16"
  dark-scrim: "rgba(0, 0, 0, 0.55)"
typography:
  display:
    fontFamily: "IBM Plex Sans Variable, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "IBM Plex Sans Variable, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans Variable, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "IBM Plex Sans Variable, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.24em"
  numeral:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
    fontFeature: "tnum"
rounded:
  sm: "5px"
  md: "8px"
  lg: "10px"
  badge: "6px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
components:
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.violet-deep}"
    textColor: "{colors.panel-white}"
  button-secondary:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.hover-wash}"
    textColor: "{colors.ink}"
  button-small:
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "28px"
  input:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "34px"
  line-badge:
    backgroundColor: "{colors.line-neutral}"
    textColor: "{colors.panel-white}"
    typography: "{typography.numeral}"
    rounded: "{rounded.badge}"
    padding: "0 5px"
    height: "22px"
  state-pill:
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "22px"
  score-box:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.badge}"
    padding: "0 8px"
    height: "30px"
  chrome-bar:
    backgroundColor: "{colors.chrome-graphite}"
    textColor: "{colors.chrome-text}"
    padding: "0 24px"
    height: "56px"
  table-head:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.text-faint}"
    typography: "{typography.label}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.md}"
---

# Design System: Qumaa

## Overview

**Creative North Star: "The Station Board"**

Qumaa is an offline recruiting desk for agency headhunters, and its interface borrows from Riyadh's bilingual transit wayfinding: a graphite header band in both themes, line badges that give every job, client, pipeline stage and review state a colour that means something, and a hiring funnel drawn as a line of stops with a ringed 'you are here'. The world lends exactly four things (type, palette, density and that one signature move); navigation, layout and controls remain standard desktop web, because the recruiter is completing tasks on a laptop in the evening or on the move, often in Arabic.

Density follows a station board: generous rows with strong one-pixel separation, tabular numerals in boxes, and small tracked mono labels over everything that is a field. Surfaces are flat and layered by tone, not shadow; shadows appear only on things that float (the slide-over, toasts). Light, dark and Arabic RTL are equals: the same tokens, the same shapes, with the mono labels losing their tracking in Arabic because connected script cannot be spaced.

Confirmed rejections: the generic SaaS dashboard arrangement of grey sidebar, white cards and kanban; anything that looks AI-generated; consumer-app softness.

**Key Characteristics:**
- Graphite chrome derived from brand ink, in light and dark alike
- Eight line colours that each do a job; identity lines and state lines never swap roles
- Rounded-square badges for identity and stops, pills with a dot for states, one shape each
- IBM Plex Sans at signage weights, Plex Mono for every number and label
- Flat surfaces separated by 1px rules and tonal strips; shadows only on overlays
- Bilingual by construction: RTL mirrors the layout, identity strings stay isolated inline

## Colors

A graphite-and-paper ground with brand violet for action and a small set of line colours that carry meaning rather than decoration.

### Primary
- **Brand Violet** (#6d3fb0; dark #a982e0): primary buttons, the active tab underline on the chrome (#a982e0 in both themes), selection washes, links, focus rings, the reached segments of the funnel line and one of the four identity lines.
- **Violet Deep** (#5a3395): primary button hover in light; dark hovers lighten to #c0a3ea instead.
- **Violet Wash** (#efe9f8; dark #302944): the row under review, the active saved job, the text selection highlight and the input focus halo.

### Secondary
The line colours. Identity lines are assigned to clients and their jobs by a stable hash of the client id and are limited to four; state lines are reserved for meaning.
- **Line Blue** (#1d6fd1; dark #6ea8f5): identity line; the Contacted review state and pipeline stage; the neutral toast dot.
- **Line Teal** (#0f8b8d; dark #4fc1c3): identity line; the Interested stage.
- **Line Orange** (#c84d1c; dark #f28b5f): identity line; the Interviewing stage; on-hold jobs.
- **Line Green** (#1a7f52; dark #5ec993): open jobs, Shortlisted, Offer, Placed and Hired; success toasts.
- **Line Amber** (#9a6207; dark #e6b94a): Maybe, Screened, due today.
- **Line Red** (#c0392b; dark #ef7b73): the Closed stage, overdue follow-ups, contradicted evidence, destructive hover; error toasts.
- **Line Neutral** (#716a81; dark #948ca5): Sourced, Unreviewed, Not proceeding, and any badge without a tone.
- **State washes** (#e4f3ea good, #fbf0d9 warn, #f9e6e4 bad; dark #1f3328, #3a2f16, #3b2426): grounds behind state messages; pills do not use them, they mix their own tone at 13% into transparency.

### Neutral
- **Ink** (#2b2733): body text in light and the brand ink from which the chrome is derived; **Ink Soft** (#3d3949) is the secondary brand ink.
- **Paper** (#f4f1f8): the page ground in light.
- **Panel White** (#ffffff): panels, tables, inputs and raised controls in light.
- **Hover Wash** (#efebf5; dark #2a2636), **Strip** (#f9f7fc; dark #1c1925) and **Sunken** (#ebe7f1; dark #131118): the three tones that build depth: hover, column heads and the funnel band, score boxes.
- **Border** (#e0dbe9; dark #2f2a3a) and **Border Strong** (#c5bdd3; dark #443d52): every rule, control edge and the unreached funnel segments.
- **Text Dim** (#59526a; dark #b9b2c6) and **Text Faint** (#716a81; dark #948ca5): meta lines, labels and column heads.
- **Chrome Graphite** (#1f1b27; dark #110f16) with **Chrome Text** (#f7f4fb), **Chrome Dim** (#b9b1c9; dark #a79fb8), **Chrome Hover** (#2b2635; dark #1d1a25) and **Chrome Line** (#3b3447; dark #2a2634): the header band and its tabs.
- **Dark Ground** (#181620), **Dark Panel** (#1f1c28), **Dark Raised** (#262231) and **Dark Input** (#1c1925): the tonal graphite ladder that replaces paper and white in dark; dark text is #f1eef6 and badge ink becomes #161320.

### Named Rules
**The Line Does a Job Rule.** A line colour appears only when it names an identity or a state. Green, amber and red are never identities; violet, blue, teal and orange are the only identity lines, assigned by hash, never by hand.
**The Chrome Is Ink Rule.** The header band is graphite derived from brand ink in both themes; the light theme's identity comes from that contrast, so the band never turns white or paper.

## Typography

**Display Font:** IBM Plex Sans Variable (with IBM Plex Sans, system-ui)
**Body Font:** IBM Plex Sans Variable (with IBM Plex Sans, system-ui)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace)
**Arabic:** IBM Plex Sans Arabic replaces both the sans and the mono stack when the interface language is Arabic; every family is bundled locally through fontsource and nothing is fetched.

**Character:** Signage. Plex Sans at 500 to 600 for anything that names a thing, Plex Mono for anything that counts or labels, tight negative tracking on headings and wide positive tracking on tiny uppercase labels. Body copy stays at 14px with a 1.45 line height; Arabic opens to 1.7.

### Hierarchy
- **Display** (600, 24px, 1.2, -0.015em): the view title (Jobs, Library) and the slide-over heading.
- **Headline** (600, 16px, 1.3, -0.01em): section and workspace titles, with a line badge beside job and client names.
- **Title** (600, 13px): panel sub-headings and names inside lists and rows.
- **Body** (400, 14px, 1.45): everything else; meta lines drop to 12px and hints sit in Text Dim.
- **Label** (Plex Mono 500, 10.5px, 0.24em, uppercase): field labels, directory headers, facts-bar keys and every table column head; the same value everywhere.
- **Numeral** (Plex Mono 600, 11 to 13px, tabular): badge contents, counts, scores and years; 12px inside funnel stops, 13px in score boxes.

### Named Rules
**The Connected Script Rule.** Arabic is never tracked, never uppercased and never set in the mono face; `:root[lang='ar']` resets letter-spacing and text-transform on every label, heading and badge and swaps the mono stack for Plex Sans Arabic.
**The Tabular Numeral Rule.** Any number a recruiter compares (score, count, years, salary) is set in Plex Mono with tabular figures so columns line up.

## Layout

A 56px chrome band holds the lockup and five underline tabs; the view below scrolls inside the window. Views use a two-column workspace: a sticky directory column (saved jobs, companies, people) beside a white panel that holds the work. The Jobs workspace stacks, in order, the title row (badge, title, state pill, actions), a facts bar and a status bar as single flex rows, the collapsed job description, the funnel band, the underline tab strip, the toolbar and the station board.

Density: table rows pad 13px vertically and 14px horizontally with a 1px rule between rows and a tonal strip behind the column heads; controls are 34px tall (28px small); the spacing steps are 4, 8, 12, 16, 24 and 32px. Overlays: the detail slide-over is min(580px, 92vw) from the inline end; toasts stack at the bottom inline-end corner.

Responsive: at or below 1200px the tagline hides and the workspace head tightens; 1080, 1050 and 1000px collapse two-column grids (pipeline, hiring costs) to one column; 920, 800, 760, 640 and 520px progressively stack the shell, settings and forms. RTL mirrors every inline-start and inline-end rule, flips the directional arrow icon and enters the slide-over from the left.

## Elevation & Depth

Flat by tone. Resting surfaces never cast shadows: the page is paper, panels are white (dark: ground #181620, panel #1f1c28, raised #262231), and the three tonal steps (hover wash, strip, sunken) plus 1px borders carry all depth. Only floating things get shadows.

### Shadow Vocabulary
- **Panel** (`box-shadow: 0 24px 56px -16px rgba(31, 27, 39, 0.38), 0 2px 8px -2px rgba(31, 27, 39, 0.18)`; dark uses black at 0.7 and 0.4): the detail slide-over, behind a scrim of rgba(23, 19, 31, 0.42) (dark rgba(0, 0, 0, 0.55)).
- **Pop** (`box-shadow: 0 14px 36px -10px rgba(31, 27, 39, 0.3), 0 1px 3px rgba(31, 27, 39, 0.1)`; dark black at 0.6 and 0.3): toasts and popovers.
- **Ring** (`box-shadow: 0 0 0 3px` of the tone mixed at 28% into transparency): the current funnel stop; the same 3px ring in Violet Wash is the input focus halo.

### Named Rules
**The Overlay-Only Shadow Rule.** A shadow means the element floats above the work; a card, table, badge or button at rest never carries one.

## Shapes

Corners are small and consistent: 5px on controls and inputs, 8px on panels and tables, 10px on the largest containers, 6px on the rounded-square badge (5px at 18px, 7px at 28px, 8px at 32px), and full pills (999px) for states and scrollbar thumbs. Borders are 1px everywhere, including the start rule on quoted passages; the only thicker strokes are the 3px funnel segments, the 3px tab underline and the 3px ring. Icons are inline SVG at 12 to 16px with 2px strokes; the arrow mirrors in RTL.

### Named Rules
**The One Shape Each Rule.** Identity and stops are rounded squares; states are pills with a 7px dot; scores are boxes. The shapes are never swapped, so a recruiter reads the kind of thing before the words.

## Components

### Buttons
- **Shape:** 34px tall, 5px radius, 500 weight at 13px; the small variant is 28px tall at 12px.
- **Primary:** Brand Violet fill with white text (dark: #a982e0 with #161320 text), 600 weight, 0 14px padding; hover darkens to Violet Deep (lightens in dark).
- **Secondary:** white (raised) fill, 1px Border Strong, ink text; hover takes the Hover Wash and a Text Faint border; danger hover turns the border and text Line Red over the bad wash.
- **Hover / Focus / Press:** hover styles are gated by `(hover: hover)`; focus-visible is a 2px violet outline offset 2px; `:active` scales to 0.97 over 160ms on the strong ease-out; disabled drops to 45% opacity.
- **Text button and icon button:** borderless; the icon button is a 32px square that presses to 0.94.

### Line Badge (signature)
- **Style:** inline-grid rounded square, 22px tall (18 small, 28 in funnel stops, 32 large), tone fill with white ink (dark #161320), Plex Mono 600 at 11px with tabular figures and 0.02em tracking.
- **Content:** two initials for a job or client, a stop number for a pipeline stage, or a count on a funnel stop; the Hired stop shows a check icon once reached.
- **Tones:** violet, blue, teal, orange (identity) and green, amber, red, neutral (state), set through a `--tone` custom property.

### State Pill
- **Style:** inline-flex, 22px tall, 999px radius, 11px 500 text in the tone colour over the same tone mixed at 13% into transparency, with a 7px dot before the label.
- **State:** review states (Shortlisted green, Contacted blue, Maybe amber, Not proceeding neutral), job states, and pipeline stages through the stage tone map; a stage pill in a table row sits on its own line under the review pill.

### Funnel Line of Stops (signature)
- **Style:** a band on the Strip tone with 1px rules above and below and 10px 24px padding; each stop is a 28px badge plus a 12px label, joined by 3px rounded segments. Reached segments are Line Violet, unreached are Border Strong; the current stop's badge carries the 3px tone ring and its label turns 600.
- **Stops:** Matched, Reviewed, Shortlisted, Contacted (review state Contacted or a pipeline stage at or beyond it), Hired (a placement or a placed stage).

### Score Box
- **Style:** 44px minimum width, 30px tall, Sunken ground, 6px radius, Plex Mono 600 at 13px tabular; desaturated and dimmed on rows marked not proceeding.

### Station Board (tables)
- **Head:** Strip ground, Label typography (Plex Mono 10.5px, 0.24em, uppercase, Text Faint), 1px rules; sticky in the library table.
- **Rows:** 13px 14px cells, a 1px rule between rows, hover wash under `(hover: hover)`, the row under review in Violet Wash, the name as a text button that underlines on hover, meta and skills in 12px Text Dim, tags as chips; row actions are a horizontal strip of small buttons, the first an arrow strip (Review with a trailing arrow).

### Inputs / Fields
- **Style:** white (dark #1c1925) fill, 1px Border Strong, 5px radius, 34px tall, 13px text; textareas are 80px minimum with a 1.6 line height; selects draw their own 14px chevron, mirrored in RTL; checkboxes use violet accent-color.
- **Focus:** violet border with a 3px Violet Wash halo; placeholders in Text Faint; disabled at 60% opacity.
- **Label:** the tracked mono Label above every field.

### Navigation (chrome tabs)
- **Style:** 56px graphite band with the lockup; tabs are 14px 500 in Chrome Dim with 3px transparent top and bottom borders and 0 16px padding; hover lifts to Chrome Text over Chrome Hover; the active tab is Chrome Text at 600 with a 3px Accent Chrome (#a982e0) underline; a count badge sits inside the tab.

### Cards / Containers
- **Corner Style:** 8px panels, 10px large containers.
- **Background:** Panel White (dark #1f1c28) on Paper; sections inside a panel separate with 1px rules, not nested cards.
- **Shadow Strategy:** none at rest (see Elevation).
- **Internal Padding:** 14 to 16px on directory heads, 24px on the workspace head and the slide-over head.

### Slide-over and Toasts
- **Detail:** fixed at the inline end, min(580px, 92vw), Panel shadow over the scrim, enters with a 24px translate and fade over 240ms on the strong ease-out through `@starting-style` (mirrored to -24px in RTL).
- **Toast:** raised ground, 1px border, 8px radius, Pop shadow, an 8px dot in Line Blue (red for errors, green for success), the same entry transition.

### Chips (tags)
- **Style:** small rounded chips on a sunken tone with Text Dim text for recruiter tags and skills; a chip never carries a line tone.

### Disclosure (rail stop)
- **Head:** a `<details>` summary as a quiet row: a 14px chevron in Text Faint pointing along the reading direction (left in RTL), an 8px gap, and a 13px 500 label in Text Dim; 34px tall, no browser marker. The inline variant is a fit-content row at 28px and 12px for a bar, a notice or a field; the entry variant fills a bordered list card at 13px padding and takes a 1px hairline under the head when open.
- **Hover / Focus / Press:** the Hover Wash with 5px corners overhanging the content edge by 8px (gated by `(hover: hover)`; no overhang inside a notice), label and chevron step to Text; focus-visible is the global outline; `:active` scales the label, not the row, to 0.97.
- **Open:** the chevron turns to point down in Accent, the label steps to full ink at the same weight, and the body hangs from a 1px Border Strong rail 7px in (under the chevron) with text 22px in, 12px above and 4px below; the body unfolds over 200ms on the strong ease-out with a 160ms fade through `::details-content`; reduced motion snaps. The rail is never an identity tone; the status timeline draws its own line and drops the rail.
- **Markup:** `DisclosureSummary` renders the head (the chevron, then the label span as the summary's only text); body children need no wrapper.

## Do's and Don'ts

### Do:
- **Do** give every job, client, stage and state its line badge or pill before its words; the colour is read first.
- **Do** keep identity lines to violet, blue, teal and orange assigned by hash, and reserve green, amber and red for states.
- **Do** set every label and column head in Plex Mono 10.5px, 500, uppercase, 0.24em, and every compared number in tabular Plex Mono.
- **Do** isolate short identity strings (names, titles, file names, locations, client context) with an inline `<bdi>` inside start-aligned blocks, and let prose blocks (notes, passages, quotes, raw text) take their own direction with `dir="auto"`.
- **Do** gate hover styles behind `(hover: hover)`, press buttons to scale(0.97) over 160ms, enter overlays with `@starting-style`, and collapse all motion under `prefers-reduced-motion`.
- **Do** keep helper text to facts the controls cannot show: a consequence, an exclusion, a format rule, or the next action in an empty state, in one short sentence.
- **Do** theme the surfaces nobody draws: scrollbars in Border Strong, selection in Violet Wash, the caret in violet.

### Don't:
- **Don't** put a shadow on a card, table, badge or button at rest; depth is tone and 1px rules.
- **Don't** track, uppercase or mono-set Arabic text; the connected script keeps its natural spacing and a 1.7 line height.
- **Don't** nest a card inside a card or add a coloured side border thicker than 1px; a quoted passage is a tinted block with a 1px start rule.
- **Don't** use Unicode glyphs or icon fonts for icons; icons are inline SVG that mirror in RTL when directional.
- **Don't** rebuild the generic SaaS arrangement (grey sidebar, white cards, kanban) or soften the system toward consumer apps; the station board, the funnel line and the graphite chrome are the identity.
- **Don't** write taglines under view titles, section intros that restate the heading, or reassurance lines ("saved locally", "will appear here"); the control, the label and the data are the explanation.
- **Don't** add fonts or any network asset; the three Plex families ship with the app.
