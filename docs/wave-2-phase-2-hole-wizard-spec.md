# Wave 2 — Phase 2 Hole Wizard Feature Spec (Design Only)

**Status:** design / spec-only — NO implementation in this doc
**Date:** 2026-05-28
**Author:** wave-2 architecture
**Risk tier:** P1 (UX-critical, no data-loss surface)
**Phase:** Wave 2 Phase 2 (4 weeks)
**Related:**
- `src/app/[lang]/shape-generator/features/hole.ts` (existing single-position hole feature)
- `src/app/[lang]/shape-generator/features/holeStandards.ts` (existing ISO/ANSI lib — to extend)
- `src/app/[lang]/shape-generator/features/HoleWizardModal.tsx` (existing single-hole modal)
- `src/app/[lang]/shape-generator/features/boolean.ts` (existing OCCT boolean engine)
- `docs/wave-2-crdt-architecture.md` (Phase 2 body registry + scene)
- ADR-009 (occt-worker pool / wave-1 GA)
- ADR-010 (wave-2 B-full + collab)
- KS B 0201 (ISO 미터 보통 나사), KS B 0205 (ISO 미터 가는 나사),
  ISO 273 (clearance holes), ISO 4762 (socket head cap screws),
  ISO 10642 (countersunk socket screws), ANSI/ASME B1.1 (UTS),
  ASME B18.3 (socket-head imperial), ASME B1.20.1 (NPT taper pipe)

---

## Purpose

Wave 1 ships a working **single-hole boolean cut** via `features/hole.ts`
(three-bvh-csg with OCCT fallback) plus a **single-position modal**
(`HoleWizardModal.tsx`) that consults a small ISO/ANSI library. That carries
the basic "drill one hole" UX, but it is **insufficient** for real
manufacturing parts:

1. Cover plates, housings, and mounting brackets carry **4-50 holes** in a
   single pattern. The current wizard requires one modal-cycle per hole.
2. The library covers **M3-M20** plus a partial ANSI set; KS B 0201 standard
   sizes M1.6, M2, M2.5, M14, M18, M22, M24, M27, M30 are missing. Korean
   shops routinely cut M2.5 (small electronics housings) and M22-M30 (heavy
   machinery, mold plates).
3. No **counterdrill** (drill + counterbore combined) — partners working
   with shoulder bolts and stepped fasteners ask for it.
4. No **tap (cosmetic)** representation — the current "tap" preset only
   inserts the tap-drill diameter; the thread itself is invisible in the
   feature tree, so downstream tools (drawing hole-table, DFM gate) cannot
   tell a drilled hole apart from a tapped hole.
5. No **pipe-tap** (NPT/BSP) library — required by hydraulic / pneumatic
   fitting partners (cf. `standardParts/hydraulicFittings.ts`).
6. No **sketch-based multi-position** input. Patterning today is done by
   creating the feature N times. Engineers expect "sketch points → instance
   the same hole at every point" workflow (SolidWorks `Hole Wizard` + 3D
   Sketch, Onshape `Hole` + sketch).
7. No **multi-hole transaction** at the worker. Even if the client looped
   single-hole calls, each round-trip is a separate OCCT shape commit; one
   transaction with N holes is faster and lets us return a hole-table in
   one shot.
8. No **drawing-side callout** primitive. Phase 3 needs `M8×20 ⌴ 13×6.5`
   style callouts driven by the feature, not re-derived from STEP geometry.

Phase 2 delivers a **second-generation Hole Wizard** that addresses 1-7 in
this document, and lays the data foundation for 8 (deferred to Phase 3
drawing work — only the data fields are designed here).

### What this doc decides

- Final hole **type taxonomy** (drilled / counterbore / countersink /
  counterdrill / tap / pipe-tap)
- Full **ISO metric** + **UTS imperial** + **pipe-thread** library size
  rows with numeric drill / clearance / cbore / csk values
- `HoleFeature` **data model** shape (for serialization, CRDT, and worker
  RPC), with positions as either absolute points or a sketch reference
- New **worker endpoints** (`/occt/op/hole/*`) accepting multi-position
  arrays in one call, return shape: STEP + STL + per-hole metadata
- **Modal redesign** with type/size/position/termination tabs and a
  multi-language label table (KR/EN/JA/ZH/ES/AR)
- **Sketch input flow** — "Add holes from sketch" UX, including how
  subsequent edits work
- A **4-week timeline** with weekly deliverable gates
- A **test fixture set** covering all six hole types with measurable pass
  criteria
- Phase 3 hand-off contract (hole-table, callout) — fields exposed by
  `HoleFeature` so Phase 3 can read directly

### Out of scope for this doc

- Drawing rendering of hole callouts / hole tables (Phase 3)
- GD&T position-tolerance UI on hole patterns (Phase 3 — only the data
  hook is designed here)
- Thread render at 3D (cosmetic decal only — actual helix geometry is
  Phase 4+)
- Tap-burn-rate cost model for quoting (RFQ / quoting Phase 2.5)
- Assembly mate auto-suggest from M-class hole pairs (Phase 4)

---

## 1. Current state — code inventory

### 1.1 What exists today

| File | Role | Limitation |
|---|---|---|
| `features/hole.ts` | Single-position hole feature (three-bvh-csg + OCCT). Params: `holeType` (0/1/2), `diameter`, `posX/posZ`, `depth`, `counterboreDia/Depth`, `countersinkAngle`, `engine`. | Single position. `holeType` only 0/1/2 (no counterdrill, tap, pipe). `depth=999` sentinel = through-all but no `upToNext` / `upToFace`. |
| `features/holeStandards.ts` | `HoleStandardSpec` rows for M3, M4, M5, M6, M8, M10, M12, M16, M20 + ANSI #4 / #6 / #8 / #10 / 1/4 / 5/16 / 3/8 / 1/2. `HoleKind = 'through' \| 'tap' \| 'counterbore' \| 'countersink' \| 'spotface'`. Depth presets 1×D / 1.5×D / 2×D / through-all. | Missing: M1.6, M2, M2.5, M14, M18, M22, M24, M27, M30; ANSI #0, #2, 7/16, 5/8, 3/4; **no NPT / BSP** rows. |
| `features/HoleWizardModal.tsx` | Modal: ISO/ANSI series → size grid → kind → posX/Z + depth → preview → onApply. 6-lang dict (ko/en/ja/zh/es/ar). | Single position input. No sketch picker. No type "counterdrill" / "pipe-tap". Termination is just a depth number. |
| `features/boolean.ts` | OCCT `subtract` op (cylinder/cone primitives). Used by `hole.ts` for OCCT path. | One primitive per call. |
| `assembly/SmartFastenerPanel.tsx` | Reads hole features, suggests matching screws (cf. `standardParts/smartFasteners.ts`). | Will need to consume the new `HoleFeature.standard` + `sizeKey` keys instead of inferring from `diameter`. |
| `annotations/ThreadHoleCalloutPanel.tsx` | Reads tapped-hole features and emits a callout string. | Currently parses `diameter` against a sieve of M-values; will switch to direct `sizeKey` lookup. |
| `plugins/examples/holeWizardPlugin.ts` | Sample plugin entry. | Not a real integration; placeholder. |

### 1.2 What is missing

- Library rows: M1.6, M2, M2.5, M14, M18, M22, M24, M27, M30 (ISO);
  #0-80, #1-72, #2-56, #3-48, #5-40, 7/16-14, 1/2-13 (already partial),
  5/8-11, 3/4-10 (UTS). NPT 1/8 through 1 (pipe).
- **Counterdrill** type (combined cbore + drill, different sizing rules).
- **Tap as a first-class type** with `tapClass` (`6H` / `6G` / `2B`) and
  `tapDepth` (often less than the drill depth).
