# Qumaa · قُمع — brand assets

Mark: a stack of résumés narrowing into a funnel. Two tinted sheets sit above a solid funnel;
at 16px the top sheet drops away so the mark stays legible.

## Colours
| Token | Hex | Use |
| --- | --- | --- |
| ink | #2b2733 | primary icon background, headings |
| violet | #6d3fb0 | alternate icon background, accents, rules |
| violet-300 | #8f5fd6 | top sheet |
| violet-200 | #c0a3ea | second sheet |
| paper | #f4f1f8 | surfaces |

## Type
IBM Plex Sans (Latin) · IBM Plex Sans Arabic (Arabic) · IBM Plex Mono (labels, all-caps, 0.24em tracking).

## Folder

- `svg/` — vector mark and app icons (mark-color, mark-ink, mark-white, appicon-ink, appicon-violet)
- `tokens.json` — brand colour and typography reference
- `tokens.css` — brand tokens as CSS custom properties

`npm run make-icon` generates `build/icon.png` from `svg/appicon-ink.svg`.

## Rules
- Clear space: 25% of the icon height on every side.
- Never recolour the funnel; never place the ink icon on violet or vice versa.
- Arabic lockup is right-to-left: mark sits to the RIGHT of قُمع.
- Single-colour use: swap the two sheet tints for 35% / 60% opacity of the base colour.
- Minimum sizes: 16px digital, 8mm print.
