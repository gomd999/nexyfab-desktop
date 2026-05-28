# Wave 2 — Phase 2: Threads (나사산) Feature Spec

**Status:** design / spec-only — NO implementation in this doc
**Date:** 2026-05-28
**Author:** wave-2 phase-2
**Risk tier:** P1 (correctness-critical for manufacturing)
**Phase:** Wave 2 Phase 2 — weeks 5-8
**Related:**
- ADR-010 (Wave 2 B-Full + collab)
- `docs/wave-2-crdt-architecture.md` (CRDT state shape for FeatureNode)
- `docs/wave-2-cad-advisor-jd.md`
- `src/app/[lang]/shape-generator/sketch3d/helix.ts` (existing helix sampler)
- `src/app/[lang]/shape-generator/features/sweep.ts` (existing sweep op + `occtSweepHelix`)
- `src/app/[lang]/shape-generator/annotations/GDTTypes.ts` (existing `ThreadCallout`,
  `HoleCallout`, `METRIC_COARSE_PITCHES`, `formatThreadCallout`)
- `src/app/[lang]/shape-generator/annotations/ThreadHoleCalloutPanel.tsx` (existing UI,
  callout-only — no real geometry today)
- `src/app/[lang]/shape-generator/panels/ThreadHoleCalloutDock.tsx`

---

## 0. TL;DR

Threads (나사산) are the single most-requested CAD primitive that NexyFab does
**not** yet generate as a first-class feature node. We already have:

- A **helix sampler** (`sketch3d/helix.ts`) returning 3D polyline points.
- A **sweep operation** with `pathType === 2` (helix) wired into `occtSweepHelix`.
- A **callout / annotation system** (`ThreadCallout` interface, `formatThreadCallout`,
  `METRIC_COARSE_PITCHES` table for M2-M100) that is **annotation only** — no
  geometry, no parent-hole link, not part of the feature tree.

What's missing is a feature-tree object that:

1. is owned by a **parent hole / cylinder feature** (so it moves and rebuilds when
   that hole does, and so the BOM knows the hole is threaded),
2. has a **dual mode** — cheap **cosmetic** (metadata + magenta dashed circle in
   the viewport) versus expensive **geometric** (real helical V-cut),
3. is backed by a **complete designation table** (ISO M coarse + fine, UTS UNC/UNF,
   pipe NPT/BSP) with **KS B 0201**-correct numerics including tap-drill diameters,
4. is **emitted to drawing callouts** automatically (Phase 3 prep),
5. fits the **CRDT FeatureNode** shape from the Wave 2 architecture spec.

This document is **design only**. No source files are modified by this plan.
Implementation lands across the 4-week Phase 2 schedule in §15.

### Out of scope for this doc

- Tapping / cutting **process planning** beyond what the BOM line needs (no CAM).
- **Thread inspection** GD&T callouts (those go through the existing FCF
  pipeline in `GDTTypes.ts`).
- **Pipe fitting libraries** beyond NPT/BSP thread profiles — full hydraulic
  fittings live in `standardParts/hydraulicFittings.ts` already.
- **Fastener bodies** (M-screws, bolts, nuts) — those are catalog parts in
  `standardParts/toolboxCatalog.ts`; a fastener instance can reference a
  ThreadFeature on a host hole but the screw itself is not a ThreadFeature.

### What this doc decides

1. The **`ThreadFeature` data model** + how it lives in the FeatureTree / Y.Doc.
2. The **catalog tables** (ISO M coarse, ISO M fine, UTS UNC, UTS UNF, NPT, BSP)
   with KS B 0201-correct numerics.
3. The **geometry algorithm** for the geometric mode (helix path + 60° V profile
   + sweep + boolean cut), with a triangle / runtime budget.
4. The **worker API** (two `/occt/op/thread/*` endpoints) and how it composes
   with the existing sweep + boolean ops.
5. The **hole-wizard UI integration** (the cosmetic-by-default rule).
6. The **drawing-callout pipeline** that lets Phase 3 emit `M8×1.25 - 6H ↧ 20`
   strings without rebuilding the upstream feature.
7. A **fixture set** that the Phase 2 PR must regress against.

---

## 1. Current state of code

Survey snapshot (2026-05-28):

| Thing                                         | Where                                                            | Notes |
|-----------------------------------------------|------------------------------------------------------------------|-------|
| Helix sampler (CCW/CW, tapered, planar)       | `src/app/[lang]/shape-generator/sketch3d/helix.ts`               | Pure TS, no OCCT. Returns `HelixSample[]`. Adequate path source for geometric thread. |
| Sweep op (linear / arc / helix path types)    | `src/app/[lang]/shape-generator/features/sweep.ts`               | `pathType === 2` is helix; calls `occtSweepHelix` when OCCT is ready. Currently uses **rectangular** cross-section from input bbox — must be parameterized to take an arbitrary 2D profile (e.g. ISO 60° V). |
| OCCT engine bridge                            | `src/app/[lang]/shape-generator/features/occtEngine.ts`          | `occtSweepProfile`, `occtSweepHelix` already exist. |
| `ThreadCallout` interface (annotation-only)   | `src/app/[lang]/shape-generator/annotations/GDTTypes.ts:247-258`  | Already has `standard`, `type` (external/internal), `nominalDiameter`, `pitch`, `depth`, `fit`. **Has no `parentHoleId`**, no `mode`, no `direction`. Lives in the annotations array, not the feature tree. |
| `METRIC_COARSE_PITCHES` table                 | `src/app/[lang]/shape-generator/annotations/GDTTypes.ts:278-283`  | M2 → M100. **Has no tap-drill (minor) diameters**, no fine-pitch table, no Imperial / NPT / BSP. |
| `formatThreadCallout`                         | `src/app/[lang]/shape-generator/annotations/GDTTypes.ts:286-302`  | Emits `M8×1.25-6H` form. Good — reusable for drawing pipeline. |
| `ThreadHoleCalloutPanel.tsx`                  | `src/app/[lang]/shape-generator/annotations/`                    | UI for adding **annotation** thread/hole callouts. Does **not** wire to a hole feature. Multilingual (en/ko/ja/zh/es/ar). |
| `ThreadHoleCalloutDock.tsx`                   | `src/app/[lang]/shape-generator/panels/`                          | Slide-in dock for the panel above. |
| Standard fasteners                            | `standardParts/toolboxCatalog.ts`, `smartFasteners.ts`, `isoCatalogFull.ts` | Body geometry of M-screws, hex nuts, etc. They reference designations like `M8` but don't tell a host hole "you are threaded". |
| Spring                                        | `shape-generator/shapes/spring.ts`                                | Also uses helix sampler — proves the sweep-along-helix path works on the client. |

