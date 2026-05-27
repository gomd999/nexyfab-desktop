# Phase G — Dead-code removal runbook

**Status:** runbook · **Adopted:** 2026-05-27 · **Linked:** [ADR-006](../adr/006-monolith-split-via-shell-v3-migration.md)

After Phase B-F (PR #2) all widgets in `_shell/MIGRATION.md` are wired
to v3 panels. Phase G removes the legacy `LeftPanel.tsx` / `RightPanel.tsx`
render paths that nothing reads anymore, shrinking the
`ShapeGeneratorInner.tsx` monolith further. This is the **highest-risk
Wave 1 work** because:

- Legacy paths still render when `?shell=v2` is off — removing them
  changes the experience for anyone with an old bookmark.
- Cross-cutting state hooks (e.g. `useShapeGeneratorUI.ts` show/hide
  flags) may only be consumed by the legacy paths; removing them
  needs grep first.
- The Phase H 8-flow regression baseline (see end of `MIGRATION.md`)
  must pass BEFORE removal and re-pass after every Phase G commit.

This runbook makes it a 1-day exercise instead of a 1-week debugging
hunt.

## Pre-flight (do once before any deletion)

### Step 0 — Confirm shell-v2 is default

Verify the `?shell=v2` flag is now default ON. Check
`src/app/[lang]/shape-generator/page.tsx` (and the per-mode routes
`/sketch`, `/3d-edit`, etc.) — they should render `ModelerShell` /
`SketchShell` / etc. unconditionally, not gated by query param.

If still flag-gated: Phase G Step 0a is "promote shell-v2 to default".
Single commit: remove the `?shell=v2` check, log a console.info on
mount so users with bookmarks notice the change.

### Step 1 — Phase H baseline run

Open the live dev server (`npm run dev`) and walk through all 8 flows
in `_shell/MIGRATION.md` § "Regression test surface". Record results
in:

```
docs/postmortem/phase-h-baseline-YYYY-MM-DD.md
```

Format per flow:
```
### Flow N — [name]
Result: ✅ PASS / 🟡 FLAKY / 🔴 FAIL
Steps taken: [what you actually did]
Notes: [edge cases, screenshots, etc.]
```

If any flow is 🔴 FAIL on baseline `main`: **STOP**. That's a
pre-existing bug; file a separate P1 issue, do not proceed with
Phase G. We must not let Phase G become the scapegoat for an
already-broken flow.

If any flow is 🟡 FLAKY: re-run 3×. If still flaky, treat as known
gap and document it; proceed with Phase G but exclude that flow from
the post-Phase-G re-run criterion.

## Phase G commits — incremental deletion

Each commit deletes ONE category of legacy render code. After each:
1. `npm run typecheck` + `npm run lint:ci`
2. Re-run Phase H flow that the deleted code might touch
3. Push to wave-1 branch (or whatever PR holds Phase G)

### G1 — Delete LeftPanel.tsx render branches replaced by ModelerLeftPane

Search:
```bash
git grep -nE "from.*panels/LeftPanel|import LeftPanel" src/
```

Each call site that already routes through `body.sg-shell-v2`
conditionally (the existing global hide) can drop the `<LeftPanel />`
JSX entirely.

Flows to re-test: 1 (Autosave — feature tree was in LeftPanel), 2
(Pro gate — File menu used legacy chrome).

### G2 — Delete RightPanel.tsx tabs replaced by ModelerRightPane

Same pattern but for the right side. The Inspector / AI / Comments /
DFM / FEA / Cost tabs are all in `ModelerRightPane`.

Flows: 6 (Photoreal — render trigger may have been in RightPanel).

### G3 — Delete sketch-mode legacy left + right panels

Phase C work replaced SketchLeftPane + SketchRightPane content. The
legacy in-Inner sketch panels can go.

Flows: 3 (CRDT multi-cursor in sketch mode), 4 (Demo mode often
starts in sketch).

### G4 — Delete AssemblyBrowser float (Components/Mates/BOM)

Phase D replaced. The float modal is now `AssemblyLeftPane` /
`AssemblyRightPane`.

Flows: 5 (Cloud conflict in assembly), 8 (Presence avatars).

### G5 — Delete DrawingPropsPane and inline floating drawing widgets

Phase E covers View properties / GD&T / Title block.

Flow: 7 (Project thumbnail render).

### G6 — Delete render-mode floating chrome

Phase F covers PBR sliders / Environment / Camera / Output. Floating
chrome in render mode can go.

Flow: 6 (Photoreal again — exit path).

### G7 — Clean cross-cutting state hooks

Run:
```bash
git grep -nE "showLeftPanel|showRightPanel|showAssemblyBrowser|showDrawingProps" src/
```

For each match: if the consumer was only legacy chrome (verified
deleted in G1-G6), delete the hook field too. Touch
`useShapeGeneratorUI.ts` and similar.

### G8 — Final Inner.tsx line-count check

```bash
wc -l src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx
```

Target: ≤ 5000 lines (down from 9977 pre-W1). If higher, identify
the residual chunks — usually orchestrator code that legitimately
spans modes.

Do NOT chase < 2000 lines if it requires risky extraction at this
stage; that's Wave 2 polish.

## Phase G exit criterion

- All 8 Phase H flows PASS (matching baseline status).
- `ShapeGeneratorInner.tsx` reduced by ≥ 30 %.
- `wc -l src/app/[lang]/shape-generator/panels/LeftPanel.tsx`
  returns 0 (file deleted) or substantially smaller.
- `npm run lint:ci` 0 errors.
- `npm run typecheck` 0 errors.
- Single PR with G1-G7 commits, ALLOW_BIG=1 on the lockfile-touching
  commits if any.

## If something breaks mid-Phase-G

Per-commit revert (the whole reason for incremental). If a single
commit broke flow N, `git revert <commit>` brings flow N back; the
prior G-commits stay landed.

If multiple commits compound: harder. Walk back chronologically until
flow N passes; the first commit that re-broke it is the culprit.

## After Phase G merges

- Update `MIGRATION.md` "Last updated" line.
- Tag the commit `wave-1/w6-phase-g-complete` for archaeology.
- Wave 1 W6-8 is now closed. Move to W9-12 (Server OCCT) or wait for
  user manual W4-5 / W14 / W16 / W17.

## What this runbook is NOT

- Not a substitute for the Phase H baseline. The baseline IS the
  load-bearing input.
- Not a deadline. If Phase H flow N is broken on main, fixing it is
  the prerequisite — do not skip.
- Not a refactor opportunity. Phase G is purely subtractive (delete
  files / branches). New logic in Phase G commits = scope creep,
  defer to follow-up.
