# NexyFab Pro — Own CAD Roadmap

**Anchor:** [ADR-013](../adr/013-own-pro-cad-track.md)
**Started:** 2026-06-01
**Target MVP (Onshape-equivalent core):** 2028-12
**Owner:** gomd9 (solo + AI-assisted)

This is the multi-year build plan. Tracking tasks: #99-108. Decision-review gates: 2026-09-15, 2026-12-15, 2027-06-01.

---

## Phase 1 — Sketch Solver (Q3 2026, 3-6 months)

**Why first:** No parametric CAD without a 2D constraint solver. This is the make-or-break technical bet.

**Choice:** `@salusoft89/planegcs` — WASM port of FreeCAD's planegcs (LGPL-2.1+, npm-ready, battle-tested).

| Step | Task | Target | Status | Acceptance |
|---|---|---|---|---|
| 1.1 | Install + smoke test | 2026-06-08 | ✅ 2026-06-01 (2b28cc9a) | WASM loads + solves trivial constraint (1 test, 36ms cold start) |
| 1.2 | Solver facade (typed wrapper) | 2026-06-22 | ✅ 2026-06-01 (23cc5238) | 9 constraints + drag via set_p_param + DoF via gcs.dof() (14 tests) |
| 1.3 | SolverSketchEditor on solver | 2026-07-15 | ✅ 2026-06-01 (3f749185) | 6 entity tools + 5 constraint tools + DoF panel + live solve (9 tests) |
| 1.4 | Sketch ↔ 3D plane mapping | 2026-08-15 | ✅ 2026-06-01 (54d9eb8a) | SketchPlane: localToWorld/worldToLocal + 3 standard planes + 3 factories (16 tests) |
| 1.A | **4-bar linkage acceptance** | 2026-09-15 | ✅ 2026-06-01 (854fcc08) | 1-DoF drag holds 3 length constraints + persist/reload + dof=1 (5 tests) |

**Phase 1 closed 2026-06-01 (15 weeks ahead of plan).** planegcs is suitable for Phase 2+. Total Phase 1 footprint: 5 commits, 2150 lines, 45 tests (45/45 green).

**Gotchas to avoid:**
- 6 buggy non-driving constraints in planegcs (CircleDiameter, ArcDiameter, C2CDistance, C2LDistance, P2CDistance, ArcLength) — restrict to driving mode only.
- No built-in DoF/redundancy analysis — wrap own counter.
- WASM cold-start 200-500ms — lazy load on first sketch open.
- LGPL compliance: ship NOTICE, attribute FreeCAD + Salusoft89, keep planegcs WASM dynamically loaded.

**Decision-review @ 2026-09-15:** Did planegcs hit a wall? If yes, evaluate D-Cubed or own solver (6-12 month detour).

---

## Phase 2 — Feature-based Part Modeling (Q4 2026 - Q1 2027, 6-9 months)

| Step | Task | Status | Acceptance |
|---|---|---|---|
| 2.1 | Extrude IR + SCAD | ✅ 2026-06-01 (dd2b04a5) | Profile extraction + extrude IR + linear_extrude SCAD; 18 tests |
| 2.2 | Revolve + Sweep + Loft IRs | ✅ 2026-06-01 (d4bf3e99, 024d9699) | rotate_extrude + BOSL2 path_sweep + BOSL2 skin; 20 tests |
| 2.3 | Fillet / Chamfer | ⏳ existing src/app code, IR wrap pending | Per-edge OCCT (already lives) |
| 2.4 | Pattern (linear + circular) | ✅ 2026-06-01 (f5fd1aa2) | Feature-agnostic transforms with normalized axes; 13 tests |
| 2.5 | Reference geometry (datum point/axis) | ✅ 2026-06-01 (703b50d3) | DatumPoint/Axis + projectOntoAxis + axisToAxisDistance; 14 tests |
| 2.6 | Parametric history (3 sub-phases) | ✅ 2026-06-01 (d053ae9d, ab7f5792, 599a659b) | FeatureTree IR + diff/incremental replay + 7 EditOps + undo/redo; 43+13 tests |
| 2.7 | Configurations expansion | ⏳ existing infra in src/app | SolidWorks-style table (Yjs collab already wired) |
| 2.A | **Integration test** | ✅ 2026-06-01 partial (cde56b30) | Sketch → extract → extrude → tree → SCAD end-to-end; 3 tests. Full UI deliverable: 10 maker parts buildable from SolverSketchEditor → 3D viewport |

**Phase 2 IR layer closed 2026-06-01.** Remaining: 2.3 wrapping existing fillet/chamfer infra into the FeatureTree, 2.7 configurations sync with FeatureTree, 2.A full UI demo (10 parts buildable end-to-end through SolverSketchEditor). Phase 2 footprint so far: 8 commits, 2500 lines, 115 tests.

---

## Phase 3 — Assembly (Q2-Q3 2027, 6-9 months)

| Step | Task | Acceptance |
|---|---|---|
| 3.1 | Full mate types (7) | coincident/concentric/distance/angle/parallel/perpendicular/tangent |
| 3.2 | Mate solver (Lagrange or Newton) | Solves over-constrained gracefully; sub-1s for 100-part assembly |
| 3.3 | DoF display + kinematic constraints | Per-part DoF shown; visualize redundancy |
| 3.4 | Interference check + visualization | OCCT BRepAlgo intersection; report list |
| 3.5 | Sub-assembly hierarchy | Nest 3+ levels; rigid/flexible sub-assembly toggle |
| 3.6 | Motion study (mate controller) | Animate over a mate parameter |
| 3.A | **Acceptance: 4-bar linkage as assembly** | Phase 1 sketch becomes parts + mates; animate via mate slider |

