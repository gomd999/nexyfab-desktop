# NexyFab — Commercial-CAD parity roadmap (depth + robustness)

Goal: close the gap from "broad feature-category coverage at functional depth"
to "Fusion 360 / SolidWorks-grade depth + robustness" — surfacing, generative,
simulation, large assembly, drawing depth, and the cross-cutting hardening that
makes all of it trustworthy.

This is grounded in the ACTUAL codebase baseline (see §1), not a wishlist. Effort
tiers: **S** = days, **M** = 1–3 weeks, **L** = 1–3 months, **XL** = a quarter+.
Each item lists: current → target → steps → acceptance → effort → deps.

---

## 1. Honest baseline (where we are)

| Area | Maturity | What's real today | The depth gap |
|---|---|---|---|
| **Kernel** | CONDITIONAL | UI runs **replicad (OCCT)** B-rep for extrude/revolve/sweep/loft/boolean/fillet/chamfer when `occtGlobalMode` is ON; **mesh (three-bvh-csg)** is the fallback. New `src/lib/occt` K1–K7 bridge is separate + unconsumed. | OCCT is toggle-gated, not the unconditional truth source; not every feature is B-rep; two parallel OCCT stacks. |
| **Surfacing** | FUNCTIONAL | Real tensor-product NURBS (de Boor), Coons patches, G0/G1 checks (`surfaces/nurbsSurface.ts`, `continuity.ts`). | G2 is finite-difference only; trim/knit/thicken are mesh-level, not kernel B-rep; no Class-A. |
| **Generative** | FUNCTIONAL | Real 2D SIMP topology optimiser with Q4 FEA in the loop + OC update (`analysis/topologyOptimization.ts`). | 2D-extruded only; voxel output; single load case; no lattice/organic synthesis; no manufacturing constraints in-loop. |
| **Simulation** | SHALLOW | Teaching-grade linear static (truss/spring), modal via power-iteration, nonlinear constitutive model present but no solver loop (`fea/`, `analysis/simpleFEA.ts`). | No 3D tet/hex FEM (K assembly + sparse solve), no contact/thermal/CFD, no load-stepping. |
| **Large assembly** | FUNCTIONAL | Gauss-Seidel mate solver (coincident/concentric/gear/belt/…), instancing + LOD + LRU lazy-load (`assembly/`, `largeAssembly/`). | Iterative not DAE; no redundancy detection; no sub-assembly LOD; ~10k ceiling untested; single-threaded. |
| **Drawing** | FUNCTIONAL | 14 GD&T symbols + modifiers, BOM + balloons, section/detail/aux views, per-standard dimension styles (`drawing/`). | GD&T is markup (no tolerance stack-up solver); auto-dimension is heuristic; dimensions don't drive the model. |

---

## 2. Phase 0 — Foundation (gates everything; do first)

Depth on a non-robust, mesh-default base is fragile. These three unblock every
track below.

### F1 — B-rep as the default truth source (finish the kernel)
- **Current:** replicad-OCCT works but is toggle-gated; mesh is the practical default; a 2nd kernel (`src/lib/occt` K1–K7) is unconsumed.
- **Target:** OCCT B-rep is the DEFAULT for modelling; mesh is an explicit "fast preview / WASM-unavailable" fallback only; ONE kernel of record.
- **Steps:**
  1. Decide the kernel of record: **replicad** (in-process, already UI-wired) as primary; keep `src/lib/occt` K1–K7 for server-side / persistent-naming superpowers (variable fillet, draft, topo IDs) exposed via an API route (no Phase-5 browser dep — it runs in Node on Railway).
  2. Flip `occtGlobalMode` default ON (with a perf guard: mesh preview during slider drag, B-rep on commit) — see Track A perf notes.
  3. Extend OCCT coverage to the last mesh-only features (audit: which `FEATURE_MAP` entries still mesh in OCCT mode). Mirror the revolve wiring pattern.
  4. Activate the browser real-OCCT worker per `docs/phase-5-occt-activation-runbook.md` once a consumer + Playwright burn-in exist.
- **Acceptance:** every solid-creation + modification feature returns a B-rep handle in OCCT mode; mesh path only on explicit fallback; a single documented kernel-of-record.
- **Effort:** L. **Deps:** none (mostly wiring + the existing bridges).

### F2 — Robustness harness (measure + drive hardening)
- **Current:** good per-feature tests + perf tests (`pipeline.perf.test.ts`), but no adversarial/fuzz coverage.
- **Target:** a property/fuzz harness that actively HUNTS edge-case failures, plus invariant gates in the pipeline.
- **Steps:**
  1. **Fuzz harness:** generate random (base shape × feature sequence × params) within valid ranges; assert invariants — no throw, output is a valid manifold (reuse `meshTopology`/`meshValidation`), volume finite/positive, deterministic across 2 runs, idempotent where applicable. Mesh path (headless, no WASM). Seeded for reproducibility.
  2. **Invariant gates:** after each feature, run `assertMeshValid`; on failure attach a structured error to the feature node and STOP downstream (the fillet "block-rather-than-silently-wrong" pattern, generalised).
  3. **Degenerate corpus:** curated hard inputs (self-intersecting, sub-tolerance features, thin walls, huge coordinates, zero-area faces) → assert graceful failure, never a crash or silent garbage.
  4. Wire fuzz + corpus into CI (a bounded nightly budget); every found failure → a regression test + fix.