**Implication.** A new `ThreadFeature` does not start from scratch:

- Geometric mode = `occtSweepHelix` with a **non-rectangular profile** (new) + boolean
  subtract from the host cylinder (existing).
- Cosmetic mode = existing `ThreadCallout`-style metadata, **promoted** from a flat
  annotation array into a feature-tree child of the host hole.
- The drawing callout string formatter is already there (`formatThreadCallout`).

The structural change is the **parent-hole link** + lifting the callout
out of "annotations" into "features".

---

## 2. Thread modes — cosmetic vs geometric vs pipe-taper

Three modes, distinguishable by `mode` on the feature. The default for the hole
wizard is always **cosmetic**. Geometric is opt-in.

### 2.1 Cosmetic (default)

- **Geometry change:** zero. The host hole stays a plain cylinder.
- **Metadata:** thread designation, depth, direction, class.
- **Viewport hint:** a magenta (or theme-token equivalent) dashed circle drawn
  at the host hole's mouth on the rim at `majorDiameter / 2`. Optional second
  arc at `minorDiameter / 2` on internal threads.
- **Drawing output:** full ISO callout (`M8×1.25 - 6H ↧ 20`) at the hole's
  position.
- **BOM output:** marks the host hole as threaded, sums by designation.
- **Cost:** O(1) bytes, < 1 ms / hole even at N=1000.
- **When to use:** ~95% of real production CAD. Manufacturing reads the
  callout, not the geometry. This is what SolidWorks, Onshape, and Fusion 360
  default to.

### 2.2 Geometric

- **Geometry change:** real helical V-cut subtracted from (internal) or added
  to (external) the host cylinder.
- **Cost:** ~1500 triangles per turn × N turns (see §8). M8 × 20 mm
  ≈ 16 turns × 1500 ≈ 24 k triangles per thread.
- **When to use:**
  - Marketing renders / hero shots,
  - Section views for documentation where the thread profile actually matters,
  - Animation of mating threads,
  - Photogrammetry / 3D-print STL where the helical groove must exist as
    geometry.
- **Not for:** working CAD sessions with > ~5 threaded holes (perf cliff).

### 2.3 Pipe taper (NPT / BSPT)

- A geometric sub-mode where the helix **radius varies linearly along axis**
  to give the standard taper (**1°47′24″** half-angle, i.e. 1.7858°, **0.0625
  in/in**) of NPT, and **1°47′24″** for BSPT.
- BSPP (G-thread, parallel pipe) reuses the cylindrical geometric mode with
  the BSP profile (Whitworth 55° V, not 60°).
- **Tap-drill** for pipe threads is **not** "major − pitch"; it's a specific
  pipe-tap-chart value (see §6).

---

## 3. Data model

### 3.1 `ThreadFeature` type

```ts
// src/app/[lang]/shape-generator/features/threadFeature.ts  (new)

export type ThreadStandardCode =
  | 'isoM'         // ISO M metric coarse (KS B 0201)
  | 'isoMF'        // ISO M metric fine
  | 'utsUNC'       // Unified Thread Standard, Coarse (ASME B1.1)
  | 'utsUNF'       // Unified Thread Standard, Fine
  | 'pipeNPT'      // American National Pipe Tapered (ANSI/ASME B1.20.1)
  | 'pipeNPS'      // American National Pipe Straight (rare in NexyFab — included for parity)
  | 'pipeBSPP'     // British Standard Pipe Parallel (G-thread, ISO 228)
  | 'pipeBSPT';    // British Standard Pipe Tapered (Rc / R thread, ISO 7)

export type ThreadMode = 'cosmetic' | 'geometric';

export type ThreadDirection = 'right' | 'left';   // RH = CW-tightens (default)

export type ThreadKind = 'internal' | 'external';

export interface FaceRef {
  /** Stable face identifier emitted by the OCCT meshing pipeline. */
  faceId: string;
  /** Owning feature in the tree. */
  featureId: string;
}

export interface ThreadFeature {
  /** Stable feature-tree id. Generated like every other FeatureNode. */
  id: string;
  kind: 'thread';

  /** Parent: a hole, cylinder, or generic cylindrical face. Required. */
  parent: { featureId: string; faceRef?: FaceRef };

  mode: ThreadMode;
  threadKind: ThreadKind;    // internal (hole) | external (boss)
  standard: ThreadStandardCode;

  /** e.g. "M8x1.25", "M10x1.5", "1/4-20 UNC", "1/4 NPT". Always present;
   *  acts as the lookup key into the catalogs in §4-6. */
  designation: string;

  direction: ThreadDirection;  // default 'right'

  /** Where the thread starts along the host cylinder. */
  start: 'top' | 'bottom' | { faceRef: FaceRef };

  /** Thread length in mm. 'fullDepth' means "to the bottom of a blind
   *  hole" or "to the far end of a thru hole minus chamfer". */
  length: number | 'fullDepth';

  /** Optional tolerance class (defaults per standard — see §3.3). */
  toleranceClass?: ThreadToleranceClass;

  /** Optional chamfer at the entry. Default depends on standard. */
  entryChamfer?: { angle: number; depth: number };  // degrees, mm

  /** Cached, derived numerics. Recomputed on rebuild from `designation`
   *  via the catalog tables. Stored so renderers/exporters don't re-lookup. */
  derived: {
    majorDiameterMm: number;     // D
    minorDiameterMm: number;     // d1 (internal tap drill ≈ this)
    pitchMm: number;             // P  (or 25.4/TPI for inch)
    threadsPerInch?: number;     // for inch / pipe
    tapDrillMm: number;          // recommended drill for internal threads
    taperHalfAngleDeg?: number;  // NPT/BSPT only
  };
}

export type ThreadToleranceClass =
  // ISO M (internal then external)
  | '6H' | '7H' | '5H' | '4H'        // internal
  | '6g' | '6e' | '6f' | '4h' | '5g6g'  // external
  // UTS
  | '2B' | '3B' | '1B'               // internal
  | '2A' | '3A' | '1A';              // external
```

