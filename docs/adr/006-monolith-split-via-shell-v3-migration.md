# 006 — Complete the in-progress Shell v3 migration as the W6-8 monolith split

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P0 (touches the user's primary working surface; regressions are user-visible immediately)

## Context

Wave 1 W6-8 (ADR-001) committed to splitting the 9,977-line
`ShapeGeneratorInner.tsx` monolith. Reading the code shows:

- The file is 9,977 lines, 211 imports, 392 hook invocations, 55
  top-level `useState` declarations.
- ~30 custom hooks already live in `hooks/` (e.g. `useAssemblyState`,
  `useCanvasFileImport`, `useGenDesignIntegration`,
  `useKeyboardShortcuts`, `useImportExport`). The state extraction
  effort is partially done.
- **Critically:** `src/app/[lang]/shape-generator/_shell/` contains an
  in-progress "Shell v3" migration with a complete map in
  `_shell/MIGRATION.md`. It documents every widget in the existing
  LeftPanel / RightPanel / viewport-modal stack and assigns each one
  a new home in v3 (ModelerLeftPane, ModelerRightPane, SketchLeftPane,
  AssemblyLeftPane, DrawingLeftPane, RenderRightPane, BottomDrawer).
- The migration is organized into Phases A-H with status legend
  (✅ done · 🟡 in-progress · ⬜ pending · 🚫 deprecated). Phase A is
  done; Phases B-F are ⬜ pending. Phase H is the 8-flow regression
  test gate.
- Existing routes already exist for each shell mode:
  `shape-generator/{sketch,3d-edit,analysis,assembly,drawing,render,topology}/page.tsx`.
  These are the per-mode entry points the Shell v3 migration is built
  around.

The "monolith split" Wave 1 commitment is therefore not a fresh
architecture decision; it is **completing the in-progress Shell v3
migration**.

## Decision

W6-8 ships Phases B-F of the existing Shell v3 migration, in this
order, each as its own commit per `commit-policy.md` (no big-bang):

### Phase B — Modeler shell (week 6)

Move from `ShapeGeneratorInner` → `_shell/ModelerShell` + `ModelerLeftPane` + `ModelerRightPane`:

- FeatureTree (LeftPanel top section) → `ModelerLeftPane` Features tab
- Bodies list → `ModelerLeftPane` Bodies tab
- Inspector (floating PropertyManager) → `ModelerRightPane` Inspector tab
- AI Assistant → `ModelerRightPane` Nexy AI tab
- Comments / collab → `ModelerRightPane` Comments tab
- DFM / FEA / Cost panels → Inspector ANALYZE → BottomDrawer
- Material picker → Inspector APPEARANCE → Material chip popover
- UserPartsPanel → `ModelerLeftPane` Components tab

### Phase C — Sketch shell (week 7 first half)

Move sketch-specific state/widgets → `_shell/SketchShell`:

- Sketch state + 2-step flow → `SketchLeftPane`
- SketchHistoryPanel → `SketchLeftPane` bottom accordion
- Sketch entities / constraints / dimensions sections
- Sketch property manager → `SketchRightPane` (ACTIVE SELECTION / CONSTRAINTS / PARAMETERS / SOLVER)

### Phase D — Assembly shell (week 7 second half)

- AssemblyBrowser → `AssemblyLeftPane` (Components / Mates / BOM tabs)
- Mates editor (right side) → `AssemblyRightPane` MATES section
- Interference / exploded view widgets

### Phase E — Drawing shell (week 8 first half)

- Sheet list → `DrawingLeftPane` SHEETS section
- Views on sheet → `DrawingLeftPane` VIEWS
- Layers (new) → `DrawingLeftPane` LAYERS
- View properties / GD&T / Title block → `DrawingRightPane`

### Phase F — Render shell (week 8 second half)

- Material library → already done (`MaterialLibraryPane`)
- Render PBR sliders → `RenderRightPane` re-skin
- Material properties → `RenderRightPane` re-skin

### Phase G — Wire up + dead-code removal (week 8 final 2 days)

- Promote the per-mode routes (`sketch/`, `3d-edit/`, etc.) from
  using Inner.tsx behind a flag to using the shell components directly.
- Delete migrated chunks from `ShapeGeneratorInner.tsx` only after
  all 8 Phase H flows pass on the new path.
- Goal: Inner.tsx down to ≤ 2000 lines (the workspace orchestrator
  shell only), the rest in shell modules.

### Phase H — Regression validation (gates Phase G dead-code removal)

The 8 flows in `_shell/MIGRATION.md` § "Regression test surface" MUST
all pass after every Phase B-F commit:

1. Autosave recovery
2. Pro freemium gate (2nd project)
3. CRDT multi-cursor
4. Demo mode + signup migration
5. Cloud save conflict
6. Photoreal 1-use freemium gate
7. Project thumbnail
8. Collab presence avatars

Visual regression (`e2e/visual-regression-3d.spec.ts` + the
`docs/process/visual-regression.md` runbook from Wave 0) baselines
the viewport per phase so silent rendering regressions surface
immediately.

## Consequences

### Positive

- The monolith shrinks by the amount we measurably move. After Phase
  G, `ShapeGeneratorInner.tsx` is ≤ 2 k lines (the cross-cutting
  orchestrator) instead of 9,977.
- Route-level lazy loading becomes possible — `sketch/page.tsx` only
  pulls `SketchShell` + sketch dependencies, not the whole modeler.
  First-paint cost on sketch route drops materially.
- Per-phase commits make bisect trivial. If Phase D breaks a flow,
  revert that one commit; Phases B + C stay.

### Negative

- **Highest-risk Wave 1 work.** Touching every mode shell + every
  panel surface means every Phase has a Phase H regression risk.
  Mitigation: 8-flow checklist + visual regression + per-phase
  commits (not big-bang).
- **Phase B-F sequencing is brittle** — if Phase B's ModelerShell
  doesn't pass H, every later Phase rebases against a moving floor.
  Mitigation: Phase H is a HARD gate; no Phase C work begins until
  Phase B passes.
- **The 8 regression flows themselves are unverified.** Wave 0
  shipped them as a list, but none have a recorded "last pass" date.
  W6 Day 1 runs all 8 against the current main to establish a
  baseline before any Phase B work begins.

### Neutral

- The 30+ custom hooks in `hooks/` stay. They're the state-extraction
  layer; Shell v3 is the UI surface layer. The hooks become more
  valuable as the shells are reorganized around them.

## Alternatives considered

- **Big-bang refactor in one commit** — rejected. 9,977 lines of
  diff cannot be self-reviewed honestly; the 24h delay just buys
  procrastination, not real review.
- **Split by file size (extract X panels to separate file each)** —
  rejected because that gives smaller files without changing the
  coupling. Shell v3's migration is by-concern, not by-size.
- **Park the migration, write a brand-new shell** — rejected.
  MIGRATION.md represents 4+ months of widget mapping work that
  Wave 0 didn't touch. Re-doing it would lose all that thinking.
- **Skip Wave 1 W6-8 and defer monolith split to Wave 2** —
  rejected. The W17 external engineer sign-off requires the tool to
  feel professional, which includes load times and first-tab
  responsiveness. The monolith's all-or-nothing chunk is the load-
  time bottleneck.

## Rollout

- [ ] **W6 Day 1 (2026-07-09)** — Run all 8 Phase H regression
  flows against the current `main` HEAD. Record baseline pass / fail
  in `docs/postmortem/phase-h-baseline-2026-w6.md` (must be a docs
  file so future-you sees what was true before any Phase B work).
- [ ] **W6 Days 2-7** — Phase B Modeler shell. Per-widget commits
  (FeatureTree, Bodies, Inspector, AI, Comments, DFM/FEA/Cost,
  Material picker, UserParts — ~7-8 commits). Phase H runs after
  each.
- [ ] **W7 Days 1-3** — Phase C Sketch shell.
- [ ] **W7 Days 4-7** — Phase D Assembly shell.
- [ ] **W8 Days 1-3** — Phase E Drawing shell.
- [ ] **W8 Days 4-5** — Phase F Render shell.
- [ ] **W8 Days 6-7** — Phase G dead-code removal + lazy-route promotion.
  Final size measurement on `ShapeGeneratorInner.tsx`. Target ≤ 2000 lines.

## Reversal

Per-phase: revert the commit(s) for the offending Phase. Phases A-F
are designed to be independently revertable; each ends with a Phase
H green pass, so reverting one Phase doesn't break Phases that
landed before it.

Whole-Wave revert (extreme): `git revert <every Phase B-G commit>`.
The shell v3 components stay; `ShapeGeneratorInner.tsx` is restored.
The MIGRATION.md doc records the lesson.

## Open questions (resolve before W6 Day 1)

- [ ] Is there a Phase A.5 in flight that hasn't landed yet? (Doc
  says "Last updated: Phase A.5".) Verify on W6 D1.