- **Acceptance:** fuzz harness runs N≥1000 random pipelines green (after fixing what it finds); invariant gates active; degenerate corpus all "graceful".
- **Effort:** M (harness) + ongoing (fixing finds). **Deps:** none — start now, independent of F1.

### F3 — Persistent topological naming + tolerance discipline
- **Current:** K1–K7 has stable topo naming (`topoNaming`, `edgeMatch`) in the bridge; UI selection uses mesh points / `occtEdgeSignatures`; tolerances/welding vary per module (the meshTopology bug was a welding miss).
- **Target:** edge/face selections survive rebuilds (the classic CAD "topological naming problem"); ONE tolerance/welding policy.
- **Steps:**
  1. Promote the bridge's persistent-naming approach to the UI selection layer (re-resolve a stored selection by signature each rebuild) — closes the "fillet a selected edge, change an upstream param, fillet survives" gap.
  2. Centralise numeric tolerance + vertex welding into one policy module; replace ad-hoc `toFixed`/`Math.round` keys (audit started in the meshTopology fix).
- **Acceptance:** a selected edge/face fillet survives an upstream parameter change; one tolerance policy imported everywhere.
- **Effort:** L. **Deps:** F1 (B-rep edges).

---

## 3. Track S — Surfacing depth (FUNCTIONAL → DEEP)

- **S1. Kernel-backed surfaces (M, dep F1):** route surface ops through OCCT (`Geom_BSplineSurface`, `BRepOffsetAPI_MakeFilling`, `BRepOffsetAPI_ThruSections`) instead of pure-TS evaluation, so trims/knits/tangency are kernel-exact. Acceptance: a lofted/filled surface is a real B-rep face that booleans + thickens.
- **S2. True trim / knit / thicken (M, dep S1):** `BRepAlgoAPI_Section` for surface-surface trim; sew faces into a shell (`BRepBuilderAPI_Sewing`); `BRepOffset_MakeOffset` to thicken a surface into a solid. Acceptance: trim a surface with another, knit a watertight shell, thicken to a solid with wall ±tol.
- **S3. G2 / Class-A (L, dep S1):** exact curvature continuity via kernel (not finite-difference); curvature-comb + zebra inspection. Acceptance: G2 join certified by the kernel, zebra-continuous.
- **S4. Freeform / sculpt (L):** control-cage editing, push-pull on surfaces, fillet-between-surfaces (`surfaceIntersectionFillet` → kernel). Acceptance: edit a control net and re-fit.

## 4. Track G — Generative design depth (FUNCTIONAL → DEEP)

- **G1. 3D SIMP (L, dep M1):** replace the 2D-slice-averaged optimiser with true 3D hex/tet element assembly + the 3D FEM solver from Track M; density field over a 3D voxel/element grid. Acceptance: 3D cantilever benchmark converges to the known optimal topology.
- **G2. Multi-load + constraints (M, dep G1):** multiple load cases (worst-case envelope), volume + stress + displacement constraints, manufacturing rules (min member size, draft/overhang for casting/CNC/AM). Acceptance: a 2-load-case bracket respects a min-feature + overhang rule.
- **G3. Smooth extraction (M, dep G1):** marching-cubes + mesh-fairing the density field into a printable organic body, then surface-fit to B-rep (Track S). Acceptance: optimiser output → watertight smooth solid → STEP.
- **G4. Lattice infill (M):** TPMS / strut lattices as an infill operation; graded density driven by the stress field. Acceptance: fill a region with a gyroid at a target relative density.

## 5. Track M — Simulation depth (SHALLOW → FUNCTIONAL→DEEP) — the weakest link