### 3.2 Position in the feature tree

```
RootFolder
├─ Part (the body being cut)
│   └─ Hole (Ø6.8 thru, host)            ← FeatureNode A
│       └─ ThreadFeature (M8×1.25 - 6H)  ← FeatureNode B, parent.featureId = A
```

- `ThreadFeature` is **always a child** of its host — the hole/boss feature.
- Rebuild order: the parent rebuilds first, then the thread feature reads the
  parent's resulting face and stamps metadata / cuts geometry.
- If the parent is deleted, the thread feature is deleted in cascade.
- If the parent's diameter changes such that the chosen `designation`'s
  `tapDrillMm` no longer matches, the thread feature emits a **rebuild
  warning** (see §11.3) but does **not** silently change designation.

### 3.3 Default tolerance classes (per standard)

| Standard | Internal default | External default | Source |
|---|---|---|---|
| isoM, isoMF | `6H` | `6g` | ISO 965, KS B 0211 |
| utsUNC, utsUNF | `2B` | `2A` | ASME B1.1 |
| pipeNPT, pipeBSPT | — (taper class only) | — | tightness comes from taper |
| pipeBSPP | `B` (medium) | `A` (medium) | ISO 228 |

### 3.4 CRDT shape (links to Wave 2 CRDT architecture)

In `wave-2-crdt-architecture.md` the Y.Doc has a `featureTree` Y.Map keyed by
feature id. `ThreadFeature` is a regular leaf in that map — no special
treatment needed. The `derived` block is **recomputed on rebuild and not
authoritative in the CRDT**; we still store it so that a fresh viewer that
hasn't run the rebuild yet can render the cosmetic hint without a round-trip.

Convergence: two users editing the same thread (rename, change length, swap
designation) is a Y.Map-on-leaf merge — LWW per field is acceptable for this
feature because edits are coarse-grained (typically a single panel commit).

---

## 4. ISO M (metric coarse) — KS B 0201 table

This is the table that backs the catalog. **All values mm.** `D` = nominal /
major diameter (external thread); `D1` ≈ tap drill (internal); `d` = root /
minor (external).

Source: KS B 0201 (= ISO 261 / ISO 262 / ISO 724). `D1` is computed as
`D - 1.0825 × P` (ISO basic minor for internal thread) and rounded to a
standard drill size.

| Designation | Major D (mm) | Pitch P (mm) | Minor D1 (mm) | Tap drill (mm) | TPI equiv |
|---|---|---|---|---|---|
| M2 × 0.4   |  2.000 | 0.40 |  1.567 |  1.6 | 63.5 |
| M2.5 × 0.45|  2.500 | 0.45 |  2.013 |  2.05 | 56.4 |
| M3 × 0.5   |  3.000 | 0.50 |  2.459 |  2.5 | 50.8 |
| M4 × 0.7   |  4.000 | 0.70 |  3.242 |  3.3 | 36.3 |
| M5 × 0.8   |  5.000 | 0.80 |  4.134 |  4.2 | 31.8 |
| M6 × 1.0   |  6.000 | 1.00 |  4.917 |  5.0 | 25.4 |
| M7 × 1.0   |  7.000 | 1.00 |  5.917 |  6.0 | 25.4 |
| M8 × 1.25  |  8.000 | 1.25 |  6.647 |  6.8 | 20.3 |
| M10 × 1.5  | 10.000 | 1.50 |  8.376 |  8.5 | 16.9 |
| M12 × 1.75 | 12.000 | 1.75 | 10.106 | 10.2 | 14.5 |
| M14 × 2.0  | 14.000 | 2.00 | 11.835 | 12.0 | 12.7 |
| M16 × 2.0  | 16.000 | 2.00 | 13.835 | 14.0 | 12.7 |
| M18 × 2.5  | 18.000 | 2.50 | 15.294 | 15.5 | 10.2 |
| M20 × 2.5  | 20.000 | 2.50 | 17.294 | 17.5 | 10.2 |
| M22 × 2.5  | 22.000 | 2.50 | 19.294 | 19.5 | 10.2 |
| M24 × 3.0  | 24.000 | 3.00 | 20.752 | 21.0 |  8.5 |
| M27 × 3.0  | 27.000 | 3.00 | 23.752 | 24.0 |  8.5 |
| M30 × 3.5  | 30.000 | 3.50 | 26.211 | 26.5 |  7.3 |
| M33 × 3.5  | 33.000 | 3.50 | 29.211 | 29.5 |  7.3 |
| M36 × 4.0  | 36.000 | 4.00 | 31.670 | 32.0 |  6.4 |
| M39 × 4.0  | 39.000 | 4.00 | 34.670 | 35.0 |  6.4 |
| M42 × 4.5  | 42.000 | 4.50 | 37.129 | 37.5 |  5.6 |
| M45 × 4.5  | 45.000 | 4.50 | 40.129 | 40.5 |  5.6 |
| M48 × 5.0  | 48.000 | 5.00 | 42.588 | 43.0 |  5.1 |
| M52 × 5.0  | 52.000 | 5.00 | 46.588 | 47.0 |  5.1 |
| M56 × 5.5  | 56.000 | 5.50 | 50.046 | 50.5 |  4.6 |
| M60 × 5.5  | 60.000 | 5.50 | 54.046 | 54.5 |  4.6 |
| M64 × 6.0  | 64.000 | 6.00 | 57.505 | 58.0 |  4.2 |
| M72 × 6.0  | 72.000 | 6.00 | 65.505 | 66.0 |  4.2 |
| M80 × 6.0  | 80.000 | 6.00 | 73.505 | 74.0 |  4.2 |
| M90 × 6.0  | 90.000 | 6.00 | 83.505 | 84.0 |  4.2 |
| M100 × 6.0 | 100.000| 6.00 | 93.505 | 94.0 |  4.2 |