- [ ] Does the Wave 0 visual regression PoC
  (`e2e/visual-regression-3d.spec.ts`) actually run on CI? Need to
  generate baselines first (the spec is a PoC, baseline gen deferred
  to staging — `docs/process/visual-regression.md`). The staging
  environment depends on the user's D1/D2/D3 decisions in
  `docs/process/staging-setup-runbook.md`.

## Addendum — 2026-05-27 investigation

Reading the actual code (not just `MIGRATION.md`) reveals the
migration is **further along than the doc's ⬜ markers suggest**:

- `_shell/sidebars/ModelerLeftPane.tsx` (133 lines) is already
  implemented and live. Features tab renders from
  `useShellBridge.featureItems`; Bodies + Components are empty-state
  stubs.
- `ShapeGeneratorInner.tsx:3347` calls
  `useShellBridge.getState().setFeatureItems(...)` — Inner is
  already feeding the shell store. So when the shell-v2 UI is shown
  (gated by `?shell=v2` URL flag per `ModelerShell.tsx` header),
  Phase B's Features tab works end-to-end today.
- `ModelerRightPane.tsx` is 397 lines — substantial implementation.
  Inspector/AI/Comments tabs likely already wired (verify on W6 D1).
- `_shell/MIGRATION.md` is stale (last updated Phase A.5); the legend
  reflects the doc author's intent, not the codebase reality.