- **Pipe tap** with taper angle (1°47' for NPT) and pipe size key.
- **Termination modes** beyond `depth=999`: `blind`, `throughAll`,
  `upToNext`, `upToFace`.
- **Drill-tip angle** stamped at the bottom of blind drilled holes
  (118° standard, 135° for harder steels) — currently flat-bottom.
- **Sketch position source** — `positionMode: 'fromSketch' \| 'absolute'`.
- **Multi-position single transaction** at OCCT — current code does N
  separate calls if the UI loops.
- **Per-hole metadata** in worker response (each hole's resolved center,
  actual depth after `upToFace` resolution).

### 1.3 Reuse plan

We **extend** rather than rewrite:

- `holeStandards.ts` grows new rows + `HoleKind` gains `'counterdrill'`
  and `'pipe-tap'`. Existing consumers (`smartFasteners`, callout panel)
  keep working because the spec shape only adds fields.
- `HoleWizardModal.tsx` is **renamed → `HoleWizardModalLegacy.tsx`** and
  preserved at the original path. A new `HoleWizardModalV2.tsx` is
  introduced behind a feature flag (`hole_wizard_v2` in `uiStore`). The
  legacy modal stays callable from the command palette during Wave 2
  Phase 2 so we can A/B test wording / layout.
- `features/hole.ts` keeps the current params (back-compat); the new
  multi-position behavior is a **sibling feature `holeArray`** so any
  pre-Phase-2 `.nfab` file still loads. Migration is a one-shot batch
  during Phase 4 cleanup (out of scope here).

---

## 2. Hole-type taxonomy

Six first-class types in Phase 2. Each maps to one or more boolean cuts.

### 2.1 Drilled

A plain cylindrical bore with an optional **conical tip** (118°/135°)
at the bottom when `terminationMode = 'blind'`. This is the default and
the most common type.

```
        ┌───────┐  ← top face (sketch face)
        │       │
        │   Ø D │  drill diameter
        │       │
        │       │
        └─┬───┬─┘  ← blind bottom (with 118° apex if blind)
          │   │
          └───┘    ← apex of drill tip
```

- Param: `drillDiameter`
- Param: `drillTipAngle` (default 118; set 135 for hardened material;
  set 180 = flat for cosmetic / through holes)
- For `throughAll`, the tip is suppressed.

### 2.2 Counterbore

A flat-bottomed **wider, shallower** cylinder at the top, combined with
the drilled hole through. Pocket for socket-head cap screws (ISO 4762).

```
        ┌──────────────┐  ← top face
        │              │
        │   Ø Dc       │  cbore diameter (e.g. M6 → 11 mm)
        │              │
        ├──┬──────┬────┤  ← cbore floor
           │      │
           │ Ø D  │       drill diameter (e.g. M6 → 6.6 mm clearance)
           │      │
           └──────┘
```

- Param: `cboreDiameter`, `cboreDepth` (from top face)
- Param: `drillDiameter`
- **Spotface** is a degenerate counterbore where `cboreDepth ≈ 0.3 ×
  cboreDepth_std`. We keep this as a separate `kind` for label clarity
  but the underlying booleans are identical.

### 2.3 Countersink

A **conical funnel** at the top, combined with the drilled hole through.
Pocket for flat-head / oval-head screws (ISO 10642 metric, ASME B18.3
imperial).

```
        \              /     ← top face
         \    angle   /
          \  α       /        e.g. ISO α=90°, UTS α=82°
           \        /
            \______/          ← bottom of cone
            |      |
            | Ø D  |          drill diameter
            |      |
            └──────┘
```

- Param: `csAngle` ∈ {60, 82, 90, 100, 110, 120}.
- Param: `csDiameter` — diameter at top face (computed from screw spec,
  user-overridable).
- Implied param: `csDepth = csDiameter / (2 tan(α/2))` — derived, not
  stored, to keep the constraint simple.

### 2.4 Counterdrill

A **drill + counterbore combined** with a smaller-diameter pocket
intermediate. Used for shoulder bolts and stepped fasteners — three
diameters in one feature.

```
        ┌──────────────┐  ← top face
        │   Ø Dc       │   cbore (head clearance)
        ├──┬──────┬────┤  ← step 1 (intermediate-step floor)
           │      │
           │ Ø Dm │        middle step (shoulder clearance)
           │      │
           ├─┬─┬──┤       ← step 2
             │ │
             │ │ Ø D       drill (thread clearance)
             │ │
             └─┘
```

- Param: `cboreDiameter`, `cboreDepth` (top step)
- Param: `middleDiameter`, `middleDepth` (intermediate step)
- Param: `drillDiameter` (innermost)
- Booleans = three concentric cylinder subtracts.
- Library coverage: only ISO metric M5-M16 shoulder-bolt mapping. Custom
  values allowed.

### 2.5 Tap

A **cosmetic** tap representation: visually it is a drilled hole at the
tap-drill diameter (e.g. M6 → Ø5.0), but the feature carries a
`tapClass`, `pitch`, and `threadDepth` so downstream tools (callout,
DFM gate, smart-fasteners) know it is a tapped hole.

- 3D rendering: same as `drilled` (no helix). Add a faint blue ring at
  the top in selection highlight to signal "this is tapped".
- Param: `pitch` (defaults from library — e.g. M6 → 1.0 coarse, 0.75 fine).
- Param: `tapClass` ∈ {`6H`, `6G`} (ISO) or {`2B`, `3B`} (UTS).
- Param: `tapDepth` — depth of usable thread, usually shorter than the
  drill depth (rule of thumb: `tapDepth ≤ drillDepth − 3 × pitch`).
- A `tap-warning` is emitted by `dfmGate.ts` if `tapDepth >
  drillDepth − 2 × pitch` (too close to bottom, tap will bottom out).

### 2.6 Pipe tap

A **tapered tap** for pipe fittings (NPT/BSP). Visually rendered as a
shallow taper bore (1°47′ half-angle for NPT) plus thread metadata.

- Param: `pipeStandard` ∈ {`NPT`, `BSPT`, `BSPP`}.
- Param: `pipeSizeKey` (e.g. `1/8-27`, `1/4-18`, `3/8-18`, `1/2-14`,
  `3/4-14`, `1-11.5`).
- Param: `engagementDepth` (effective thread length).
- Boolean cut: a cylinder at the minor diameter for the engagement
  depth (taper itself is cosmetic; the actual thread is cut on the
  shop floor with a pipe-tap tool).
- 3D selection highlight: orange ring (distinct from cyan tap).

---

## 3. Standard size library

The numeric values below are the **authoritative source** for the
Phase 2 library expansion. Where Phase 1 already has the row, the
existing values are preserved for back-compat; new rows are added.

### 3.1 ISO Metric — full table (KS B 0201 + ISO 273 + ISO 4762 + ISO 10642)

| Size | Pitch (coarse) | Tap drill ⌀ | Close fit ⌀ | Normal fit ⌀ | Loose fit ⌀ | Cbore ⌀ × depth | Csk ⌀ @ 90° |
|------|----------------|-------------|-------------|--------------|-------------|------------------|--------------|
| M1.6 | 0.35 | 1.25 | 1.7  | 1.8  | 2.0  |  3.5 × 1.8  |  3.5 |
| M2   | 0.40 | 1.60 | 2.2  | 2.4  | 2.6  |  4.4 × 2.2  |  4.4 |
| M2.5 | 0.45 | 2.05 | 2.7  | 2.9  | 3.1  |  5.5 × 2.7  |  5.5 |
| M3   | 0.50 | 2.50 | 3.2  | 3.4  | 3.6  |  6.5 × 3.3  |  6.72 |
| M4   | 0.70 | 3.30 | 4.3  | 4.5  | 4.8  |  8.0 × 4.4  |  8.96 |
| M5   | 0.80 | 4.20 | 5.3  | 5.5  | 5.8  |  9.5 × 5.4  | 11.2 |
| M6   | 1.00 | 5.00 | 6.4  | 6.6  | 7.0  | 11.0 × 6.5  | 13.44 |
| M8   | 1.25 | 6.80 | 8.4  | 9.0  | 10.0 | 15.0 × 8.6  | 17.92 |
| M10  | 1.50 | 8.50 | 10.5 | 11.0 | 12.0 | 18.0 × 10.8 | 22.4 |
| M12  | 1.75 | 10.20 | 13.0 | 13.5 | 14.5 | 20.0 × 13.0 | 26.88 |
| M14  | 2.00 | 12.00 | 15.0 | 15.5 | 16.5 | 24.0 × 15.2 | 30.8 |
| M16  | 2.00 | 14.00 | 17.0 | 17.5 | 18.5 | 26.0 × 17.5 | 33.6 |
| M18  | 2.50 | 15.50 | 19.0 | 20.0 | 21.0 | 30.0 × 19.5 | 36.8 |
| M20  | 2.50 | 17.50 | 21.0 | 22.0 | 24.0 | 33.0 × 21.5 | 40.32 |
| M22  | 2.50 | 19.50 | 23.0 | 24.0 | 26.0 | 36.0 × 23.5 | 44.8 |
| M24  | 3.00 | 21.00 | 25.0 | 26.0 | 28.0 | 40.0 × 25.5 | 48.0 |
| M27  | 3.00 | 24.00 | 28.0 | 30.0 | 32.0 | 43.0 × 28.5 | 53.5 |
| M30  | 3.50 | 26.50 | 31.0 | 33.0 | 35.0 | 48.0 × 32.0 | 60.0 |

Notes:
- Pitch column is **coarse**. Fine-pitch series (KS B 0205) is exposed
  through `sizeKey` suffixes like `M8x1.0` — a separate inner table not
  shown here (5 rows: M8x1, M10x1.25, M12x1.25, M16x1.5, M20x1.5).
- "Close / normal / loose" follow ISO 273 grades H12/H13/H14.
- Cbore depth values target ISO 4762 socket-head heights × 1.10 so the
  head sits ~10% sub-flush. This is a conservative shop default and the
  user can override.
- Csk diameter is the **face diameter** at the part top; physical
  diameter is `csk_⌀ + 0.6 × csk_⌀_tol` per ISO 10642 — we keep one
  number for the library and let the user dial up in custom mode.

### 3.2 UTS Imperial — full table (ANSI/ASME B1.1 + ASME B18.3)

All values are stored in **mm** internally (the modeler pipeline is mm)
but the row carries the imperial name and an `inch` tag for display.

| Size       | TPI  | Tap drill ⌀ (mm) | Close fit ⌀ | Normal fit ⌀ | Loose fit ⌀ | Cbore ⌀ × depth | Csk ⌀ @ 82° |
|------------|------|-------------------|-------------|--------------|-------------|------------------|--------------|
| #0-80      | 80   | 1.18 | 1.85  | 1.95  | 2.05  |  3.18 × 1.65 |  3.18 |
| #1-72      | 72   | 1.45 | 2.10  | 2.18  | 2.30  |  3.81 × 1.98 |  3.81 |
| #2-56      | 56   | 1.85 | 2.46  | 2.54  | 2.69  |  4.45 × 2.34 |  4.45 |
| #3-48      | 48   | 2.13 | 2.79  | 2.87  | 3.05  |  5.08 × 2.69 |  5.08 |
| #4-40      | 40   | 2.26 | 3.05  | 3.20  | 3.40  |  5.94 × 3.18 |  5.79 |
| #5-40      | 40   | 2.69 | 3.50  | 3.66  | 3.86  |  6.55 × 3.50 |  6.55 |
| #6-32      | 32   | 2.69 | 3.81  | 3.97  | 4.17  |  6.88 × 3.78 |  7.14 |
| #8-32      | 32   | 3.40 | 4.50  | 4.76  | 4.95  |  7.94 × 4.42 |  8.53 |
| #10-24     | 24   | 3.80 | 5.20  | 5.56  | 5.80  |  9.53 × 5.13 |  9.91 |
| #10-32     | 32   | 4.22 | 5.20  | 5.56  | 5.80  |  9.53 × 5.13 |  9.91 |
| 1/4-20     | 20   | 5.11 | 6.91  | 7.14  | 7.54  | 12.70 × 6.76 | 13.08 |
| 5/16-18    | 18   | 6.53 | 8.51  | 8.73  | 9.13  | 15.88 × 8.46 | 16.26 |
| 3/8-16     | 16   | 7.94 | 10.16 | 10.32 | 10.72 | 19.05 × 10.16 | 19.46 |
| 7/16-14    | 14   | 9.40 | 11.91 | 12.07 | 12.30 | 22.23 × 11.91 | 22.23 |
| 1/2-13     | 13   | 10.72 | 13.10 | 13.49 | 13.89 | 25.40 × 13.49 | 25.86 |
| 5/8-11     | 11   | 13.49 | 16.27 | 16.66 | 17.07 | 31.75 × 16.66 | 31.75 |
| 3/4-10     | 10   | 16.66 | 19.45 | 19.84 | 20.24 | 38.10 × 19.84 | 38.10 |

Notes:
- TPI = threads per inch.
- Csk angle is **82°** for imperial flat-head screws by default.
- The mm-conversion uses 25.4 mm/in; values are rounded to two decimals.
- "Normal fit" matches ASME B18.2.8 normal clearance class.

### 3.3 Pipe-thread library — NPT (ASME B1.20.1)

Each row carries the nominal pipe size, threads per inch, and the
**minor (tap) diameter at the gauging plane**. The taper is 1°47′
(3.5%) on a side for all NPT sizes. We store cylinder-equivalent
minor diameter — the actual taper is rendered cosmetically.

| NPT size  | TPI  | Tap drill ⌀ (mm) | Engagement depth (mm, typ.) |
|-----------|------|-------------------|------------------------------|
| 1/16-27   | 27   |  6.10 |  6.5 |
| 1/8-27    | 27   |  8.61 |  7.0 |
| 1/4-18    | 18   | 11.40 |  9.7 |
| 3/8-18    | 18   | 14.50 | 10.4 |
| 1/2-14    | 14   | 17.75 | 13.7 |
| 3/4-14    | 14   | 22.96 | 14.0 |
| 1-11.5    | 11.5 | 28.80 | 17.3 |
| 1 1/4-11.5| 11.5 | 37.45 | 17.8 |
| 1 1/2-11.5| 11.5 | 43.45 | 17.8 |
| 2-11.5    | 11.5 | 55.40 | 17.8 |

BSP (G-thread, parallel) follows ISO 228-1 — a second table with the
same column layout. Rows: G1/8, G1/4, G3/8, G1/2, G3/4, G1 (added in
Week 2 of the implementation timeline; not exhaustively listed here).

### 3.4 Library file layout

Phase 2 stores all three series as separate exports from
`holeStandards.ts` (kept in one file under 600 lines for tree-shaking):

```ts
export const ISO_METRIC: HoleStandardSpec[]
export const ISO_METRIC_FINE: HoleStandardSpec[]   // KS B 0205
export const ANSI_IMPERIAL: HoleStandardSpec[]
export const PIPE_NPT: PipeThreadSpec[]
export const PIPE_BSP: PipeThreadSpec[]

export const HOLE_STANDARD_SERIES = {
  ISO: ISO_METRIC,
  ISO_FINE: ISO_METRIC_FINE,
  UTS: ANSI_IMPERIAL,
  NPT: PIPE_NPT,
  BSP: PIPE_BSP,
};
```

`PipeThreadSpec` is a sibling type (separate from `HoleStandardSpec`)
because pipe rows don't have a counterbore/countersink concept:

```ts
export interface PipeThreadSpec {
  name: string;          // '1/4-18'
  unit: 'in';
  standard: 'NPT' | 'BSPT' | 'BSPP';
  nominalNps: string;    // '1/4'
  tpi: number;
  tapDrill: number;      // mm
  engagementDepth: number; // mm
  taperHalfAngleRad?: number; // 0.0308 rad ≈ 1°47′ for NPT
}
```

---

## 4. Data model

### 4.1 `HoleFeature` (canonical)

The feature tree node. A single `HoleFeature` carries **N positions** —
each instance is a hole. Patterning happens **inside** the feature, not
by duplicating the feature node.

```ts
export interface HoleFeature {
  id: string;
  type: 'hole';                  // unchanged for tree compat
  kind: HoleKind;                // 'drilled' | 'counterbore' | 'countersink' |
                                 // 'counterdrill' | 'tap' | 'pipeTap'

  /** Library reference. 'custom' bypasses the library and uses raw fields. */
  standard: 'iso' | 'iso_fine' | 'uts' | 'npt' | 'bsp' | 'custom';
  sizeKey: string;               // 'M3', 'M8x1.25', '1/4-20', '1/2-14', '_custom'
  fitClass?: 'close' | 'normal' | 'loose'; // for clearance kinds

  /** Position source. */
  positionMode: 'absolute' | 'fromSketch';
  positions: Array<{
    id: string;                  // stable per-hole id (for edit / table)
    x: number;
    z: number;
    /** Per-hole overrides — null = inherit from feature defaults. */
    depthOverride?: number | null;
    suppressed?: boolean;        // user toggled this instance off
  }>;
  /** When positionMode='fromSketch': */
  sketchRef?: {
    featureId: string;           // sketch feature id producing the points
    pointFilter?: string[];      // empty / undefined = all points
  };

  /** Base face the hole is cut from (top face of the host body). */
  baseFaceRef: FaceRef;          // existing FaceRef from face-provenance

  /** Termination — controls bottom of the drilled bore. */
  terminationMode: 'blind' | 'throughAll' | 'upToNext' | 'upToFace';
  blindDepth?: number;           // when 'blind'
  upToFaceRef?: FaceRef;         // when 'upToFace'
  drillTipAngle: number;         // 118 default, 135 hard, 180 flat

  // ─── Counterbore fields (used when kind ∈ {counterbore, counterdrill, spotface}) ─
  cboreDiameter?: number;
  cboreDepth?: number;
  cboreFromBottom?: boolean;     // rare: cbore from the opposite side; default false

  // ─── Countersink fields (used when kind = countersink, counterdrill) ─
  csAngle?: number;              // 60 / 82 / 90 / 100 / 110 / 120
  csDiameter?: number;

  // ─── Counterdrill (only) — middle step ─
  middleDiameter?: number;
  middleDepth?: number;

  // ─── Tap (cosmetic) fields ─
  tapClass?: '6H' | '6G' | '2B' | '3B';
  pitch?: number;                // mm/thread or in/thread (derived from sizeKey)
  tapDepth?: number;             // <= drillDepth - 2*pitch (DFM gate)

  // ─── Pipe-tap (cosmetic) ─
  pipeStandard?: 'NPT' | 'BSPT' | 'BSPP';
  pipeSizeKey?: string;          // '1/4-18'
  engagementDepth?: number;

  /** Engine selector (matches existing feature). */
  engine: 0 | 1;                 // 0 = three-bvh-csg, 1 = OCCT
}
```

### 4.2 Invariants

- `positions.length ≥ 1`. Empty position array = error at rebuild
  (caught by `featureParamSchema`). When `positionMode = 'fromSketch'`
  and the referenced sketch has zero points, the feature is **soft-skipped**
  (no boolean run) and a warning surfaced in the feature tree.
- `kind ∈ {counterbore, spotface}` implies `cboreDiameter !== undefined`.
- `kind ∈ {countersink, counterdrill}` implies `csAngle !== undefined`.
- `kind = counterdrill` implies all of `cbore*`, `middle*`, `drill*` set.
- `kind = tap` implies `pitch !== undefined`. `tapDepth ≤ drillDepth − 2 ×
  pitch` (warning, not hard error — DFM gate emits a `TAP_BOTTOM_RISK`).
- `kind = pipeTap` implies `pipeStandard` and `pipeSizeKey`.
- `terminationMode = 'blind'` ↔ `blindDepth !== undefined`.
- `terminationMode = 'upToFace'` ↔ `upToFaceRef !== undefined`.
- `drillTipAngle ∈ (60, 180]`. `180 = flat`.

### 4.3 Serialization & CRDT compatibility

- Stored as a single Yjs `Y.Map` (per `wave-2-crdt-architecture.md` §2.2
  feature tree shape). `positions` becomes `Y.Array<Y.Map>` so individual
  hole positions are CRDT-mergeable: two users adding holes simultaneously
  produce a union, not a clobber.
- `sketchRef.pointFilter` is a `Y.Array<string>` so users can toggle
  individual sketch-points on/off without conflict.
- All numeric fields are leaf `Y.Map` keys (plain numbers). The schema
  version bump is **`schemaVersion: 7 → 8`**, with the migration from 7
  being: every legacy `hole` feature with `holeType ∈ {0,1,2}` is wrapped
  into a `kind ∈ {drilled, counterbore, countersink}` with
  `positions = [{ id, x: posX, z: posZ }]` and `terminationMode` inferred
  from `depth` (999 → throughAll, else blind).
- The `.nfab` file format (until cloud migration completes — see
  `wave-2-cloud-document-migration.md`) gets a new top-level field
  `features[i].holeMeta` populated from the Yjs map at save time.

### 4.4 Worker RPC payload shape

The wire format used by `/occt/op/hole/*` endpoints is a flat
projection of `HoleFeature` (no Yjs types). See §5.

---

## 5. Worker API

### 5.1 New endpoints

All endpoints accept POST with JSON body, return JSON with STEP (base64)
+ STL (binary URL, R2) + metadata.

| Endpoint | Body | Cuts per call |
|---|---|---|
| `POST /occt/op/hole/drilled` | `{ baseShapeHandle, kind: 'drilled', positions: [...], drillDiameter, terminationMode, blindDepth?, upToFaceRef?, drillTipAngle }` | N drilled |
| `POST /occt/op/hole/counterbore` | `{ ..., kind: 'counterbore', cboreDiameter, cboreDepth, drillDiameter, ... }` | N counterbored |
| `POST /occt/op/hole/countersink` | `{ ..., kind: 'countersink', csAngle, csDiameter, drillDiameter, ... }` | N countersunk |
| `POST /occt/op/hole/counterdrill` | `{ ..., cboreDiameter, cboreDepth, middleDiameter, middleDepth, drillDiameter, ... }` | N counterdrilled |
| `POST /occt/op/hole/tap` | `{ ..., kind: 'tap', drillDiameter, pitch, tapClass, tapDepth, drillTipAngle }` | N tapped (cosmetic — boolean cut at drill ⌀) |
| `POST /occt/op/hole/pipeTap` | `{ ..., kind: 'pipeTap', pipeStandard, pipeSizeKey, minorDiameter, engagementDepth }` | N pipe-tapped |

#### 5.1.1 Body schema (Drilled)

```jsonc
{
  "baseShapeHandle": "occt-shape-id-abc123",
  "positions": [
    { "id": "p1", "x": 10, "z": 20 },
    { "id": "p2", "x": 30, "z": 20 },
    { "id": "p3", "x": 10, "z": 40 },
    { "id": "p4", "x": 30, "z": 40 }
  ],
  "drillDiameter": 5.0,
  "terminationMode": "throughAll",   // or "blind"|"upToNext"|"upToFace"
  "blindDepth": null,                // required when terminationMode = "blind"
  "upToFaceRef": null,               // { faceId } when terminationMode = "upToFace"
  "drillTipAngle": 118,
  "faceProvenance": {                // existing system, opaque blob
    "featureId": "hole-3",
    "avoidIdsFrom": "occt-shape-id-abc123"
  }
}
```

#### 5.1.2 Response shape (Drilled / all hole endpoints)

```jsonc
{
  "ok": true,
  "shapeHandle": "occt-shape-id-def456",
  "step": "data:model/step;base64,...",     // optional, set when client asks
  "stlUrl": "https://r2.../occt-shape-id-def456.stl",
  "boundingBox": { "min": [...], "max": [...] },
  "holes": [
    {
      "id": "p1",
      "center": { "x": 10, "y": 25, "z": 20 },  // resolved from baseFace
      "actualDepth": 15.0,                      // resolved upToFace if needed
      "drillBottomY": 8.0,
      "warnings": []
    },
    /* ... 3 more ... */
  ],
  "diagnostics": {
    "wallClockMs": 142,
    "occtBopsMs": 88,
    "fusedShapes": 4
  }
}
```

### 5.2 Implementation outline (server-side OCCT, descriptive only)

For **drilled** with N positions, the worker:

1. Loads `baseShapeHandle` from the shape registry.
2. For each position:
   - Build a `gp_Ax2` along the face normal.
   - Build a `BRepPrimAPI_MakeCylinder(r, depth)` placed at that axis,
     translated so the top sits at the base face.
   - If `terminationMode = blind` and `drillTipAngle < 180`, attach a
     `BRepPrimAPI_MakeCone(r, 0, tipDepth)` at the bottom (apex down).
3. Fuse all N tools into one compound via `BRepAlgoAPI_Fuse`. This is
   the key optimization: **one Boolean operation against the host body**
   instead of N, which is 3-5× faster for typical patterns.
4. Subtract the compound from the host via `BRepAlgoAPI_Cut`.
5. Tag each resulting face with `featureId` via the existing face-provenance
   helper (see `faceProvenance.ts`).
6. Write back to registry, return shape handle + per-hole metadata.

For **counterbore / countersink / counterdrill / tap / pipe-tap**, the
worker constructs the multi-cylinder / cone / cone tool per position and
fuses, then does **one** cut. The fields with `null` / `undefined` mean
"use library default for the sizeKey" — but the **client must resolve
the sizeKey into numeric values before posting**. The worker is a
boolean engine, not a standards lookup service.

### 5.3 Backward compatibility

The existing single-cylinder endpoint
(`/occt/op/boolean/subtract` from boolean.ts) is preserved unchanged.
The new `/occt/op/hole/*` endpoints are additive. We can convert the
existing `features/hole.ts` apply method to dispatch to the new
endpoint with a one-position array (single transaction is fine; the
overhead is sub-1ms vs. the old multi-call path). This is **Phase 2
Week 4** cleanup.

### 5.4 Worker pool / capacity impact

`occt-worker` was sized in ADR-009 for ~1.5s p95 per boolean op.
Multi-position fuse → single cut is **expected to be faster** than N
sequential calls for N ≥ 3, but the fuse step has its own cost. We
will burn-in for `N ∈ {1, 4, 8, 16, 32}` with `M5` drilled patterns
during Week 1 and update the ADR-009 sizing if `N=32` p95 exceeds the
3.0s soft cap.

### 5.5 Cancellation

Each `/occt/op/hole/*` call takes a request-id; the existing
`/occt/op/cancel` endpoint marks the shape transaction as cancelled.
The worker checks the flag between **fuse step** and **cut step** so
a multi-position cancel does not waste the cut (longest op). No
mid-fuse cancellation in Phase 2 — that requires OCCT progress
callbacks (deferred).

---

## 6. UI design

### 6.1 Modal layout (HoleWizardModalV2)

The modal is **wider** (640px, was 520px) and tabbed at the top.
All copy below is the EN baseline; KR/JA/ZH/ES/AR strings follow in
§6.5.

```
╭──────────────────────────────────────────────────────────────────╮
│ 🕳️  Hole Wizard                                              [×] │
├──────────────────────────────────────────────────────────────────┤
│  [Type]    [Size]    [Position]    [Termination]    [Preview]    │ ← tabs
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  current tab content                                             │
│                                                                  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│            (4 holes will be added)         [Cancel]   [Add Holes]│
└──────────────────────────────────────────────────────────────────┘
```

Tab order matches the natural decision flow:
1. **Type** — pick drilled / cbore / csk / counterdrill / tap / pipe-tap
2. **Size** — pick standard series + size + fit class
3. **Position** — absolute coordinates *or* pick a sketch
4. **Termination** — blind depth / through / up-to-next / up-to-face
5. **Preview** — read-only summary + 2D mini cross-section

The tabs are not strictly required to be visited in order — the user
can jump. Each tab carries a small green/red indicator showing if its
required fields are filled (a "validation chip").

#### 6.1.1 Tab 1 — Type

Six tile buttons in a 3×2 grid, each with an icon + label + 1-line hint:

```
┌────────────┐  ┌────────────┐  ┌────────────┐
│ ⊙          │  │ ⊙ ▼        │  │ ⊙ V        │
│ Drilled    │  │ Counterbore│  │ Countersink│
│ Simple bore│  │ Socket-head│  │ Flat-head  │
└────────────┘  └────────────┘  └────────────┘
┌────────────┐  ┌────────────┐  ┌────────────┐
│ ⊙ ▼V       │  │ ⊙ ≡        │  │ ⊙ ⌇        │
│ Counterdrill│ │ Tap        │  │ Pipe Tap   │
│ 3-step bore│  │ ISO thread │  │ NPT / BSP  │
└────────────┘  └────────────┘  └────────────┘
```

#### 6.1.2 Tab 2 — Size

```
Standard series:  [ISO ▼]  [ISO Fine]  [UTS]  [NPT]  [BSP]  [Custom]

Size (ISO):
  ┌────┬────┬─────┬────┬────┬────┬────┬────┬────┬─────┐
  │M1.6│ M2 │M2.5 │ M3 │ M4 │ M5 │ M6 │ M8 │M10 │ M12 │
  ├────┼────┼─────┼────┼────┼────┼────┼────┼────┼─────┤
  │M14 │M16 │ M18 │M20 │M22 │M24 │M27 │M30 │... │     │
  └────┴────┴─────┴────┴────┴────┴────┴────┴────┴─────┘

Fit class (clearance kinds only):
  ( ) Close  (●) Normal  ( ) Loose
```

For NPT/BSP, the size grid becomes 5 columns × 2 rows of pipe sizes.

For Custom, the grid is replaced with raw numeric inputs (drill ⌀,
cbore ⌀, csk ⌀ etc. depending on kind).

#### 6.1.3 Tab 3 — Position

```
Position source:
  (●) Absolute coordinates
  ( ) From sketch

[when Absolute:]
  Hole positions (4):
  ┌─────────────────────────────────────────────────────────────┐
  │ # │   X (mm)   │   Z (mm)   │ Depth override │ [-] │
  │ 1 │    10.000  │    20.000  │   (inherit)    │ [-] │
  │ 2 │    30.000  │    20.000  │   (inherit)    │ [-] │
  │ 3 │    10.000  │    40.000  │   (inherit)    │ [-] │
  │ 4 │    30.000  │    40.000  │   (inherit)    │ [-] │
  └─────────────────────────────────────────────────────────────┘
  [+ Add row]   [Paste from clipboard (CSV)]   [Linear pattern...]

[when From sketch:]
  Source sketch:  [▼ Sketch 3 (4 points)]
  Pick points:   [○ All 4]  [○ Filter ...]
  ☑ Auto-update when sketch changes
```

The **Linear pattern** helper opens a sub-dialog: start X/Z, end X/Z,
count, → fills the position table.

#### 6.1.4 Tab 4 — Termination

```
Termination mode:
  ( ) Blind          ──→  Depth: [   15.0 ] mm  [1×D] [1.5×D] [2×D]
  (●) Through all
  ( ) Up to next face
  ( ) Up to face     ──→  [Pick face...] (none picked)

Drill tip angle:    [ 118 ▼ ]   (118 standard, 135 hard, 180 flat)
```

#### 6.1.5 Tab 5 — Preview

```
Resolved dimensions:
  Drill ⌀:           5.0 mm        (tap drill for M6)
  Counterbore ⌀:    11.0 mm × 6.5 mm
  Through all:      yes
  Drill tip:        118° (suppressed for through)
  Pitch:            1.0 mm (M6 coarse)
  Positions:        4

[2D cross-section preview, ~200×120 px]
   ┌─────────────────┐
   │       ▼         │   ← top face
   │      ┌─┐        │
   │      │ │        │   cbore 11 × 6.5
   │      └┬┘        │
   │       │         │
   │       │ Ø5      │
   │       │         │
   └───────┴─────────┘   ← bottom face

Warnings (DFM gate):
  ⚠ none
```

The cross-section is generated client-side from the resolved
parameters — it does **not** call the worker. This keeps the
modal responsive (< 50ms per redraw).

### 6.2 Validation chips

Each tab header shows a chip:
- gray (○) — defaults loaded, not visited
- green (●) — required fields valid
- red (●) — invalid (e.g. zero positions, drill ⌀ ≤ 0)
- yellow (●) — valid but DFM-warning attached

The **Add Holes** button is disabled while any tab is red.

### 6.3 Command palette integration

`commandPaletteCommands.ts` adds:
- `hole.wizard.v2.open` — opens the V2 modal at Type tab
- `hole.wizard.v2.addFromSketch` — opens at Position tab with sketch
  picker pre-selected
- Legacy `hole.wizard.open` continues to open V1 (behind the same
  flag wall — flag default = `v2` once Week 4 lands).

### 6.4 Sketch input flow (multi-hole)

The canonical workflow:

1. User creates a **sketch** on the top face. Adds N points (placed by
   click, by linear pattern, by circular pattern, or by import).
2. User runs **"Hole Wizard from sketch"** (palette or right-pane
   button on the sketch feature).
3. Modal opens with `positionMode = fromSketch` and `sketchRef` already
   filled in. The position table shows the live point list.
4. User picks kind / size / termination. Applies.
5. The new `HoleFeature` is added below the sketch in the feature tree
   with the sketch as its dependency.
6. **Subsequent edits:**
   - Editing a sketch point moves the hole.
   - Adding a sketch point adds a hole.
   - Deleting a sketch point removes a hole (with confirm).
   - Per-hole `suppressed` and `depthOverride` are stored on the
     `positions[i]` entry, **not** on the sketch. The mapping uses the
     stable point id from the sketch.

If a sketch point is deleted but the hole had a `depthOverride`, the
override is kept in `positions[]` as a tombstone with `suppressed=true`
for one undo cycle, then garbage-collected on next save.

### 6.5 i18n labels

Below is the new label set added in Phase 2. Existing keys
(`title`, `size`, `holeType`, `cancel`, `addHole`, etc.) from
`HoleWizardModal.tsx` are reused.

| key             | KR (ko)        | EN              | JA              | ZH (Hans)   | ES               | AR                  |
|-----------------|----------------|-----------------|------------------|-------------|------------------|----------------------|
| `wizardTitle`   | 구멍 마법사    | Hole Wizard     | ホールウィザード  | 孔向导      | Asistente de Hole | معالج الفتحات        |
| `tabType`       | 유형           | Type            | 種類            | 类型        | Tipo             | النوع                |
| `tabSize`       | 크기           | Size            | サイズ          | 尺寸        | Tamaño           | الحجم                |
| `tabPosition`   | 위치           | Position        | 位置            | 位置        | Posición         | الموضع               |
| `tabTermination`| 종료           | Termination     | 終端            | 终止        | Terminación      | الإنهاء              |
| `tabPreview`    | 미리보기       | Preview         | プレビュー      | 预览        | Vista previa     | معاينة               |
| `kindDrilled`   | 드릴           | Drilled         | ドリル          | 钻孔        | Taladrado        | مثقوب                |
| `kindCbore`     | 카운터보어     | Counterbore     | カウンターボア  | 沉头扩孔    | Avellanado plano | تجويف عميق           |
| `kindCsk`       | 카운터싱크     | Countersink     | カウンターシンク| 沉头孔      | Avellanado       | تجويف مخروطي         |
| `kindCdrill`    | 카운터드릴     | Counterdrill    | カウンタードリル | 沉头钻孔    | Contrataladrado  | تثقيب مركّب         |
| `kindTap`       | 탭(나사구멍)   | Tap             | タップ          | 攻丝        | Roscado          | حلزون داخلي          |
| `kindPipeTap`   | 파이프 탭      | Pipe Tap        | パイプタップ    | 管螺纹      | Roscado para tubo| حلزون أنبوب          |
| `termBlind`     | 막힘 (깊이)    | Blind           | 止まり          | 盲孔        | Ciego            | معتم                 |
| `termThrough`   | 관통           | Through all     | 貫通            | 通孔        | Pasante total    | نافذ كامل            |
| `termUpToNext`  | 다음 면까지    | Up to next      | 次の面まで      | 至下一面    | Hasta el próximo | حتى السطح التالي     |
| `termUpToFace`  | 면 지정        | Up to face      | 面を指定        | 至指定面    | Hasta cara       | حتى وجه محدد         |
| `fitClose`      | 정밀           | Close fit       | 精密            | 紧配合      | Ajuste cerrado   | تطابق دقيق           |
| `fitNormal`     | 보통           | Normal fit      | 普通            | 普通配合    | Ajuste normal    | تطابق عادي           |
| `fitLoose`      | 헐거움         | Loose fit       | ゆるい          | 松配合      | Ajuste flojo     | تطابق فضفاض          |
| `tapDepthLbl`   | 나사구멍 깊이  | Tap depth       | タップ深さ      | 攻丝深度    | Profundidad rosca| عمق الحلزون          |
| `drillTipAngle` | 드릴팁 각도    | Drill tip angle | ドリル先端角    | 钻头角度    | Ángulo de punta  | زاوية رأس المثقاب    |
| `addFromSketch` | 스케치에서 추가| Add from sketch | スケッチから追加| 从草图添加  | Añadir de croquis| إضافة من الرسم       |
| `nPositions`    | %{n}개 위치    | %{n} positions  | %{n} 位置       | %{n} 个位置 | %{n} posiciones  | %{n} مواضع           |

Korean specifics (per memory `project_nexyfab_3d_i18n.md` patterns):
the labels favor `구멍` (general "hole") for `Drilled`, `나사구멍` (threaded
hole) for `Tap`, and `파이프 탭` for `Pipe Tap`. We deliberately **do
not** use 해압 (loanword) and instead use the 한자 형식.

---

## 7. Sketch input — detailed flow

### 7.1 Sketch point referencing

A sketch (`SketchFeature` in `features/sketchTypes.ts`) carries
`points: SketchPoint[]` with stable `id`. The Hole Wizard references
these points by id, not by index — so re-ordering or insertion in the
sketch does not shift the hole assignment.

```ts
sketchRef: {
  featureId: 'sketch-7',
  pointFilter: undefined,   // = all points
  // or
  pointFilter: ['pt-a', 'pt-c', 'pt-f'],   // explicit subset
}
```

### 7.2 Resolution

At rebuild time, the feature solver:
1. Reads the sketch's solved point list (post-constraint-solver — so
   dimensions are applied).