---

## Phase 4 — Drawing (Q4 2027, 4-6 months)

| Step | Task | Acceptance |
|---|---|---|
| 4.1 | Sheet templates + projection | 3-view, auxiliary, section, detail (current v1 → v2) |
| 4.2 | Dimensions (manual + auto) + tolerance + GD&T | ASME Y14.5 callout subset |
| 4.3 | Auto BOM + revision table + sheet sets | Linked to assembly; revisions tracked |
| 4.4 | Export: DXF / PDF / DWG | LibreCAD or commercial library |
| 4.A | **Acceptance: shop-ready drawing** | Real machinist can quote from the drawing without follow-up questions |

---

## Phase 5 — File Interop (Q1-Q2 2028, 3-6 months)

| Step | Task | Acceptance |
|---|---|---|
| 5.1 | STEP AP242 full read/write | Roundtrip 95% of real-world STEP without geometry loss |
| 5.2 | IGES read/write | Read 90% of legacy IGES files |
| 5.3 | DXF / DWG read/write | LibreCAD integration |
| 5.4 | STL / 3MF strengthening | Existing path; expand for compressed 3MF |
| 5.5 | SLDPRT / IPT / X_T | **STEP bridge only** (proprietary, won't license) |

---

## Phase 6 — AI Differentiators (Parallel all phases)

These ship as soon as each phase enables them. Real moat vs SolidWorks.

| Feature | Enabled by | Target |
|---|---|---|
| AI sketch suggest (NL → constraints) | Phase 1.2 | 2026-08 (parallel with 1.3) |
| Parametric assistant (intent → auto-dimension) | Phase 1.A | 2026-10 |
| Inline DFM warnings (realtime, in-canvas) | Phase 2.A | 2027-01 (already partial via shape-chat) |
| NL revision history (자연어 변경 → feature edit) | Phase 2.6 | 2027-03 |
| Voice input (음성 → CAD command) | Phase 2 mid | 2027-Q1 |
| AI assembly suggest (parts → likely mate pattern) | Phase 3.1 | 2027-Q3 |
| AI drawing auto-annotate | Phase 4.2 | 2027-Q4 |

**Why AI is the moat:** SolidWorks/Onshape can add AI sidebars (and will), but they're retrofitting onto desktop-legacy architecture. NexyFab Pro is AI-first cloud-native from day 1. Plus, the data NexyFab web + Pro generate over 2-3 years compounds the AI advantage.

---

## Funding Decision Points

| Date | Trigger | Decision |
|---|---|---|
| 2026-12 | Phase 1 done, MRR ≥ $10K | Continue solo OR seek seed ($1-3M, accelerator) |
| 2027-06 | Phase 2 60% done, MRR ≥ $30K | Continue solo OR seed (more leverage now) |
| 2027-12 | Phase 2 done | Seed required if not raised; Series A possible if MRR ≥ $100K |
| 2028-06 | Phase 3 60% done | Series A trigger (build team for Phase 4-5 acceleration) |

**If MRR < $5K by 2027-06:** Re-evaluate — was the assumption "build it and they will come" wrong? Pivot to plugin track + design-partner-driven feature scoping.

---

## Parallel Tracks (Don't Forget)

NexyFab Pro is NOT the only track:

1. **NexyFab web (maker/SMB)** — current product, revenue source, AI training data source. Continue ship + design partner outreach.
2. **Design partner outreach** — [`docs/strategy/DESIGN_PARTNER_OUTREACH_KIT.md`](../strategy/DESIGN_PARTNER_OUTREACH_KIT.md). Runs continuously.
3. **Plugin track (Fusion/Onshape)** — deferred to post-Phase 2. Then becomes user funnel into Pro.

If web track hits $30K MRR before Phase 2 ships, divert 30% time to web (revenue compounds). If web stalls, double down on Pro (the only credible long-term defensible product).

---

## Failure Modes (Reread quarterly)

1. **Sketch solver hits a wall (Phase 1)** — planegcs API limitations or numerical issues for non-trivial sketches. Mitigation: D-Cubed evaluation (paid, $50K/yr), 6-12 month detour acceptable.
2. **OCCT not enough for Phase 2 quality** — boolean ops fail on real-world geometry. Mitigation: pre-clean via mesh repair; eventual Parasolid migration post-Series A.
3. **Solo burnout (Year 2-3)** — statistically the most likely failure. Mitigation: seek cofounder by 2027-06 regardless of progress.
4. **Competitor wins AI race** — Plasticity/Shapr3D ships great AI before Phase 2. Mitigation: ship Phase 6 features aggressively, even if rough; brand "verified AI" position.
5. **Funding climate turns** — 2027 AI-tools market correction. Mitigation: maintain $30K+ MRR by Phase 2 done; bootstrappable.

---

## Glossary (for future-me)

- **planegcs** — FreeCAD's 2D Geometric Constraint Solver (C++, LGPL-2.1+).
- **OCCT** — Open CASCADE Technology, the geometry kernel NexyFab uses.
- **D-Cubed DCM** — Siemens' commercial 2D constraint solver (industry standard, ~$50K/yr).
- **B-rep** — Boundary representation, the geometry model OCCT/Parasolid use.
- **DoF** — Degrees of freedom (under-constrained sketch has > 0 DoF).
- **GD&T** — Geometric Dimensioning and Tolerancing (ASME Y14.5).
- **AP242** — STEP application protocol covering 3D + PMI.
