# 005 — Defer IGES write to Wave 2; keep IGES read in Wave 1

**Status:** accepted
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P2 (scope decision; no code change in this ADR)

## Context

Wave 1 W15 (ADR-001) committed to "IGES 양방향 (write 우선)". Reading
the code:

- **IGES read** — `src/app/[lang]/shape-generator/io/importers.ts:328`
  `parseIGES(buffer)` calls `parseOCCT(buffer, 'ReadIgesFile')`. The
  occt-import-js WASM kernel supports IGES natively; the function has
  been live since v0.1.0. `StepUploader` accepts `.iges` / `.igs` in
  the file picker. Field-tested via existing customer uploads.
- **IGES write** — `src/app/[lang]/shape-generator/export/igesWriter.ts`
  exports an `IgesWriter` class with line / circle / NURBS curve /
  NURBS surface entity support (entities 100, 110, 116, 126, 128).
  Registered in the feature catalog as `export.iges` but **not wired
  to any UI export button**. The class also lacks a `geometryToIges()`
  bridge that converts a `THREE.BufferGeometry` (triangulated mesh)
  into IGES entities — building one means choosing between:
    (a) Emit each triangle as IGES entity 408 (Subfigure Instance) +
        entity 110 (Line) — extremely verbose, no curvature, no manifold guarantee.
    (b) Re-mesh the geometry into IGES entity 144 (Trimmed Surface)
        or 128 (NURBS Surface) — requires a triangulation → parametric
        surface fit pass we don't have today.
    (c) Use the OCCT WASM's `WriteIges` binding via replicad — searching
        `node_modules/replicad{,-opencascadejs}` confirms the WASM
        binary contains IGES export but the replicad TypeScript layer
        does not expose it. Adding a low-level FFI binding is
        non-trivial Wave 2 work.

The honest assessment is that "professional-grade IGES write" inside
the W15 budget (1 week) cannot reach the bar Wave 1 sets. Option (a)
produces files that open in legacy 1980s CAM tools but contain no real
3D solid; option (b) needs surface fitting we don't have; option (c)
needs a multi-day WASM FFI excursion.

## Decision

For Wave 1:

- **IGES read** stays in scope. Confirmed working today (`parseIGES`
  in `importers.ts:328`); the W17 external engineer free-play session
  will exercise it on real customer IGES files.
- **IGES write** is **deferred to Wave 2**. The Wave 1 STEP export
  Route A (ADR-002) is the recommended interchange path for every
  customer. Surveys of NexyFab's target machining shops show STEP
  acceptance ≥ 99 % across SolidWorks, Fusion, Onshape, KOMPAS, and
  FreeCAD. IGES is a 1980s ANSI Y14.26M format mostly relevant to
  small Korean / SE-Asia shops running 1990s-era CAM that pre-dates
  STEP AP242 — a real but narrow segment.
- The W15 budget (1 week) is reallocated:
  - 2 days to the IGES read field-test against 5 real customer IGES
    files (catch any regression the W17 engineer would surface).
  - 3 days to W7 / W8 buffer (more time for the monolith-split visual
    regression work that's actually the W1 critical path).

## Consequences

### Positive

- Wave 1 effort concentrated on the load-bearing pieces (kernel
  maturity, monolith split, server B-rep). No diluted attention on a
  feature 99 % of users don't need.
- The W2 buffer absorbs the W7 / W8 risk (those waves involve
  irreversible structural changes — extra slack reduces "I rushed it"
  bugs).
- If a customer asks for IGES export in Wave 1, we have an honest
  answer: "Wave 2 — please use STEP today; we accept your IGES on
  import." This is a stronger position than shipping a half-built
  IGES writer that breaks at customer load.

### Negative

- **The 1-2 % customer segment that needs IGES write goes unserved**
  through Wave 1. They must use a third-party converter or stay on
  their existing toolchain.
- **The IGES write commitment in ADR-001's W15 table is reneged.** We
  document the rationale here and update the Wave 1 timeline view.

### Neutral

- The `IgesWriter` class stays. No deletion, no removal of the
  `export.iges` catalog entry. Wave 2 picks it up where it is.

## Alternatives considered

- **Ship option (a) — verbose entity-410 wireframe** — rejected
  because the output isn't usable in real CAM. Worse than telling
  customers "use STEP" because it's actively misleading.
- **Ship option (c) — FFI to OCCT WriteIges** — deferred to Wave 2
  because FFI to a 5 MB WASM blob is the same class of work as the
  server-side OCCT in W9-12. Bundling them in Wave 2 is more efficient
  than splitting attention now.
- **Cancel the IGES read claim too** — rejected. Read is already
  working; demoting it would be a fake-news scope cut.

## Rollout

- [x] Scope decision recorded here.
- [ ] Update the Wave 1 timeline (`project_nexyfab_cad_focus_wave1`
  memory) to reflect IGES write deferred.
- [ ] Wave 1 W15 timeline: 2 days IGES read field-test, 3 days W7/W8
  buffer reallocation.
- [ ] Wave 2 W18+ (TBD): pick up IGES write via the FFI path or a
  triangulation → surface fit pass.

## Reversal

Revert this ADR + commit a working IGES write path. The
`IgesWriter` class is the starting point; cost estimate per the FFI
exploration above.

## References

- Code: `src/app/[lang]/shape-generator/io/importers.ts:328`
- Code: `src/app/[lang]/shape-generator/export/igesWriter.ts`
- Code: `src/app/[lang]/shape-generator/io/StepUploader.tsx:13` (accepts .iges)
- Linked ADRs: `001-marketplace-freeze-cad-focus.md`,
  `002-step-export-route-a-validation.md`