2. Filters by `pointFilter` if present.
3. Projects each `(u, v)` sketch coordinate onto the world frame via
   the sketch's plane transform.
4. Emits `positions[i].x, positions[i].z` for each filtered point.
5. Reads `positions[i].depthOverride` / `suppressed` from the feature
   if the sketch point id matches.

Any sketch point with no matching `positions[]` entry uses defaults
(no override, not suppressed).

### 7.3 Edit-after-add semantics

| Sketch change             | Effect on HoleFeature                                            |
|---------------------------|------------------------------------------------------------------|
| Move point (drag)         | hole moves with it (positions recomputed at solve time)          |
| Add point                 | new hole appears (no override, no suppress)                      |
| Delete point              | hole disappears; per-hole override is tombstoned 1 cycle         |
| Re-order points           | no effect (ids stable)                                           |
| Change sketch plane       | all holes re-project onto new plane (warn user if normal flips)  |
| Suppress sketch feature   | all dependent holes suppressed (existing dependency-propagation) |

### 7.4 Bulk operations

The position-table UI (Tab 3) supports:
- **Linear pattern**: helper dialog fills the table
- **Rectangular pattern**: rows × cols, step X / step Z
- **Circular pattern**: center + radius + count
- **Paste from clipboard**: CSV `x, z` (one per line). Useful for
  importing drill schedules from Excel / CSV exports.

