# Wayfinding redesign captures

"After" set for the UI modernisation on branch `ui-modernize`. The views, order and
fixture data are identical to `docs/ui/baseline-2026-10-11/screenshots/`, so the two
folders compare one to one.

The folder is named for the redesign (11 Oct 2026). Both sets were re-captured on
17 Oct 2026 from commit `4ccc942` in a clean worktree. That tree holds the redesign
(`1f9db63`), the copy pass (`b3b2ffc`), the rail-stop disclosures (`6327450`), the
ChatGPT settings (`cc9df03`) and the backup-copy fix (`4ccc942`). Each `manifest.json`
records the commit, the label and whether the tree was clean.

- `screenshots/`: 24 views at 1440×1000 (2× PNGs), light, dark and Arabic RTL.
- `screenshots-1180/`: the same 24 views at 1180×820, the laptop viewport used for
  the first-viewport check.

Captured with Node 22 after `npm run build`:

```bash
env -u ELECTRON_RUN_AS_NODE node scripts/capture-ui.mjs --out docs/ui/wayfinding-2026-10-11/screenshots --width 1440 --height 1000 --label "<what this is>"
env -u ELECTRON_RUN_AS_NODE node scripts/capture-ui.mjs --out docs/ui/wayfinding-2026-10-11/screenshots-1180 --width 1180 --height 820 --label "<what this is>"
```

The capture seeds a scratch user-data directory with fictional CVs, companies, jobs and
recruiter records; it never touches the personal library and sends no request.

The design system of this direction is recorded in the root `DESIGN.md` and
`.impeccable/design.json`. The frozen spec of the previous interface, with revert
instructions, is in `docs/ui/baseline-2026-10-11/README.md`.
