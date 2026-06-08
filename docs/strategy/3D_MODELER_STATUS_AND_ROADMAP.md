# NexyFab 3D Modeler — Implementation Status & Roadmap

> Last updated: 2026-06-07
> Scope: a grounded, track-by-track snapshot of the 3D CAD modeler
> (`src/app/[lang]/shape-generator/` + `src/lib/{cad,occt,sketch,drawing,assembly}/`)
> and what remains to reach SolidWorks / Fusion-grade depth.
>
> Based on an exhaustive code survey (not a wishlist). Companion to
> `commercial-parity-roadmap.md` (the depth plan) — this doc is the **current
> state of record**.

---

## 0. Headline

NexyFab's 3D modeler is **~85–95% feature-complete vs SolidWorks at the breadth
level**. A multi-track survey (kernel, simulation, surfacing, drawing, assembly)
repeatedly found capabilities already implemented. **The remaining gap to true
SolidWorks-grade is no longer "more features" — it is the KERNEL CEILING:**
replicad's high-level API cannot express exact surface trim / offset / thicken /
production rolling-ball fillet, and FEA stress-concentration needs a
boundary-conforming mesh. Closing these is a **kernel decision (ADR-014)**, not
incremental feature work.

**Kernel-of-record today:** `replicad` (OpenCascade WASM, in-process) drives the
UI B-rep when OCCT mode is on; mesh (three-bvh-csg) is the fast/fallback path.
A second kernel — `src/lib/occt` (real `opencascade.js`, the "K-series" with
STEP/fillet/draft/persistent-naming) — exists but is **server/headless only and
unconsumed by the UI**.

---

## 1. Status by track

Legend: ✅ BUILT · 🟡 PARTIAL · ❌ MISSING · 🧱 blocked on kernel ceiling

### Kernel / feature coverage (F1)
| Capability | Status | Notes |
|---|---|---|
| Extrude / revolve / sweep / loft | ✅ | replicad B-rep in OCCT mode |
| Boolean / fillet / chamfer / shell / hole | ✅ | B-rep + mesh fallback |
| Pattern (linear/circular) / mirror / rib | ✅ | B-rep |
| **draft / scale / moveCopy / helix** | ✅ | **added 2026-06-07** (`occtDraft/occtScale/occtMoveCopy/occtSweepHelix`) |
| splitBody | ✅ | half-space intersect |
| **variableFillet** | ✅ | **added 2026-06-07** — real `[r1,r2]` variable radius on a selected edge |
| OCCT mode default | 🟡 | default OFF; flip to ON needs browser visual QA (F1.3) |
| Live mesh preview during slider drag | ❌ | current guard = 120 ms debounce + async worker (F1.2; needs browser QA) |

### Selection / persistent naming (F3)
| Capability | Status | Notes |
|---|---|---|
| Edge/face selection survives upstream param change | ✅ | `edgeCorrespondence` + `topologyEdgeFinder` signature re-anchor; acceptance test 7/7 (incl. real OCCT) |
| UI selection persistence (fillet/chamfer/shell/variableFillet) | ✅ | `addFeatureWithContext` → `addFeatureWithEdges` |
| Single tolerance/welding policy | ✅ | `features/tolerancePolicy.ts` |
| Mesh-mode per-edge bevel | 🧱 | three-bvh-csg non-watertight; OCCT path is the route |

### Simulation (Track M)
| Capability | Status | Notes |
|---|---|---|
| 3D static FEM (TET10, sparse PCG) | ✅ | `analysis/femSolver.ts`, cantilever ~1–2% |
| Part modal (natural frequencies) | ✅ | `analysis/modalSolver.ts` — consistent mass, participation, UI panel; bending 1st few %, axial c/4L |
| **Part linear buckling** | ✅ | **added 2026-06-07** `analysis/partBucklingFEM.ts` — `Kφ=λ(−K_g)φ`, Euler column verified |
| Steady-state thermal conduction (part) | ✅ | `analysis/thermalFEA.ts` (FD/lumped, per-vertex T, convection/flux BCs) |
| Modal / buckling on HEX8 grid | ✅ | `fea/modalFEM.ts`, `fea/buckling.ts` (topology-opt domain) |
| Mode-superposition (harmonic/transient engine) | ✅ | `simulation/modeSuperposition.ts` (Newmark-β) |
| Large closed-form engineering suite | ✅ | `fea/` 130+ verified types |
| **Stress concentration Kt ≈ 3.0 (plate-with-hole)** | 🧱❌ | `feaStressConcentration.test.ts:77` `.skip`; structured grid gives Kt≈1.1–1.6 — needs **boundary-conforming mesh (TetGen-wasm)** |
| Contact / nonlinear load-stepping (real solver loop) | 🟡 | constitutive models exist; full Newton contact loop is the depth gap |