Bulk operations only apply to `positionMode = 'absolute'`. For
sketch-based, users edit the sketch directly with the same patterns.

---

## 8. Test fixture set

Five test parts. Each carries a known correct geometry that can be
checked by STEP+mass-properties comparison against a baseline.

### 8.1 F-HW-01 — Cover plate, M3 × 4

- Host: 100 × 60 × 5 plate
- 4 × M3 through-all (clearance, normal fit) at corners (10, 10), (90, 10),
  (10, 50), (90, 50)
- Expected: 4 cylinders Ø 3.4, mass = (10000−4×π×1.7²) × 5 × 7850e-9 kg

Pass criteria: mass within ±0.5%, face count = 6 (top) + 6 (bottom) +
4 (side) + 4 (hole walls) = 20, all four holes' centerlines parallel
to ±0.001°.

### 8.2 F-HW-02 — Mounting block, M8 counterbore × 1

- Host: 50 × 50 × 25 block
- 1 × M8 counterbore, clearance normal (Ø 9), cbore Ø 15 × 8.6 deep,
  positioned (25, 25) on top face
- Expected: top face has counterbore ring + small clearance hole

Pass criteria: cbore floor at Y = top − 8.6 ± 0.05; hole bottom = bottom
face (through-all); face-provenance map carries the same featureId for
all 4 new faces (cbore wall, cbore floor, drill wall, no exit ring).