- **M1. 3D linear-static FEM core (L):** tetrahedral (TET10) element stiffness assembly, sparse global K, a real sparse solver (Conjugate Gradient with Jacobi/IC preconditioner; or integrate a WASM PARDISO/Eigen). Auto-mesh the B-rep (`BRepMesh` → tet via TetGen-wasm or a Delaunay refiner). Acceptance: cantilever tip deflection within a few % of analytic; a benchmark plate-with-hole stress concentration ≈ 3.0.
- **M2. Modal + buckling (M, dep M1):** generalised eigenproblem `K φ = ω² M φ` with consistent mass; subspace/Lanczos for the first k modes (replace the dense power-iteration); linear buckling `(K + λ K_g) φ = 0`. Acceptance: first natural frequency of a beam within a few %; Euler buckling load matches.
- **M3. Thermal + thermal-stress (M, dep M1):** steady + transient conduction (`K_t T = Q`), then thermal load into the structural solve. Acceptance: 1D conduction matches analytic; thermal expansion stress sane.
- **M4. Contact + nonlinear (L, dep M1):** Newton-Raphson load-stepping loop around the existing nonlinear constitutive model; node-to-surface contact (penalty/augmented-Lagrange). Acceptance: elastoplastic bar with hardening matches; two-block contact pressure ≈ Hertzian.
- **M5. Solver service option (M):** for heavy 3D, run the solver server-side (Node/worker on Railway) or integrate **CalculiX**/**code_aster** via a job queue, streaming results back. Acceptance: a 100k-DOF model solves off the main thread with progress.

## 6. Track A — Large assembly depth (FUNCTIONAL → DEEP)

- **A1. DAE / Lagrangian mate solver (L):** replace Gauss-Seidel with a constraint-Jacobian Newton solver (or Lagrange multipliers) for robust convergence on big/over-constrained systems; **redundancy + over-constraint detection** (use the `Mate.conflict` field that exists but isn't solved). Acceptance: a 200-mate assembly converges; a redundant mate is flagged, not diverged.
- **A2. Sub-assembly hierarchy + LOD (M, dep existing lod.ts):** recursive LOD on sub-assemblies; collapse a fixed sub-assembly to a single rigid body for solving + a single instanced mesh for drawing. Acceptance: a 3-level nested assembly LODs + solves at the sub-assembly level.
- **A3. Interaction at scale (M, dep octree.ts):** spatial-index picking/hover/transform so UI stays responsive at 10k+ parts; multi-thread the solver (worker). Acceptance: pick/drag stays < 16ms frame at 10k instanced parts.
- **A4. Scale validation (S):** a generated 10k-part stress assembly in the perf suite (extend `pipeline.perf.test.ts` style) asserting draw-call count, memory budget, solve time. Acceptance: 10k parts under the memory budget + interactive.

## 7. Track D — Drawing depth (FUNCTIONAL → DEEP)

- **D1. Tolerance stack-up solver (L):** make GD&T drive analysis, not just markup — worst-case + RSS (statistical) stack-up across a datum chain; link `gdtDatumChainValidator` results into an assembly tolerance analysis. Acceptance: a 3-part stack reports worst-case + RSS gap.
- **D2. Constraint-driven dimensions (M, dep F3):** a dimension edit drives the model parameter (bidirectional), using the persistent naming from F3. Acceptance: editing a drawing dimension updates the 3D model.
- **D3. Smart auto-dimension (M):** upgrade `aiDimensionAdvisor` from hints to a complete, non-overlapping, standard-compliant dimension set (baseline/chain/ordinate by datum). Acceptance: a part auto-dimensions to a fully-defined, non-overlapping set.
- **D4. Sheet + view automation (M):** multi-sheet auto-layout, auto section/detail placement, auto-balloon-to-BOM linkage, revision tables. Acceptance: a multi-body part auto-generates a multi-sheet drawing with linked BOM.

## 8. Track H — Hardening (cross-cutting, continuous)

- **H1. Failure telemetry → priorities (S, ongoing):** `reportWarning`/Sentry are wired; build a dashboard of real-world feature-failure rates to data-drive which robustness fixes matter most.
- **H2. Golden regression corpus (M, ongoing):** grow `partnerAcceptance.test.ts` into a broad golden set across every module; every shipped bug → a golden case.
- **H3. Numerical fuzzing of solvers (M):** property tests for the mate solver (convergence under random valid constraints), FEM (patch tests, rigid-body modes = 0 energy), boolean (volume conservation: |A∪B| + |A∩B| = |A| + |B|).
- **H4. Performance budgets as gates (S, ongoing):** the bundle-budget gate exists; add solve-time / tri-count / memory budgets per pipeline size as CI gates.

---

## 9. Sequencing (dependency-ordered)

```
Phase 0 (foundation, parallel-startable):
  F2 robustness harness  ── start immediately (independent)
  F1 B-rep default ──┐
  F3 topo naming  ───┴─ depend on / enable the tracks

Then, gated on F1/F3:
  Track M (FEM core M1) ── unblocks G (generative 3D) and parts of M
  Track S (kernel surfaces S1) ── unblocks S2–S4
  Track A (DAE solver A1) ── independent of M/S
  Track D (D1 stack-up, D2 needs F3)
  Track G (needs M1)

Continuous: Track H (hardening) runs alongside everything.
```

**Rough ordering of value × tractability:**
1. **F2 robustness harness** (start now — finds bugs, measurable hardening).
2. **F1 B-rep default + coverage** (the single biggest depth+robustness lever — precise kernel everywhere).
3. **M1 3D FEM core** (unblocks real simulation AND 3D generative; the weakest link).
4. **F3 persistent naming** (unblocks constraint-driven drawings + robust selections).
5. Then S / A / G / D depth tracks in parallel as capacity allows.

## 10. Honest scope note

This is a **multi-quarter-to-multi-year** program for a small team — it is the
ADR-013 "own pro-CAD" vision made concrete. None of it is a quick win; the
discipline is to (a) make the base robust + B-rep-default first (Phase 0), then
(b) deepen one track at a time with kernel-exact math + a benchmark acceptance
test for each, rather than broaden further. "Depth + robustness" is earned
benchmark-by-benchmark, not declared.
