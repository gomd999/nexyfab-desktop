# 002 — Validate-and-harden STEP export Route A (no new engine work)

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P0 (production output: every CAD user evaluates the tool by whether STEP roundtrips work)

## Context

ADR-001 commits W1-2 of Wave 1 to "STEP export Route A". Reading the
current code shows the **engine side is already implemented**:

- `src/app/[lang]/shape-generator/io/stepExporter.ts:36-46` —
  `exportToStepAsync()` already calls `meshToOcctShapeHandle(geometry)`
  when no OCCT handle is present, converts mesh → OCCT B-rep, caches
  the handle, and exports through `exportOcctStep()`.
- `src/app/[lang]/shape-generator/features/occtEngine.ts:163-183` —
  `meshToOcctShapeHandle()` builds binary STL, imports via
  `replicad.importSTL`, registers the resulting shape, returns the handle.
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx:7730` —
  the UI already uses the optimistic `canExportStepViaBridge` predicate
  (always true) for the toolbar's `stepExportSupported` prop, not the
  conservative `canExportStepCleanly`.

In other words: **the UI button is enabled for all geometries; the
runtime bridge attempts to convert and export; the conservative
predicate `canExportStepCleanly` is now only used for the docs/legacy
gating logic, not for blocking user clicks**.

The 2026-05-12 `docs/strategy/step-export-gating.md` runbook is stale
on this point. The R2 burn-in finding it cites
(`COORDINATES_LIST + TRIANGULATED_FACE` rejected by `occt-import-js`)
applies to the **legacy AP242 emitter (`exportToStep`)**, which is now
only reached as a last-resort fallback when both the OCCT-handle path
and the Route A bridge fail.

What this means for W1-2:

The work is **not** "implement Route A". The work is
**"validate and harden Route A"** — convert the engine-level capability
into provable quality. Three things:

1. End-to-end empirical roundtrip evidence in 5 external viewers.
2. UX during the ~100-300 ms hot OCCT bridge conversion (loading state).
3. Bug-fix capacity for the edge cases the roundtrip matrix uncovers.

## Decision

W1-2 (target end 2026-06-11) ships:

1. **Roundtrip matrix evidence** — 20 fixture geometries (Sketch
   extrudes, revolves, sweeps, lofts, helices, booleans, fillets, shell
   ops, mirror/pattern) exported via the live UI, imported into 5
   external viewers (FreeCAD, SolidWorks eDrawings, Fusion 360,
   Onshape, KOMPAS Viewer), checked for visual fidelity + dimensional
   accuracy. Pass criterion: ≥ 95 % of cells render the same shape with
   < 0.1 mm RMSE.

2. **Loading-state UX** — the toolbar STEP button shows a "Converting
   via OCCT…" spinner during `exportToStepAsync` when the underlying
   geometry lacks an `occtHandle`. Currently the button is enabled with
   no indication that ~300 ms of work happens off-thread. Implementation:
   a `busy` state in the toolbar, set true before `await
   exportToStepAsync`, cleared in finally.

3. **Edge-case fixes** — whatever the matrix uncovers gets a bug fix or
   a documented limitation note. We commit one fix per surfaced bug;
   sweeping refactors deferred to Wave 2.

We **do not** write a new STEP emitter, a new mesh → B-rep importer, or
a new file format. Replicad / `occt-import-js` / the existing OCCT
exporter are the engine; this ADR confirms they are sufficient for
Wave 1.

## Consequences

### Positive

- **W1-2 timeline tightens** — code work shrinks; testing work expands.
  The 12-day W1-2 budget remains realistic if the matrix uncovers
  fixable bugs (not architectural problems).
- **Documentation alignment** — the stale `step-export-gating.md` will
  be replaced (or annotated) with the post-Route-A reality.
- **Evidence-driven completion** — "STEP works" becomes "STEP roundtrips
  in these 5 viewers on these 20 fixtures with this RMSE". No more
  hand-waving.

### Negative

- **Viewer access cost** — we need accounts/licenses on 5 different
  CAD tools. Free tiers exist for FreeCAD (OSS), SW eDrawings (free
  viewer), Fusion 360 (personal-use), Onshape (free public account),
  KOMPAS Viewer (free). Likely $0 cost but ~half a day to set up.
- **Real bugs surface** — the matrix will fail at first. The Wave 1
  budget must absorb 5-10 fix days. This is in the realistic estimate
  but counts as W1-2 scope, not W3+.

### Neutral

- The conservative `canExportStepCleanly` predicate stays for now, used
  only by docs and the legacy fallback. We may remove it in a follow-up
  if it stops being useful.

## Alternatives considered

- **Implement a hand-rolled AP242 emitter that occt-import-js accepts**
  (the original "Route B" of the 2026-05-12 gating doc) — rejected
  because Route A (going through the OCCT kernel itself) is now working
  and produces real ADVANCED_FACE STEP that downstream tools (NX,
  CATIA, Fusion) accept better than tessellated approximations.
- **Skip viewer matrix, trust the OCCT kernel** — rejected because
  "the kernel exports something" ≠ "the file opens correctly in the
  tools an engineer actually uses". The matrix is the load-bearing
  evidence.
- **Defer loading UX to Wave 3** — rejected because ~300 ms of silent
  button-press makes the tool feel broken on first use; the fix is
  cheap; users decide professional-vs-toy in the first 30 seconds.

## Rollout

- [ ] **W1 D1 (2026-05-28)** — collect 20 fixture geometries; export
  each via the live UI; save the resulting `.step` files.
- [ ] **W1 D2-3** — set up the 5 viewers; import each `.step` file in
  each viewer; record visual + dimensional results in a grid in
  `docs/strategy/step-roundtrip-matrix-2026-w1.md`.
- [ ] **W1 D4-5** — implement the "Converting via OCCT…" spinner state
  in the toolbar.
- [ ] **W2** — fix the edge cases the matrix surfaced. Commit per bug.
- [ ] **W2 end** — annotate `docs/strategy/step-export-gating.md` to
  reflect the Route A reality. Update `BREP_QA_CHECKLIST.md` row 4
  (existing) and add new STEP roundtrip rows.

## Reversal

Reversal is straightforward because no new APIs are added:

- Revert any UI changes (loading state) → behavior returns to instant
  silent button press.
- Revert any edge-case fixes → those bugs reopen.
- The engine itself (`meshToOcctShapeHandle`, `exportToStepAsync`) is
  unchanged by this ADR.

## References

- Code: `src/app/[lang]/shape-generator/io/stepExporter.ts`
- Code: `src/app/[lang]/shape-generator/features/occtEngine.ts:163`
- Code: `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx:7730`
- Prior doc (stale): `docs/strategy/step-export-gating.md`
- Existing test: `src/app/[lang]/shape-generator/__tests__/step.roundTrip.test.ts`
- Linked ADR: `001-marketplace-freeze-cad-focus.md`