### 8.3 F-HW-03 — Housing, M5 tap × 8

- Host: 120 × 80 × 30 housing
- 8 × M5 tap (blind 12 mm, 6H class, pitch 0.8) in 2 × 4 pattern from
  a sketch with 8 points
- Expected: 8 blind holes Ø 4.2 × 12 deep with 118° apex at bottom

Pass criteria:
- All 8 hole bottoms at Y = top − 12 ± 0.05 (measured to start of apex)
- Apex Y = top − 12 − (4.2/2)/tan(59°) = top − 12 − 1.26
- DFM gate emits no `TAP_BOTTOM_RISK` (tapDepth=10, drillDepth=12, pitch=0.8 →
  10 ≤ 12 − 2×0.8 = 10.4, just inside)
- Sketch dependency edge present (deleting the sketch warns and
  cascades)

### 8.4 F-HW-04 — Deep through-drill, Ø 5 × 100

- Host: 50 × 50 × 100 prism
- 1 × Ø 5 through-all centered
- Expected: single straight cylinder through the long axis

Pass criteria: hole length = 100 ± 0.001; cylindrical wall is one face
(not split); face-provenance featureId stamped on the wall.

Stress goal: 100 mm / 5 mm = aspect 20:1; meshing must produce
≥ 64 segments along the length to render smoothly.