Notes:
- `D1` in the table = ISO basic minor for the **internal** thread used in
  tap-drill sizing. The formula is `D1 = D - 2 × (5/8) × H` with
  `H = (√3 / 2) × P`, which simplifies to `D1 ≈ D − 1.0825 × P`.
- `Tap drill` is rounded **up** to the nearest 0.05 mm (KS B 0202 standard
  drill series). This is the value the BOM exports as the recommended
  drill.
- The pitch values already match the existing `METRIC_COARSE_PITCHES`
  table in `GDTTypes.ts` (sanity check — they do; the new catalog will
  replace and supersede that table, with `METRIC_COARSE_PITCHES` becoming
  a thin re-export for back-compat).

---

## 5. ISO M Fine — partial table

Used when vibration resistance, fine adjustment, or thin-wall threading is
needed. ISO 261 / KS B 0204.

| Designation | Major D | Pitch | Minor D1 | Tap drill |
|---|---|---|---|---|
| M6 × 0.75   |  6.000 | 0.75 |  5.188 |  5.2 |
| M8 × 1.0    |  8.000 | 1.00 |  6.917 |  7.0 |
| M10 × 1.0   | 10.000 | 1.00 |  8.917 |  9.0 |
| M10 × 1.25  | 10.000 | 1.25 |  8.647 |  8.8 |
| M12 × 1.0   | 12.000 | 1.00 | 10.917 | 11.0 |
| M12 × 1.25  | 12.000 | 1.25 | 10.647 | 10.8 |
| M12 × 1.5   | 12.000 | 1.50 | 10.376 | 10.5 |
| M14 × 1.5   | 14.000 | 1.50 | 12.376 | 12.5 |
| M16 × 1.5   | 16.000 | 1.50 | 14.376 | 14.5 |
| M18 × 1.5   | 18.000 | 1.50 | 16.376 | 16.5 |
| M20 × 1.5   | 20.000 | 1.50 | 18.376 | 18.5 |
| M24 × 2.0   | 24.000 | 2.00 | 21.835 | 22.0 |
| M30 × 2.0   | 30.000 | 2.00 | 27.835 | 28.0 |
| M36 × 2.0   | 36.000 | 2.00 | 33.835 | 34.0 |

Fine threads in NexyFab use the **`isoMF`** standard code, so callouts can
emit `M10 × 1.25` (with the pitch always printed — the suppression rule in
the existing `formatThreadCallout` only suppresses the **coarse** pitch).

---

## 6. UTS / pipe tables

### 6.1 UTS UNC / UNF (ASME B1.1)

Used in NexyFab for export to American customers + legacy ANSI parts.

| Designation | Major D (in) | Major D (mm) | TPI | Pitch (mm) | Minor D1 (mm) | Tap drill (mm) | Class |
|---|---|---|---|---|---|---|---|
| #4-40 UNC    | 0.1120 |  2.845 | 40 | 0.635 | 2.156 | 2.20 | UNC |
| #6-32 UNC    | 0.1380 |  3.505 | 32 | 0.794 | 2.665 | 2.70 | UNC |
| #8-32 UNC    | 0.1640 |  4.166 | 32 | 0.794 | 3.327 | 3.40 | UNC |
| #10-24 UNC   | 0.1900 |  4.826 | 24 | 1.058 | 3.679 | 3.80 | UNC |
| #10-32 UNF   | 0.1900 |  4.826 | 32 | 0.794 | 3.988 | 4.10 | UNF |
| 1/4-20 UNC   | 0.2500 |  6.350 | 20 | 1.270 | 4.976 | 5.10 | UNC |
| 1/4-28 UNF   | 0.2500 |  6.350 | 28 | 0.907 | 5.367 | 5.50 | UNF |
| 5/16-18 UNC  | 0.3125 |  7.938 | 18 | 1.411 | 6.411 | 6.60 | UNC |
| 5/16-24 UNF  | 0.3125 |  7.938 | 24 | 1.058 | 6.792 | 6.90 | UNF |
| 3/8-16 UNC   | 0.3750 |  9.525 | 16 | 1.588 | 7.805 | 8.00 | UNC |
| 3/8-24 UNF   | 0.3750 |  9.525 | 24 | 1.058 | 8.376 | 8.50 | UNF |
| 1/2-13 UNC   | 0.5000 | 12.700 | 13 | 1.954 | 10.585 | 10.80 | UNC |
| 1/2-20 UNF   | 0.5000 | 12.700 | 20 | 1.270 | 11.326 | 11.50 | UNF |
| 5/8-11 UNC   | 0.6250 | 15.875 | 11 | 2.309 | 13.376 | 13.50 | UNC |
| 3/4-10 UNC   | 0.7500 | 19.050 | 10 | 2.540 | 16.299 | 16.50 | UNC |
| 1-8 UNC      | 1.0000 | 25.400 |  8 | 3.175 | 21.962 | 22.25 | UNC |

Designation string format: `"#10-24 UNC"`, `"1/4-20 UNC"`, `"1/2-20 UNF"`.
`formatThreadCallout` already handles `inch_unc` / `inch_unf` (line 296 of
`GDTTypes.ts`) — we extend that branch with the new catalog lookup.

### 6.2 Pipe NPT (ANSI/ASME B1.20.1)

NPT is **tapered**: half-angle `1°47′24″ = 1.7833°` (taper 1:16 = 0.0625
in/in). The major diameter at the **first thread on the small end** is the
nominal:

| Designation | OD at gauge (in) | OD at gauge (mm) | TPI | Pitch (mm) | Tap drill (mm) | Effective length L1 (mm) |
|---|---|---|---|---|---|---|
| 1/16 NPT | 0.3125 |  7.938 | 27 | 0.941 |  6.10 |  4.10 |
| 1/8 NPT  | 0.4050 | 10.287 | 27 | 0.941 |  8.50 |  4.10 |
| 1/4 NPT  | 0.5400 | 13.716 | 18 | 1.411 | 11.10 |  5.79 |
| 3/8 NPT  | 0.6750 | 17.145 | 18 | 1.411 | 14.50 |  6.10 |
| 1/2 NPT  | 0.8400 | 21.336 | 14 | 1.814 | 17.85 |  8.13 |
| 3/4 NPT  | 1.0500 | 26.670 | 14 | 1.814 | 23.10 |  8.61 |
| 1 NPT    | 1.3150 | 33.401 | 11.5 | 2.209 | 28.95 | 10.16 |
| 1-1/4 NPT| 1.6600 | 42.164 | 11.5 | 2.209 | 37.30 | 10.67 |
| 1-1/2 NPT| 1.9000 | 48.260 | 11.5 | 2.209 | 43.30 | 10.67 |
| 2 NPT    | 2.3750 | 60.325 | 11.5 | 2.209 | 55.10 | 11.07 |

