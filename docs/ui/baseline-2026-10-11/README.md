# UI baseline — 11 October 2026

This folder freezes Qumaa's interface **as it was before the UI modernization**
so the old look can be compared against the new direction and restored if the
new direction is not kept.

| Item | Value |
| --- | --- |
| Baseline commit | `1ac5b984297db9803456103a27897e2289e71d5f` on `main` (application version `0.1.0-beta.5`) |
| Redesign branch | `ui-modernize`, branched from that commit |
| Written spec | [DESIGN-baseline.md](DESIGN-baseline.md): tokens, type, layout, components, states, and the named rules the old UI followed |
| Screenshots | [screenshots/](screenshots/) with a `manifest.json` recording the commit, viewport, theme and language of every capture |
| Capture tool | `scripts/capture-ui.mjs` (fictional seed data, disposable library, no network) |

## Reverting to this UI

The code is the authoritative spec; everything here describes it. **Since this
baseline was frozen, `ui-modernize` gained work outside the redesign**, so none
of the old one-step reverts is safe any more:

- `e28dce5` (security fixes) changed renderer files `src/renderer/src/i18n.tsx`
  and `src/renderer/src/components/recruiting/JobStatusPanel.tsx` (safe date
  formatting).
- `cc9df03` (ChatGPT subscription sign-in) added
  `src/renderer/src/components/ChatGptWelcome.tsx` and changed `SettingsView.tsx`,
  `components/recruiting/JobRerank.tsx` and `styles.css`.
- `4ccc942` and `26d286b` (backup and watched-folder descriptions) changed
  `SettingsView.tsx` and `src/shared/locales/common.ts` again after `cc9df03`.
- `main` is still at the baseline commit, so `git switch main` or deleting
  `ui-modernize` would also drop the security and ChatGPT work.

A visual revert now needs a per-file plan: restore the stylesheets and
presentational components from `1ac5b984297db9803456103a27897e2289e71d5f`, then
re-apply the renderer changes of `e28dce5`, `cc9df03`, `4ccc942` and `26d286b` listed above, in that order, and keep
everything outside `src/renderer`. Do it only on the user's explicit request,
and confirm the file list with `git log 1ac5b98..HEAD -- src/renderer` first.

After any revert, run `npm run build`, `npm test` and `npm run test:ui:built`
exactly as for any other change; the Playwright suite drives the real UI.

## Re-capturing the same screens

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH   # Node 22
npm run build
env -u ELECTRON_RUN_AS_NODE node scripts/capture-ui.mjs --out docs/ui/<new-folder>/screenshots --label "<what this is>"
```

The script seeds the same fictional companies, jobs, CVs, reviews, follow-ups
and talent pool every run, so two capture sets are directly comparable screen
for screen. It never opens the personal library and never sends a request.

## What the old UI was, in one paragraph

An ink-forward instrument: white surfaces separated by 1px hairlines rather than
tint or elevation, near-square 3–4px corners, IBM Plex Sans for everything with
IBM Plex Mono for small tracked uppercase labels, the brand violet reserved for
the active tab, primary buttons, focus rings and accent chips, and a single
elevated surface (the candidate detail slide-over). Dense 12–13px feature views
(Jobs, Companies, Recruiter desk) sit beside a 14px base elsewhere. Light and
dark themes share the brand values and swap only role tokens; the Arabic
interface mirrors through logical properties and drops Latin tracking and
case transforms.