### 8.5 F-HW-05 — Pipe-tap port, 1/4 NPT × 1

- Host: 60 × 60 × 40 block with 5 mm fillet on top edge
- 1 × 1/4 NPT pipe tap (Ø 11.4 minor, 9.7 mm engagement) centered top
- Expected: cylindrical cut Ø 11.4 × 9.7 + cosmetic taper rendering

Pass criteria:
- Boolean cut is a plain cylinder (taper is render-only at this phase)
- Feature carries `pipeStandard='NPT'`, `pipeSizeKey='1/4-18'`
- Drawing callout (Phase 3 hook) reads `"1/4 NPT × 9.7 deep"` from
  `holeMeta` directly

### 8.6 Aggregate burn-in fixture

`F-HW-AGG-01`: one part combining all of F-HW-01 through F-HW-05 (5
HoleFeatures stacked). Rebuild time target: **< 3.0s** on Tier-0
worker. This is the Phase 2 GA gate.

---

## 9. Phase 2 timeline (4 weeks)

### Week 1 — Library + Drilled (single + multi)

Goal: extend the library, ship the new worker endpoint for drilled
type, and have the V2 modal usable for `kind=drilled` with absolute
positions only.

Deliverables:
- `holeStandards.ts`: add M1.6, M2, M2.5, M14, M18, M22, M24, M27, M30,
  ISO_FINE, ANSI new rows, PIPE_NPT, PIPE_BSP, fit-class fields