`L1` is the standard hand-tight engagement length (ANSI B1.20.1). For
geometric mode, the **default** thread length in the feature is `L1` plus
3 turns (wrench-tight), unless the user overrides.

Tap-drill values are from the standard pipe-tap chart; **not** computable
from `D - P` like ISO M.

### 6.3 Pipe BSPP / BSPT (ISO 228 / ISO 7)

BSP uses **Whitworth 55° V** (compared to ISO M / UTS 60°). BSPT is tapered
1:16 like NPT but with the 55° profile. BSPP is parallel (cylindrical, G-thread).

| Designation | Major D (mm) | TPI | Pitch (mm) | Tap drill BSPP (mm) | Tap drill BSPT (mm) |
|---|---|---|---|---|---|
| G 1/8  /  R 1/8  |  9.728 | 28 | 0.907 |  8.80 |  8.80 |
| G 1/4  /  R 1/4  | 13.157 | 19 | 1.337 | 11.80 | 11.80 |
| G 3/8  /  R 3/8  | 16.662 | 19 | 1.337 | 15.25 | 15.25 |
| G 1/2  /  R 1/2  | 20.955 | 14 | 1.814 | 19.00 | 19.00 |
| G 3/4  /  R 3/4  | 26.441 | 14 | 1.814 | 24.50 | 24.50 |
| G 1    /  R 1    | 33.249 | 11 | 2.309 | 30.75 | 30.75 |

BSPP designation prefix is `G`, BSPT is `R` (external) / `Rc` (internal).
`formatThreadCallout` already emits `G1/2"` for `bsp`; we extend the
standard code into BSPP vs BSPT and add the tapered branch.

---

## 7. Geometric thread algorithm

Pseudocode for the worker side. All geometry produced in mm.

```
function buildGeometricThread(host: HostCylinder, t: ThreadFeature):
  1. Resolve numerics from catalog:
       D, P, D1, taper := catalogLookup(t.designation, t.standard)
       (taper === 0 for non-pipe)

  2. Compute helix path:
       turns = t.length / P + (entryChamferTurns(t) or 1)
       radius = (D + D1) / 4    // sweep midline = mean of major & minor
       handed = (t.direction === 'right') ? 'ccw' : 'cw'
       path = sampleHelix({
         pitchMm: P, radiusStartMm: radius,
         radiusEndMm: radius + (taper ? -tan(taper) * t.length : 0),
         turns, direction: handed, samplesPerTurn: 24, axis: 'z',
       })

  3. Build 60° V cross-section (ISO 261 truncated/rounded):
       H = (sqrt(3) / 2) * P
       // Profile is a 60° wedge truncated at 1/8H crest, rounded at
       // root with R = 0.144 * P (UNJ-style rounded root, ISO 5855 part 2).
       profile2D = build60DegV(P, H)
       // Coordinates of profile2D are in (radial, axial) plane.
       // Radial extent ≈ 5/8 * H ≈ 0.541 * P.

  4. Sweep profile along helix:
       threadBody = occtSweepProfile(profile2D, path, {
         frame: 'frenet',         // section stays normal to the helix
         twistCompensation: true, // keep the V's apex pointing radially in
         endCap: 'flat',
       })
       // Note: 'frenet' frame keeps the V's bisector radial in straight
       // helices. For tapered helices, an additional rotation is needed
       // to keep the V perpendicular to the cone axis — see §7.1.

  5. Boolean:
       if t.threadKind === 'internal':
         resultBody = booleanSubtract(host.cylinder, threadBody)
       else:
         resultBody = booleanUnion(host.cylinder, threadBody)

  6. Add entry chamfer:
       Apply existing chamfer op at the entry edge with t.entryChamfer
       (default: 45° × P).

  7. Return resultBody + face-id map for downstream callout placement.
```

### 7.1 Taper handling

For NPT/BSPT, the V-profile must remain **perpendicular to the cone axis**,
not to the helix tangent. We do this by post-rotating the swept body about
each cross-section's helix tangent by `taperHalfAngle`. Equivalently, we
can build the profile pre-rotated by the same angle and rely on the
Frenet frame.

### 7.2 Crest / root truncation reference

```
            Crest (truncated 1/8 H)
              ──┐         ┌──
                 \       /
                  \     /
                   \   /          ← flank, 60° included angle
                    \ /
                     V            ← root (rounded R ≈ 0.144 P, optional)

H = (√3 / 2) × P     ←  full profile height before truncation
basic thread height in engagement = (5/8) × H
```

The radial subtraction depth from the host cylinder is exactly `5/8 × H` for
internal threads (this gives `D1 = D − 1.0825 P`, matching §4).

### 7.3 Frame stability

`samplesPerTurn = 24` is the practical minimum; lower than that and the
sweep visibly facets. `36` is the cosmetic-render default. The worker takes
this as a parameter `quality: 'draft' | 'normal' | 'high'`:

| Quality | samplesPerTurn | Mesh deflection | Use case |
|---|---|---|---|
| draft  | 16 | 0.05 mm | live drag |
| normal | 24 | 0.02 mm | committed feature |
| high   | 48 | 0.005 mm | export to STL for 3D print |

---

## 8. Cost model

Triangles per turn ≈ `samplesPerTurn × (profile-segment-count) × 2`. With
profile-segment-count = 6 (V with truncated crest and rounded root) and
samplesPerTurn = 24:

`24 × 6 × 2 = 288` triangles per turn of swept body. After boolean
subtraction the host cylinder gains roughly **2× that** in extra triangles
along the cut intersection (OCCT adds boundary triangles).