### Surfacing (Track S)
| Capability | Status | Notes |
|---|---|---|
| NURBS / Coons / Gordon / loft / sweep eval | ✅ | `surfaces/*` (pure-TS) + kernel loft/sweep |
| Kernel-backed filled surface | ✅ | `occtFilledSurface` (real `Geom_BSplineSurface` face) |
| G0/G1/**G2 (exact)** + Class-A (zebra, curvature comb) | ✅ | `continuity.ts` (2nd fundamental form), `classASurfaceAnalysis`, `zebraStripeAnalysis` |
| Freeform sculpt (control-pt push-pull + FFD lattice) | ✅ | `freeformDeformation.ts` |
| Knit/sew → solid; shell | ✅ | `occtKnitSolidFaces`, `occtShellBox` |
| **Surface-surface TRIM (kernel, BRepAlgoAPI_Section)** | 🧱❌ | only UV-space mesh trim exists |
| **Exact surface OFFSET** | 🧱❌ | only mesh-level normal offset; replicad `makeOffset` = surface-offset, **not** thicken-to-solid |
| **Thicken surface → solid (BRepOffset)** | 🧱❌ | confirmed blocked at replicad high-level (2026-06-07 experiment) |
| **Production rolling-ball fillet** | 🧱🟡 | `surfaceIntersectionFillet` is preview-grade (marching); not kernel BRepFilletAPI |

### Drawing / detailing (Track D)
| Capability | Status | Notes |
|---|---|---|
| Ortho projection + HLR (true depth-occlusion) | ✅ | `lib/drawing/projectView.ts`, `analysis/hiddenLineRemoval.ts` |
| Section + detail views; auto multi-view layout (D4) | ✅ | `sectionView`, `detailViewBubble`, `drawingTemplates/autoViews` |
| Dimensioning (linear/aligned/angular/radial/diameter/ordinate) | ✅ | `lib/drawing/dimension.ts`, `ordinateDimension` |
| Dimension chain optimizer (chain vs baseline) | ✅ | `drawingTemplates/smartDimension.ts:optimizeChain` (RSS accumulation) |
| GD&T (14 symbols, FCF, DRF structure) | ✅ | `drawing/gdt.ts`, `tolerance/datumReferenceFrame.ts` |
| Tolerance stack-up — **1D** WC/RSS/Monte Carlo + sensitivity/DPMO | ✅ | `tolerance/toleranceStackup*.ts` |
| BOM + balloons (↔BOM cross-check) + title block | ✅ | `lib/drawing/bom.ts`, `drawing/balloon*` |
| DXF / PDF / PNG export | 🟡 | DXF = LINE+TEXT only (no arcs/dims); PDF = rasterized (vector pipeline planned) |
| **D1 — 3D DRF tolerance stack-up** | ❌ | 1D only; DRF built but not fed to a 3D solver |
| **D2 — constraint-driven dimensions (edit dim → drive model)** | ❌ | dimensions are one-way annotations |
| Auxiliary (inclined) view projection | 🟡 | framework + rotation matrix; transform not wired |

### Assembly (Track A)
| Capability | Status | Notes |
|---|---|---|
| 11 mate types (incl. gear/belt/cam/hinge/slider) | ✅ | `assembly/matesSolver.ts` |
| Gauss-Seidel + Newton-Lagrange (LM) solver | ✅ | `lib/assembly/lagrangianSolver.ts` (selected for ≥5 parts / over-constrained) |
| Redundancy / over-constraint detection | ✅ | `mateRedundancyDetector`, `mateDofAnalysis` |
| LOD (5-tier) + GPU instancing + LRU lazy-load + octree | ✅ | `largeAssembly/*` |
| Interference (sweep-prune + tri-tri, worker) + clearance | ✅ | `InterferenceDetection.ts` |
| Motion study (keyframes) + kinematic drag | ✅ | `assembly/motionStudy.ts`, `KinematicDragManager` |
| Mate solver in worker | ✅ | `workers/mateWorker.ts` |
| **A1 — conflict AUTO-resolution** | 🟡 | detected; resolution is greedy + needs user accept |
| **A2 — collapse fixed sub-assembly → rigid body (constraint reduction)** | ❌ | sub-assemblies are UI/explode groups only |
| **A4 — 10k-part scale validation** | ❌ | perf-tested to 5k; 10k untested |
| Exact B-rep interference | ❌ | AABB + tessellated tri only |

---

## 2. What changed this session (2026-06-07)

Branch `wave-2/phase-3-w7-z7-activity-stack`. Commits:

- **`3a0fd9df`** `[P1] feat: draft/scale/moveCopy/helix/variableFillet → real B-rep`
  (F1 coverage + F3 variable fillet) — 13 files, +726/−33.
- **`dee0b2c3`** `[P1] feat: modal + linear buckling on the real TET10 part FEM (M2)`
  — 5 files, +608. Net-new capability: **part-level linear buckling**
  (`partBucklingFEM.ts`) + femSolver geometric-stiffness (`tet10Gradients`,
  `computeTet10GeomScalar`).
- **`c47c6a7a`** `[P1] fix: drop redundant partModalFEM (dup of modalSolver.ts)`
  — 3 files, +2/−368. Removed a modal module that duplicated the existing,
  more-complete `modalSolver.ts`.

All headless-verified (analytic benchmarks), `tsc` clean, pre-commit green.

**Lessons (apply before any new module):**
1. Grep broadly first — naming may not match (`*FEM*` glob missed `modalSolver`).
2. API existence ≠ desired behavior — verify by experiment (`makeOffset` is a
   surface offset, not a thicken).
3. A doc-comment feature list is not a TODO (`optimizeChain` was already built).

---

## 3. The real decision — kernel strategy (gates the remaining depth)

Every remaining SolidWorks-grade gap above marked 🧱 traces to the same root:
the replicad high-level API can't express the exact kernel op. Three paths:

| Path | What | Character | Risk |
|---|---|---|---|
| **(a)** replicad raw-`oc` extensions | call `BRepOffset_MakeOffset` / `BRepAlgoAPI_Section` / `BRepFilletAPI` on replicad's raw OCCT | incremental, per-op | fragile (embind signatures), brittle to replicad's bundled OCCT |
| **(b) ⭐ promote `src/lib/occt` K-series to the UI kernel** | adopt the real `opencascade.js` bridge (already has STEP / fillet / chamfer / draft / persistent naming) as the modelling kernel | the ADR-014 "own pro-CAD" path | large — a multi-quarter rewrite (sync in-process → async worker; UX implications) |
| **(c)** TetGen-wasm boundary-conforming mesh | accurate FEA stress concentration (Kt≈3.0) | independent of (a)/(b) | XL; regression risk to the validated solver |

**Recommendation:** (b) is the principled long-term moat (matches ADR-013/014).
It is not a single-session task. A sensible **de-risking spike** first:
headless-verify the K-series performing ONE ceiling op (e.g. thicken via
`BRepOffset`, or surface trim via `BRepAlgoAPI_Section`) in Node, proving path
(b) closes a gap replicad can't — before committing to the migration.

### 3.1 De-risking spike — DONE ✅ (2026-06-08)

The spike ran. **`src/lib/occt/ceilingSpike.thicken.test.ts`** loads the real
`opencascade.js` headless in Node and proves the K-series performs the two
ceiling ops replicad's high-level API cannot:

| Ceiling op | Kernel call | Result | Verdict |
|---|---|---|---|
| **Thicken surface → solid** | `BRepOffsetAPI_MakeThickSolid_1.MakeThickSolidBySimple` | thickened a 10×10 sheet by 2 → **volume = 200.000** (exact) | ✅ closes Track S 🧱 thicken |
| **Surface–surface TRIM** | `BRepAlgoAPI_Section_3(S1, S2, true)` | two crossing faces → **1 intersection edge** | ✅ closes Track S 🧱 trim |

Build also exposes `BRepOffsetAPI_MakeThickSolid_{1,2}`,
`BRepOffsetAPI_MakeOffsetShape_{1,2}`, `BRepAlgoAPI_Section_{1..8}`,
`BRepBuilderAPI_Sewing` — every embind class the remaining Track S 🧱 items need.
`BRepOffset_MakeOffset` is **absent** from this build's bindings, so use
`MakeThickSolid` / `MakeOffsetShape` for offset/thicken (not the lower-level
`BRepOffset_MakeOffset`).

**Conclusion:** path (b) is validated — the K-series can express the kernel
ceiling. The remaining work is the **migration** (sync in-process → async
worker, UX guardrails), NOT a question of kernel capability. Tier 0 decision can
now be made with evidence: **adopt (b)**.

---

## 4. Future to-do (prioritized)

**Tier 0 — kernel decision (unblocks the most depth):**
- [x] **De-risking spike DONE (2026-06-08)** — K-series thicken (vol=200 exact)
      + surface trim (1 edge) headless-verified; see §3.1 / `ceilingSpike.thicken.test.ts`.
- [x] **Kernel strategy DECIDED (2026-06-08): path (b)** — recorded in ADR-014 §K8.
- [x] **Promoted `buildPlanarFace` + `thicken` + `surfaceTrim`** into the
      `OcctBridge` interface + `nodeOcctBridge.ts` as real methods
      (`nodeOcctBridge.test.ts` K8 group, 25/25 green).
- [ ] **Migration plan for occtEngine consumers** (in-process sync → async
      worker; surface browser `thicken`/`surfaceTrim` through the worker RPC).

**Tier 1 — genuine non-kernel gaps (pure-algorithmic, headless-verifiable):**
- [x] **D1 DONE (2026-06-08)** — **directional** 3D DRF tolerance stack-up
      (`tolerance/toleranceStackup3D.ts`). Closes the gap where the old
      `datumReferenceFrame.ts:stackup3D` built `drfTransform` but `void`d it
      (collapsing 3D→1D): each link's tolerance box is now rotated through the
      DRF into global coords and accumulated PER-AXIS (worst-case supporting
      half-width + RSS variance); datum FORM error fed in via
      `evaluateFeatureInDrf`. Closed-form verified (`toleranceStackup3D.test.ts`
      5/5): identity DRFs reproduce the 1D answer; a 90°-rotated DRF routes a
      local-X zone to global-Y. tsc clean; existing tolerance tests 46/46 green.
- [x] **A2 DONE (2026-06-08)** — rigid sub-assembly now drops its internal
      mates on flatten (`lib/assembly/subAssembly.ts:expandSub`): members are all
      frozen so the internal mates are redundant — removing them is the
      constraint reduction (smaller solver matrix, clean DoF/redundancy count).
      Flexible subs keep theirs. Fixed a mislabeled test (a "flexible" case was
      actually default-rigid) + added a rigid-drop test; `subAssembly.test.ts`
      29/29, BOM consumers 37/37, tsc clean.
- [x] **A4 DONE (2026-06-08)** — spatial-hash broad-phase
      `assemblyInterferencesSpatial` (`lib/assembly/interference.ts`) replaces the
      O(N²) all-pairs scan (the Phase-3.4.3 BVH gap). EXACT (shares-a-cell ⇒
      no missed overlap), id-sorted output. **10k parts: 77 ms vs 3300 ms
      brute (≈43×), identical pairs** (`interferenceSpatial.test.ts`: 4 exactness
      tests always-on + 10k bench gated `RUN_PERF_BENCH=1`). tsc clean.
- [x] **A1 core DONE (2026-06-08)** — `assembly/mateConflictResolver.ts`
      `proposeConflictResolutions`: non-destructive, ranked resolution proposals
      (per over-constrained subgraph: highlight-mate set + relax options ranked
      weakest-first + recommended pick = what greedy auto-drops). The viewport
      feedback DATA layer. Verified (`mateConflictResolver.test.ts` 18/18).
      **Overlay UI DONE (2026-06-08)**: `assembly/ConflictResolutionOverlay.tsx`
      — floating panel of conflict cards + ranked relax chips (recommended
      badged) + auto-resolve; emits `onAccept(mateId)` / `onHighlight(mateIds)` /
      `onAcceptAllRecommended`; 4-lang. jsdom-verified
      (`ConflictResolutionOverlay.test.tsx` 5/5). Remaining = host wires
      `onHighlight` to the actual 3D mate-mesh highlight (browser-gated visual).
- [x] **D2 core DONE (2026-06-08)** — `equations/dimensionDriver.ts` makes
      dimensions bidirectional against the real parametric engine: a
      `DimensionBinding` ties a dim to an `EquationManager` global variable
      (`measured = scale·variable + offset`); `applyDimensionEdit` solves for the
      variable, writes it, and the equation DAG re-evaluates all dependent feature
      params. Forward `dimensionValueOf` too. Verified (`dimensionDriver.test.ts`
      7/7: direct, DAG propagation, diameter→radius scale, affine offset, errors).
      **UI component DONE (2026-06-08)**: `drawing/DrivingDimensionField.tsx` —
      shows the bound value, drives the variable on Enter/blur, calls `onRebuild`;
      jsdom-verified (`DrivingDimensionField.test.tsx` 4/4: drive on Enter, scaled
      binding, invalid→error+no-rebuild, var label). Remaining = placing the field
      in the production drawing flow (browser-gated visual).

**Tier 2 — robustness / polish (browser-QA gated, can't headless-verify):**
- [ ] **F1.3** flip OCCT mode default ON (browser visual-regression matrix).
- [ ] **F1.2** live mesh preview during slider drag (continuous feedback →
      B-rep on commit), if desired beyond the current debounce.
- [x] **DXF circles/arcs DONE (2026-06-08)** — `analysis/dxfArcDetect.ts`
      collapses faceted visible/hidden segment fans into true `CIRCLE`/`ARC`
      entities (Kåsa fit + curvature/facet-count guards; intended low-poly
      polygons stay LINEs), wired into production `buildDrawingDxfString`; added
      an `LTYPE` table so HIDDEN renders **dashed**. Verified
      (`dxfArcDetect.test.ts` 6/6 + `drawingExportSmoke` cylinder→CIRCLE);
      M4 regression 42/42 green. Remaining: DXF dimension entities; vector
      (svg2pdf) PDF.
- [ ] Auxiliary-view inclined projection wiring.

**Tier 3 — kernel-gated depth (after Tier 0 path chosen):**
- [ ] Surface-surface trim, exact offset, thicken-to-solid, production
      rolling-ball fillet (Track S 🧱).
- [~] **FEA Kt path-c DE-RISKED (2026-06-08)** — `analysis/feaPlateHoleKt.ts`:
      a boundary-conforming polar mesh + real Q4 plane-stress FEA (reusing
      femSolver's CSR+PCG) recovers the **Kirsch Kt ≈ 3.0** (test asserts
      2.8–3.2, refines toward 3, hoop at load axis ≈ −σ) — decisively clearing
      the structured-voxel 1.8–2.2 ceiling. Proves the conforming-mesh path
      closes the gap; production needs the XL TetGen-wasm 3D mesher (this spike
      is 2D, standalone, and does NOT touch the validated TET10 solver).
- [ ] Contact / nonlinear FEM solver loop (Track M depth).

---

## 6. Detailed code audit (2026-06-08, 5-track skeptical sweep)

A track-by-track code audit (real-vs-shallow-vs-stub, evidence-based). Two
"severe" first-pass claims were investigated and **downgraded** — recorded here
so they aren't re-raised:

- ❌ *"non-uniform scale silently produces wrong geometry"* — FALSE. Mesh scale
  is an affine vertex transform → **geometrically exact**; the only loss is the
  B-rep handle for downstream chaining (`features/scale.ts:25-41`).
- ❌ *"brepBoolean silently emits non-watertight solids"* — FALSE. It has an
  explicit **honesty gate** that warns "Face splitting not implemented … NOT a
  watertight boolean" (`features/brepBoolean.ts:103-114`); production booleans
  use `occtBooleanSolids` / mesh-CSG. The codebase consistently honours
  "block/warn rather than silently wrong."

### Reconciled scorecard

| Track | Real & verified | Real but shallow/approx | Exists but NOT wired to UI |
|---|---|---|---|
| **Kernel/feature** | replicad B-rep for all solid ops in OCCT mode; mesh-CSG fallback is geometrically correct; fuzz + degenerate corpus in CI | mesh fillet = heuristic cosine offset; thread = cosmetic `TubeGeometry` (not manufacturable B-rep); fillet/chamfer error on convex N-gon | K-series (`src/lib/occt`) incl. new `thicken`/`surfaceTrim` — Node/test only |
| **Simulation** | TET10 + sparse PCG static; modal (HEX8); linear buckling; steady thermal — all analytic-benchmark verified | stress-conc. Kt ≈ 1.8–2.2 vs 3.0 (structured grid, no notch refinement; `feaStressConcentration.test.ts` `.skip`) | **nonlinear/plasticity, contact (penalty), dynamic/transient, buckling** exist as libraries with **NO panel** — only static/modal/thermal have UI |
| **Surfacing** | de Boor NURBS eval, Coons, exact `normalCurvature` (2nd fund. form), zebra | **all 4 ceiling items are mesh/UV-space approx** (trim, offset, thicken, rolling-ball fillet); rational-NURBS weights incomplete; loft = degree-1 LERP (kinks) | SurfaceToolsPanel wired, but outputs are preview-grade meshes, not B-rep |
| **Assembly** | Newton-LM (`lagrangianSolver`) real + adaptive line search; rigid sub-assembly collapse works; **interference broad-phase now spatial-hash, exact, 10k in 77 ms (A4 ✅ 2026-06-08)** | redundancy detect = heuristic DoF + opaque singular-Jacobian; narrow-phase still AABB/tri (not exact B-rep) | 4-bar acceptance tests **only Gauss-Seidel**, not the LM path |
| **Drawing** | HLR real depth-occlusion; **production DXF (`drawingExport.ts:buildDrawingDxfString`, used by AutoDrawingPanel) DOES export the projected geometry** as visible/hidden LINEs on layered output + dims + GD&T + title block | PDF rasterized (PNG embed); dimensions one-way; **production DXF emits everything as LINE → circles/arcs are faceted polylines (no CIRCLE/ARC entities); HIDDEN layer is CONTINUOUS, not dashed** | the *other* `lib/drawing/dxfExport.ts` Sheet subsystem is LINE+TEXT placeholder only and unused by the panel; A4: 10k-part scale UNTESTED (max 5 parts) |

> **Audit correction (2026-06-08):** the first-pass claim "DXF export lacks part
> geometry" was about the **unused** `lib/drawing/dxfExport.ts`. The **production**
> path (`analysis/drawingExport.ts`) already emits the real projected
> visible/hidden geometry on `VISIBLE`/`HIDDEN` layers with dims/GD&T. The genuine
> remaining DXF gap is fidelity: faceted LINEs instead of true `CIRCLE`/`ARC`, and
> a non-dashed HIDDEN layer.

### The honest takeaway

The modeler is **broad and the cores are real and verified** — but three
distinct gap *types*, in priority order:

1. **🟠 Last-mile wiring (highest leverage — hard work already done):**
   - ~~DXF export ⇏ HLR geometry~~ — production DXF already has geometry;
     **DXF circles/arcs + dashed HIDDEN DONE** (2026-06-08, Tier 2).
   - FEA libraries ⇏ UI: **part linear buckling WIRED (2026-06-08)** —
     `computeBucklingForPanel` (`partBucklingFEM.ts`, 5/5 headless) +
     `BucklingAnalysisPanel.tsx` (6-lang) + full host wiring (uiStore /
     FloatingAnalysisDock / Inner / CommandToolbar 🏛️ / Col1PanelId); tsc clean.
     **Still unwired: nonlinear/plasticity + contact + dynamic/transient** — these
     need a real Newton/contact solver LOOP first, not just a panel.
2. **🟡 Depth that's genuinely shallow:** stress-conc. mesh refinement (Kt),
   rational NURBS, higher-order loft, true variable-radius fillet on N-gons.
3. **🧱 Kernel-gated (now de-risked, path b):** surface trim/offset/thicken/
   production fillet → wire the proven K-series ops through the worker.

---

## 5. Where the record lives
- **This doc** — repo `docs/strategy/3D_MODELER_STATUS_AND_ROADMAP.md` (canonical, human-readable).
- **Depth plan** — `docs/strategy/commercial-parity-roadmap.md`.
- **Own-CAD program ADRs** — ADR-013 (own pro-CAD), ADR-014 (OCCT kernel program).
- **Session detail / lessons** — agent memory `project_nexyfab_robustness_f2.md`.