- `features/holeArray.ts` (new): multi-position drilled feature using
  fused-tool boolean
- Worker endpoint `/occt/op/hole/drilled` (multi-position fuse + cut)
- `HoleWizardModalV2.tsx` skeleton with Type + Size + Position tabs
  (Termination = through-all locked; Preview = static)
- Burn-in for N ∈ {1, 4, 8, 16, 32} drilled patterns; update ADR-009
  capacity numbers if needed

Gate: F-HW-01 (M3 × 4) passes via the new path.

### Week 2 — Counterbore + Countersink

Goal: add the two pocket types. Round out the modal Termination tab.

Deliverables:
- Worker endpoints `/occt/op/hole/counterbore`, `/occt/op/hole/countersink`
- Termination tab: blind / through / up-to-next / up-to-face all wired
- Up-to-face uses the existing FaceRef + face-provenance system
- Cross-section preview (Tab 5) rendering for cbore / csk / cdrill

Gate: F-HW-02 (M8 cbore) and a new F-HW-02b (M6 csk) pass.

### Week 3 — Counterdrill + Tap + Sketch input

Goal: add the two compound types and the sketch-driven position mode.

Deliverables:
- Worker endpoint `/occt/op/hole/counterdrill` (3-step compound)
- Worker endpoint `/occt/op/hole/tap` (cosmetic drill + thread metadata)
- `positionMode = 'fromSketch'` path through the rebuild solver
- Sketch ↔ Hole bidirectional propagation (move / add / delete)
- DFM gate `TAP_BOTTOM_RISK` rule
- Subsequent-edit override semantics (`positions[].depthOverride`,
  `suppressed`)

Gate: F-HW-03 (M5 tap × 8 from sketch) passes; F-HW-04 (deep through)
passes.

### Week 4 — Pipe-tap + i18n + UI polish + Phase 3 hand-off

Goal: complete pipe-tap, finalize all six languages, polish the modal,
prepare data hooks for Phase 3 drawing work.

Deliverables:
- Worker endpoint `/occt/op/hole/pipeTap`
- All six languages in HoleWizardModalV2 (KR / EN / JA / ZH / ES / AR)
  with the strings from §6.5
- Linear / rectangular / circular pattern helpers in Position tab
- CSV paste in Position tab
- `holeMeta` field exposed on `HoleFeature` for Phase 3 callouts +
  hole-table
- Schema migration v7 → v8 (legacy `hole` → new `holeArray` shape)
- Flag flip: `hole_wizard_v2 = on` by default; legacy modal still
  reachable via palette `hole.wizard.v1.open` for fallback
- F-HW-AGG-01 burn-in passes the 3.0s GA gate

Stretch (if time):
- 2D cross-section preview animation (rotate around vertical axis)
- "Smart fastener" suggestion in Tab 5 (existing
  `SmartFastenerPanel.tsx` integration)

---

## 10. Drawing-side hand-off (Phase 3 prep)

Phase 3 (drawing module) reads from each `HoleFeature` the following
fields directly. These must be stable and well-defined in Phase 2 even
though the drawing consumer ships later.

### 10.1 `holeMeta` projection

A computed view of the feature, surfaced as a feature method:

```ts
interface HoleMeta {
  kind: HoleKind;
  standard: string;            // 'ISO', 'UTS', 'NPT', etc. for display
  sizeKey: string;             // 'M8', '1/4-20', '1/4-18'
  fitClass?: string;
  drillDiameter: number;
  drillDepth: number;          // resolved (through-all → host extent)
  cboreDiameter?: number;
  cboreDepth?: number;
  csAngle?: number;
  csDiameter?: number;
  middleDiameter?: number;
  middleDepth?: number;
  pitch?: number;
  tapClass?: string;
  tapDepth?: number;
  pipeStandard?: string;
  pipeSizeKey?: string;
  engagementDepth?: number;
  positions: Array<{ id: string; x: number; y: number; z: number }>;
  callout: string;             // pre-rendered, lang-neutral
}
```

### 10.2 Callout grammar

The `callout` field is a single-line string in canonical form. Examples:

| HoleFeature                                          | Callout                          |
|------------------------------------------------------|----------------------------------|
| M3 × 4 through                                       | `4 × Ø3.4 THRU`                  |
| M8 × 1 counterbore                                   | `Ø9 THRU, Ø15 ⌴ 8.6`             |
| M6 × 4 tap, blind                                    | `4 × M6×1 ▼ 12, TAP ▼ 10`        |
| M5 × 8 tap from sketch                               | `8 × M5×0.8 ▼ 12, TAP ▼ 10`      |
| 1/4-20 csk @ 82°                                     | `1/4-20 UNC, ⌵ 82°`              |
| 1/4 NPT pipe                                         | `1/4 NPT ▼ 9.7`                  |
| Counterdrill M8 / M5 shoulder                        | `Ø15 ⌴ 5, Ø8.4 ⌴ 8, Ø5.5 THRU`   |

The glyph map:
- `Ø` — diameter
- `⌴` — counterbore depth
- `⌵` — countersink angle/depth
- `▼` — depth-of-feature
- `THRU` — through-all
- `×` — count multiplier