| Designation | Turns / mm | M8 × 20 example | Triangles delta | Time budget |
|---|---|---|---|---|
| M3 × 0.5  | 2.0  | n/a |  — | — |
| M8 × 1.25 | 0.8  | 16 turns | ~9 200 tri  | 50 ms worker, 10 ms viewport |
| M10 × 1.5 | 0.67 | 13 turns | ~7 500 tri  | 45 ms worker, 8 ms viewport |
| M12 × 1.75 | 0.57 | 12 turns | ~6 900 tri | 45 ms worker, 8 ms viewport |
| M16 × 2.0 | 0.50 | 10 turns | ~5 800 tri | 40 ms worker, 7 ms viewport |
| 1/4 NPT (3 turns) | — | 3 turns | ~1 700 tri | 30 ms worker, 5 ms viewport |

Cosmetic mode: **2 triangles** (the dashed-circle hint is a viewport overlay,
not in the export mesh) and < 1 ms.

### 8.1 Hard cap (perf guardrail)

Live drag of a parameter on a feature carrying a geometric thread **demotes**
the rebuild to cosmetic preview (with a warning toast). Final commit
re-runs full geometric. This is the same pattern Onshape uses.

If a user accumulates more than **8** geometric threads in a part, the
hole wizard emits a soft warning ("Most production CAD uses cosmetic
threads — convert?"). Hard rebuild stops at **32** geometric threads with a
must-acknowledge dialog.

---

## 9. Worker API

Two endpoints, both POST, both return a `FeatureResult` shape consistent
with the existing `/occt/op/*` endpoints.

### 9.1 `POST /occt/op/thread/cosmetic`

Body:

```json
{
  "parentFeatureId": "feat_3f9...",
  "parentFaceId": "face_12",
  "threadKind": "internal",
  "standard": "isoM",
  "designation": "M8x1.25",
  "direction": "right",
  "start": "top",
  "lengthMm": 20,
  "toleranceClass": "6H"
}
```

Response:

```json
{
  "ok": true,
  "feature": {
    "id": "feat_8a1...",
    "kind": "thread",
    "mode": "cosmetic",
    "derived": { "majorDiameterMm": 8, "minorDiameterMm": 6.647,
                 "pitchMm": 1.25, "tapDrillMm": 6.8 }
  },
  "meshDelta": { "added": [], "removed": [], "modified": [] },
  "calloutPreview": "M8×1.25 - 6H ↧ 20"
}
```

No geometry round-trip. Implementation is pure metadata + viewport hint
config. Latency target: **< 5 ms server, < 20 ms RTT incl. network**.

### 9.2 `POST /occt/op/thread/geometric`

Body adds `quality` and optional explicit `entryChamfer`:

```json
{
  "parentFeatureId": "feat_3f9...",
  "parentFaceId": "face_12",
  "threadKind": "internal",
  "standard": "isoM",
  "designation": "M8x1.25",
  "direction": "right",
  "start": "top",
  "lengthMm": 20,
  "toleranceClass": "6H",
  "quality": "normal",
  "entryChamfer": { "angle": 45, "depth": 1.25 }
}
```

Response includes the full mesh delta. Latency target: **< 80 ms** for an
M8 × 20 normal-quality internal thread on a small host.

Errors:

| Error code | Meaning |
|---|---|
| `THREAD_DESIGNATION_UNKNOWN` | designation not in any catalog |
| `THREAD_PARENT_NOT_CYLINDRICAL` | parent face is not a single cylindrical surface |
| `THREAD_DIAMETER_MISMATCH` | host hole's diameter does not match tap-drill ± 5% |
| `THREAD_LENGTH_OVERRUN` | requested length > host hole depth |
| `THREAD_CAP_EXCEEDED` | > 32 geometric threads in part — must acknowledge |
| `THREAD_OCCT_FAILED` | OCCT op exception (boolean failure, sweep frame collapse, etc.) |

### 9.3 Composition with existing ops

The geometric endpoint internally calls (in this order):

1. `occtSweepProfile` (existing in `features/occtEngine.ts`) — needs the
   new "user-supplied profile" parameter; today it derives the profile
   from the input bbox. **This is the one upstream change** the Phase 2
   work makes to existing ops.
2. `occtBooleanSubtract` or `occtBooleanUnion` (existing).
3. `occtChamfer` (existing) — for the entry chamfer.

The new endpoint is a thin orchestrator; the heavy ops are reused.

---

## 10. UI integration

### 10.1 Hole wizard (primary entry)

A new section in the hole wizard, below the diameter/depth controls:

```
☐ Add thread (나사산)
    Standard      [ISO M coarse ▾]
    Designation   [M8 × 1.25 ▾]      (filtered by host diameter ±5%)
    Mode          (●) Cosmetic   ( ) Geometric
    Direction     (●) Right (CW) ( ) Left
    Class         [6H ▾]
    Length        [ Full depth ▾]    [ 20 mm   ]
    Entry chamfer ☑ 45° × 1.25 mm
```

- The **designation dropdown is auto-filtered** so the user can't select a
  designation whose tap-drill doesn't match the chosen hole diameter (this
  is the most common "garbage in" failure mode).
- Switching the diameter changes the available designations and **auto-snaps**
  to the canonical one if the user hasn't manually chosen yet.
- Selecting **Geometric** shows the triangle-budget preview in the wizard
  footer.

### 10.2 Standalone thread feature

For users adding a thread to an existing cylinder/hole:

- Right-click a cylindrical face → "Add thread…" (가공: 나사산 추가).
- Opens the same wizard, with the parent already populated.

### 10.3 Editing a thread

Double-clicking a `ThreadFeature` in the feature tree reopens the wizard
in edit mode.

### 10.4 Existing `ThreadHoleCalloutPanel` flat-callouts