This shifts the W6-8 plan from "implement Phase B-F" to **"promote
shell-v2 to default + delete legacy LeftPanel/RightPanel render
paths"**. The pattern referenced in `ModelerShell.tsx` header:
> Inner's legacy chrome bars … are hidden via globals.css when
> `body.sg-shell-v2` is on.

So Phase G (dead-code removal) may be more work than Phase B-F (new
implementation). Final estimate stable at 3 weeks; composition
inverts.

W6 D1 first task: **survey the actual code state of every
MIGRATION.md row**, update the status legend to reflect reality.
That survey is the input to a revised per-Phase plan; ADR-006
update commit follows.

## References

- Doc: `src/app/[lang]/shape-generator/_shell/MIGRATION.md`
- Code: `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx` (9,977 lines)
- Code: `src/app/[lang]/shape-generator/_shell/` (Shell v3 components)
- Code: `src/app/[lang]/shape-generator/hooks/` (30+ extracted hooks)
- Routes: `src/app/[lang]/shape-generator/{sketch,3d-edit,analysis,assembly,drawing,render,topology}/page.tsx`
- Linked ADRs: `001-marketplace-freeze-cad-focus.md`,
  `003-occt-default-on.md` (auto-init useEffect lives in Inner.tsx;
  must be migrated to ModelerShell mount or top-level layout in
  Phase B).
- Wave 0 visual regression: `docs/process/visual-regression.md`,
  `e2e/visual-regression-3d.spec.ts`.