Phase 3 renders this string in the drawing module; it can be
internationalized per-cell ("THRU" → "관통" for Korean drawings) at
that layer, not in the feature.

### 10.3 Hole table

Phase 3's drawing module reads the `positions[]` array directly to
generate a tagged hole table (A1, A2, B1, B2 labels on the drawing +
a tabular schedule). Phase 2 only guarantees:

- `positions[].id` is stable (across edits, saves, reloads)
- `positions[].x/y/z` are resolved in **world** coordinates (not
  sketch-local)
- The order in the array matches creation order (with re-orders
  preserved through edits)

### 10.4 GD&T position tolerance

Phase 2 carries one additional field on the feature:

```ts
positionTolerance?: {
  diameter: number;            // tolerance zone Ø, e.g. 0.2 mm
  datums: [string, string?, string?]; // datum letters in order
  modifier?: 'M' | 'L' | 'S';  // material condition
};
```

This is **not exposed in the V2 modal in Phase 2** — it is added by
the Phase 3 GD&T panel (`annotations/positionTolerance.ts` already
exists). The field is reserved here so that the feature schema does
not need another bump in Phase 3.

---

## 11. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Multi-position fuse + cut slower than N sequential cuts for some N | M | Burn-in Week 1, fall back to per-position cut if fuse-cut p95 > 1.4× sequential p95 |
| Sketch-point id instability after constraint solver rerun | H | Use sketch-feature point id (already stable) — never the post-solver array index |
| `upToFace` against a freeform face produces no clean cut | M | Validate the picked face has a planar / cylindrical type before submit; warn otherwise |
| Schema migration v7 → v8 corrupts pre-Phase-2 files | H | Round-trip test on every fixture file in `__tests__/migrations/` + offer "revert" within 30 days |
| Library values drift from official KS B 0201 over time | L | Cite source standard in code comment per row; quarterly audit |
| CRDT merge of two users editing same `positions[]` produces duplicates | M | `positions[].id` is generated client-side as UUID + stamped at append; merge dedupe on id |
| 6-language i18n strings drift from EN baseline | L | Add the `wizardTitle`, `tabType`, etc. keys to the existing i18n drift detector script (`fix_storytelling.py` or successor) |
| Pipe-tap cosmetic taper is misinterpreted as the actual thread | M | DFM gate emits `PIPE_TAP_COSMETIC` warning + drawing callout includes "(cosmetic)" in 3D viewer hover tip |

---

## 12. Open questions (defer to Phase 2 kickoff)

1. **Tap helix render** — should Phase 2 ship a faint helix decal on
   tapped holes (texture-mapped, not geometry), or save that for
   Phase 4? Recommendation: skip in Phase 2 (visual noise, no
   manufacturing benefit; the callout carries the info).

2. **Counterbore depth from top vs. from sketch face** — for holes
   on a non-top face, is `cboreDepth` measured from the sketch face
   inward, or from the top face? Default: from the **sketch face**
   (the face the feature is "drilled into"). Add `cboreFromBottom`
   field for the rare flip case.

3. **Hole array vs. per-feature** — should one `HoleFeature` carry
   only one `kind`, or can a feature mix kinds (some drilled, some
   tapped)? Decision: **one kind per feature**. Mixed kinds force
   the user into multiple features, which is the right outcome for
   the drawing-callout grouping.

4. **Imperial display unit toggle** — when a user picks a UTS size,
   do the dimensions in the preview tab display as imperial
   (3/8 in × 1 in deep) or stay metric (9.525 mm × 25.4 mm)?
   Default: **metric in preview, imperial in callout**. The
   user-level units toggle (in `uiStore`) flips both if set to
   imperial.

5. **Counterdrill library** — should we ship a built-in counterdrill
   library or only `'custom'` for Phase 2? Recommendation: ship 6
   common shoulder-bolt mappings (M5, M6, M8, M10, M12, M16 from
   ISO 7379) and document the manual route for the rest.

6. **DFM gate strictness** — what is the cut-off for a hole-near-edge
   warning? Industry default: edge distance ≥ 1.5 × diameter. We
   currently have **no edge-distance check**. Recommendation: add
   the warning rule in Week 4 cleanup if time allows; otherwise
   carry to Phase 3.

---

## 13. Acceptance criteria

Phase 2 is **GA** when:

- All five test fixtures (F-HW-01..F-HW-05) pass on Tier-0 worker
- The aggregate fixture F-HW-AGG-01 rebuilds in < 3.0s p95
- All six languages render the modal without overflow on a 1280×720
  viewport
- Schema migration v7 → v8 is round-trip-safe for the 12 fixture
  `.nfab` files in `__tests__/migrations/wave2-hole-wizard/`
- The DFM gate emits no false positives on the burn-in suite
- The legacy V1 modal still works (palette `hole.wizard.v1.open`)
- `holeMeta` projection produces a stable callout string for each
  fixture (snapshot test in `__tests__/holeMeta.callout.test.ts`)
- ADR-009 occt-worker pool sizing updated if Week 1 burn-in showed
  capacity drift

**Out:** Phase 3 drawing rendering of the callout is **not** a Phase
2 acceptance gate. The data is exposed; the rendering ships separately.

---

## Appendix A — Source citations

| Library row source | Standard |
|---|---|
| ISO metric tap-drill, clearance, fit class | ISO 273 (clearance), ISO 261 (thread), KS B 0201 |
| ISO metric counterbore / countersink geometry for socket-head | ISO 4762 (cap), ISO 10642 (CSK) |
| ISO fine-pitch sizes | KS B 0205 |
| UTS tap-drill, clearance | ANSI / ASME B1.1, ASME B18.2.8 |
| UTS counterbore / countersink for socket-head | ASME B18.3 |
| NPT pipe-thread minor diameter | ASME B1.20.1 |
| BSP G-thread parallel | ISO 228-1 |
| Drill-tip angle convention | DIN 1414 / Machinery's Handbook 29e §22 |

## Appendix B — File touch list (for Phase 2 implementer reference, NOT a license to edit here)

```
NEW:
  src/app/[lang]/shape-generator/features/holeArray.ts
  src/app/[lang]/shape-generator/features/HoleWizardModalV2.tsx
  src/app/[lang]/shape-generator/features/holeCallout.ts
  src/app/[lang]/shape-generator/features/holeMeta.ts
  src/app/[lang]/shape-generator/features/__tests__/holeMeta.callout.test.ts
  src/app/[lang]/shape-generator/features/__tests__/holeArray.fixture.test.ts
  src/app/[lang]/shape-generator/__tests__/migrations/wave2-hole-wizard/*.nfab
  docs/wave-2-phase-2-hole-wizard-spec.md   (this file)

EXTEND:
  src/app/[lang]/shape-generator/features/holeStandards.ts
    + ISO rows M1.6/M2/M2.5/M14/M18/M22/M24/M27/M30
    + ISO_FINE export
    + ANSI new rows (#0/#2/#3/#5, 7/16, 5/8, 3/4)
    + PIPE_NPT, PIPE_BSP exports
    + fitClass field on HoleStandardSpec
  src/app/[lang]/shape-generator/store/uiStore.ts
    + flag hole_wizard_v2
  src/app/[lang]/shape-generator/commandPaletteCommands.ts
    + hole.wizard.v2.open / addFromSketch
  src/app/[lang]/shape-generator/CommandToolbar.tsx
    + V2 button visible behind flag
  src/app/[lang]/shape-generator/io/nfabFormat.ts
    + v7 → v8 migration
  src/app/[lang]/shape-generator/features/featureParamSchema.ts
    + HoleFeature validation rules
  src/app/[lang]/shape-generator/assembly/SmartFastenerPanel.tsx
    + consume sizeKey instead of inferring from diameter
  src/app/[lang]/shape-generator/annotations/ThreadHoleCalloutPanel.tsx
    + read holeMeta.callout directly
  src/lib/ai/scad-agent/dfmGate.ts
    + TAP_BOTTOM_RISK rule
    + (optional) HOLE_NEAR_EDGE rule

RENAME (back-compat):
  src/app/[lang]/shape-generator/features/HoleWizardModal.tsx
    → HoleWizardModalLegacy.tsx (kept; reachable via palette V1 cmd)
```

— end of spec —