Stay supported during the transition (we don't break existing files).
A **migration banner** in the panel offers to "promote" a callout into a
real feature tied to the nearest hole. This is the same pattern used for
the dimension annotation → DimensionFeature promotion in Phase 1.

### 10.5 Korean / English terminology

| Term | KR | EN | JA | ZH |
|---|---|---|---|---|
| Thread | 나사산 | Thread | ねじ | 螺纹 |
| Male / External thread | 수나사 | External thread | 雄ねじ | 外螺纹 |
| Female / Internal thread | 암나사 | Internal thread | 雌ねじ | 内螺纹 |
| Metric M-thread | M나사 (미터나사) | Metric thread | メートルねじ | 米制螺纹 |
| Unified / UTS | 유나사 (유니파이) | Unified thread | ユニファイねじ | 统一螺纹 |
| Pipe thread (taper) | 관용 테이퍼 나사 | Tapered pipe thread | 管用テーパねじ | 圆锥管螺纹 |
| Pipe thread (parallel) | 관용 평행 나사 | Parallel pipe thread | 管用平行ねじ | 圆柱管螺纹 |
| Right-hand / Left-hand | 오른나사 / 왼나사 | RH / LH | 右ねじ / 左ねじ | 右旋 / 左旋 |
| Pitch | 피치 | Pitch | ピッチ | 螺距 |
| Tap drill | 탭 드릴 | Tap drill | タップ下穴 | 攻丝底孔 |

These strings extend the existing 6-lang dictionary used by
`ThreadHoleCalloutPanel.tsx`.

---

## 11. Performance budget — summary

| Operation | Cosmetic | Geometric (normal) | Geometric (high) |
|---|---|---|---|
| Server time per feature | < 5 ms | 30-80 ms | 100-300 ms |
| Triangle delta per feature | 0 | 3 000-10 000 | 8 000-25 000 |
| Client viewport upload | < 1 ms | 5-15 ms | 15-40 ms |
| Memory per feature | < 0.5 KB | 80-300 KB | 200-700 KB |
| Live-drag handling | full rebuild | demoted to cosmetic | demoted to cosmetic |

### 11.1 Whole-part envelope

- ≤ 100 cosmetic threads — full rebuild < 100 ms.
- ≤ 8 geometric threads — full rebuild < 1 s.
- 9-32 geometric threads — full rebuild 1-4 s, with a "consider cosmetic"
  toast on every commit.

### 11.2 Live drag

When the user is dragging a parameter slider, geometric threads switch to
their cosmetic representation for the duration of the drag, then resume on
mouse-up. The CRDT op for the drag commits **only** at mouse-up, so the
geometric rebuild does not interleave with intermediate values.

### 11.3 Rebuild warnings

If, after a rebuild, the host hole's measured diameter no longer matches the
thread's `derived.tapDrillMm` within ±5%, the thread feature publishes a
**warning** (not an error) to the validation panel:

> `Thread M8×1.25 - 6H: host hole is Ø7.2 (expected Ø6.8). Consider
> changing designation to M9×1.0 or re-drilling.`

---

## 12. Drawing-callout pipeline (Phase 3 prep)

This section is **not** implemented in Phase 2, but Phase 2 must produce the
data shape Phase 3 will consume.

### 12.1 Auto-callout

For every `ThreadFeature` (cosmetic or geometric) the drawing engine emits:

- **Top view**, at the hole center: `M8×1.25 - 6H ↧ 20` (using the existing
  `formatThreadCallout` plus a depth suffix `↧ {length}`).
- **Section view**, if a section cuts the host hole: ISO 6410-1 simplified
  thread representation (continuous outer line + dashed inner line for
  internal threads), plus the same callout.
- **Detail view** (optional): zoomed thread profile with the V-section
  superimposed.

### 12.2 Tap drill notation

If a tap-drill operation is **not** modelled in the part (i.e. the user
went straight to M8 thread from solid stock), the drawing engine **adds**:

> `Tap drill Ø6.8 ↧ 22 — M8×1.25 - 6H ↧ 20`

The `+2 mm` rule (drill 2 mm deeper than the thread length) is a default
that can be overridden per-feature.

### 12.3 Threaded BOM

The BOM exporter (`standardParts/bomAggregation.ts`) gains a `threadOps`
section listing every `ThreadFeature` by designation and count, with a
total tap drill bit list:

```
THREAD OPERATIONS
─────────────────
M8 × 1.25  - 6H × 6   (tap drill Ø6.8)
M10 × 1.5  - 6H × 2   (tap drill Ø8.5)
1/4 NPT × 1           (tap drill Ø11.10)
```

---

## 13. Test fixtures

The Phase 2 PR regression set. Each fixture is a `.nfab` document committed
to `e2e/fixtures/threads/`.

### 13.1 Unit-level fixtures

| Name | Spec | Mode | Purpose |
|---|---|---|---|
| `thread-m3-cosmetic` | M3 × 0.5 thru, length 6 | cosmetic | smallest standard size; checks dropdown / catalog lookup. |
| `thread-m8-cosmetic` | M8 × 1.25, length 20 | cosmetic | the canonical case; ~95% of production. |
| `thread-m10-fine-cosmetic` | M10 × 1.25, length 15 | cosmetic | fine-pitch standard, checks `isoMF` catalog. |
| `thread-1-4-20-uts-cosmetic` | 1/4-20 UNC, length 12.7 | cosmetic | UTS catalog + inch/mm conversion. |
| `thread-1-4-npt-cosmetic` | 1/4 NPT, length 13.72 | cosmetic | pipe-tapered metadata (no geometry change). |
| `thread-m12-geometric-normal` | M12 × 1.75, length 25, normal-quality | geometric | the visual test — section view should show clean helical groove. |
| `thread-m8-geometric-high` | M8 × 1.25, length 20, high-quality | geometric | export-to-STL fidelity test. |
| `thread-1-4-npt-geometric` | 1/4 NPT, length L1 + 3 turns | geometric | tapered helix algorithm + Whitworth/UNJ profile selection. |
| `thread-left-hand-m10` | M10 × 1.5 LH, length 15 | cosmetic | direction='left' callout suffix. |

### 13.2 Integration fixtures

| Name | Description |
|---|---|
| `thread-array-cosmetic-32` | 32 cosmetic M6 threads in a 4×8 pattern on a plate. Whole-part rebuild < 100 ms. |
| `thread-array-geometric-cap-8` | 8 geometric M8 threads in a 2×4 pattern. Hits the soft cap. |
| `thread-edit-designation-warning` | Start with M8 in Ø6.8 hole; change hole to Ø7.2; expect rebuild warning. |
| `thread-host-deletion-cascade` | Delete the host hole; thread feature deletes in cascade. |
| `thread-callout-migration` | Open a legacy `.nfab` with flat `ThreadCallout` annotations; verify the migration banner promotes them to features. |

### 13.3 Worker contract fixtures

JSON snapshots of every endpoint's request/response pair, validated against
the schema in §9. Run by `npm run test:worker:thread`.

---

## 14. Migration of existing data

`ThreadCallout` (the annotation form) is **kept** — it stays as a flat
annotation on a face when no hole feature is the obvious owner. The new
`ThreadFeature` is a **superset**: every annotation can be promoted, but
not every annotation needs to be (e.g. external thread callouts on a
non-NexyFab-generated cylindrical region).

`METRIC_COARSE_PITCHES` in `GDTTypes.ts` is **superseded** by the new
catalog module but kept as a re-export of the `pitch` column so that the
existing `ThreadHoleCalloutPanel.tsx` continues to compile unchanged
until Phase 2 week 2 rewires it.

No `.nfab` format version bump is required for cosmetic-only files —
`ThreadFeature` with `mode: 'cosmetic'` round-trips through the existing
feature serializer with no special-casing.

Geometric threads bump the file format minor version (e.g. 1.4 → 1.5)
because the mesh delta they introduce is not reproducible by older
readers that lack the new sweep-with-arbitrary-profile op.

---

## 15. Phase 2 timeline (4 weeks)

| Week | Deliverable | PR scope |
|---|---|---|
| **1** | **Catalog + cosmetic metadata.** New module `features/threadCatalog.ts` with all five catalog tables (ISO M, ISO MF, UTS UNC, UTS UNF, NPT, BSP). `ThreadFeature` type added. **Cosmetic worker endpoint** (`/occt/op/thread/cosmetic`) — metadata-only, no geometry, no UI yet. Unit tests for catalog lookup + designation parsing. | small (~ 1 200 LoC) |
| **2** | **Hole wizard + standalone UI.** Wizard panel section per §10.1, standalone "Add thread" entry per §10.2, edit-in-place per §10.3, 6-lang translations per §10.5. Viewport magenta-dashed-circle hint (`mode === 'cosmetic'`). `ThreadHoleCalloutPanel` migration banner. | medium (~ 1 800 LoC) |
| **3** | **Geometric mode.** Profile builder (`thread60DegVProfile.ts`, `threadWhitworthProfile.ts`), sweep-with-profile parameter on `occtSweepProfile`, taper rotation, boolean cut, entry chamfer. Geometric worker endpoint. Cap warnings (§8.1) + live-drag demotion (§11.2). All §13.1 / §13.2 fixtures green. | large (~ 2 500 LoC, of which ~ 600 LoC OCCT bindings) |
| **4** | **Drawing-callout prep (Phase 3 handoff).** `formatThreadCallout` extension for length suffix + tap-drill suffix. `bomAggregation.ts` `threadOps` section. ISO 6410-1 dashed-line representation in section views (still gated behind the Phase 3 drawing flag). | small (~ 800 LoC) |

Total ~6 300 LoC over 4 weeks. The largest single PR (week 3) is intentionally
geometry-heavy and isolated so a revert restores a fully cosmetic
implementation without rollback hassles.

### 15.1 Out-of-band tasks (parallelizable)

- **Catalog data review**: KS B 0201 numerics audited against the printed
  standard during week 1. Sign-off from CAD advisor (`docs/wave-2-cad-advisor-jd.md`).
- **Visual QA**: rendered fixtures from §13 added to the burn-in suite
  during week 3.
- **i18n review**: 6-lang dictionary additions in week 2 reviewed against
  `project_nexyfab_3d_i18n.md` patterns.

---

## 16. Open questions (defer to Phase 2 kickoff)

1. **Should `ThreadFeature` block downstream operations** like fillet / chamfer
   on the host face? Onshape allows them but produces ugly results; Fusion 360
   blocks. Recommendation: warn but allow, matching our existing "warning,
   not error" convention.
2. **Helicoil / threaded insert** representation — out of scope for Phase 2,
   but the schema should leave room. Recommendation: add `insertType?:
   'helicoil' | 'keensert'` as a future-reserved field, populate later.
3. **Acme / trapezoidal threads** (lead screws) — out of scope. The 60° V
   profile assumption is hard-coded for Phase 2. Trapezoidal needs a 30°
   profile and a separate catalog (ISO 2901-04 / KS B 0226). Phase 3 candidate.
4. **Thread on a non-cylinder** — e.g. on a slightly bent or conical face
   that isn't pipe-taper. Out of scope; the wizard rejects with
   `THREAD_PARENT_NOT_CYLINDRICAL`.
5. **STEP / IGES export of geometric threads** — STEP B-Rep representation
   of helical surfaces is well-defined (AP203/214); STEP exporter must walk
   the boolean result. Recommendation: write the test fixture into the
   existing STEP round-trip suite in week 3; gate Phase 2 ship on it.

---

## 17. Acceptance criteria

Phase 2 ships when **all of**:

- [ ] All §4 / §5 / §6 catalog entries are loaded and unit-tested for
      `D`, `P`, `D1`, `tapDrillMm`.
- [ ] `POST /occt/op/thread/cosmetic` meets the latency target (< 5 ms server,
      p95 over 1 000 ops in the burn-in suite).
- [ ] `POST /occt/op/thread/geometric` meets the latency target (< 80 ms for
      M8 × 20 normal-quality, p95 over 100 ops).
- [ ] Hole wizard exposes thread controls per §10.1 with auto-filtered
      designation dropdown.
- [ ] Magenta-dashed-circle cosmetic hint visible in the viewport for every
      cosmetic feature.
- [ ] All §13.1 unit fixtures + §13.2 integration fixtures pass in CI.
- [ ] STEP round-trip of `thread-m12-geometric-normal` opens cleanly in
      FreeCAD reference reader.
- [ ] 6-lang dictionary updates merged and verified per §10.5 / NexyFab i18n
      patterns.
- [ ] Burn-in suite includes the thread-perf regression (§8 numbers ±20%).
- [ ] BOM exporter emits the §12.3 `THREAD OPERATIONS` block.

Until those are checked, threads remain a Phase 1 annotation-only feature.
