# NexyFab Pro — Parallel Execution Plan

**Purpose:** Map the ~1200 features in [`SW_FUSION_FEATURE_SPEC_FULL.md`](./SW_FUSION_FEATURE_SPEC_FULL.md) into **independent parallel work tracks**. Identify dependencies, critical path, and how many concurrent threads (AI agents, human engineers) can productively work without colliding.

**Why this matters:** Sequential build = 10 years. Aggressive parallelization (solo + 5 AI agents OR small team) = 3-5 years for the same scope.

---

## TL;DR

- **~70% of features are independent** (parallelizable). IR layer's two-tier design (build + serialize) already decouples most work.
- **The 30% serial bottleneck**: kernel decisions (OCCT vs Parasolid), schema lock for native format, UX shell architecture.
- **Solo + AI agents (Claude max parallel)**: 6-8 concurrent threads sustainable. Each thread = independent module or doc.
- **Team of 5 engineers**: 5 parallel tracks + 1 integration role.
- **Team of 20 engineers**: 12-15 parallel tracks + 3 integration + 2 QA.
- **Critical path (cannot be parallelized away)**: Phase 2.A UI completion → Assembly UI v1 → Drawing HLR → STEP AP214 → first 5 paying partners. ~18 months minimum.

---

## Section 1 · Dependency Graph

### 1.1 Already shipped (foundation)

These are done; everything else can layer on top:

```
┌─────────────────────────────────────────────────────────────────┐
│ FOUNDATION (✅ shipped)                                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ planegcs WASM│  │ OCCT viewport│  │ shape-chat AI infra │    │
│  │  + SketchSolver  + Three.js    │  │  + provider chain   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘    │
│         │                 │                     │               │
│  ┌──────▼─────────────────▼─────────────────────▼──────────┐    │
│  │ Phase 1-6 IR layer (~12K lines, 340+ tests)             │    │
│  │  sketch/cad/assembly/drawing/interop/ai                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│  │ FeatureTree  │  │ CollabDoc    │  │ NexyFab existing │       │
│  │  + edit ops  │  │  CRDT        │  │  6-phase prod    │       │
│  └──────────────┘  └──────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 The 5 trunks (parallel-after-foundation)

```
        ┌────────────────────────┐
        │   FOUNDATION (shipped) │
        └─────┬────────┬────┬───┬┘
              │        │    │   │
         ┌────▼─┐  ┌───▼─┐ ┌▼──┐│
         │TRUNK │  │TRUNK│ │TRK││
         │  A   │  │  B  │ │ C ││
         │SKTCH │  │PART │ │ASM││
         │  UI  │  │  UI │ │UI ││
         └──┬───┘  └──┬──┘ └─┬─┘│
            │         │      │  │
            └─────────┼──────┘  ▼
                      │       ┌──┐
                      ▼       │D │
                    ┌───┐     │OC│
                    │DRW│◀────┤U │
                    │ UI│     │ME│
                    └─┬─┘     │NT│
                      │       └──┘
                      ▼
                 ┌─────────┐
                 │ TRUNK E │
                 │EXPORT/  │
                 │ INTEROP │
                 └─────────┘
```

- **Trunk A — Sketch UI** depends only on `SketchSolver` ✅
- **Trunk B — Part UI** depends only on `extrudeProfile`/`revolveProfile`/etc IRs ✅
- **Trunk C — Assembly UI** depends only on `mateSolver`/`iterativeSolver` IRs ✅
- **Trunk D — Drawing UI** depends on Part + Assembly UIs (to render their bodies), but the IR layer is independent
- **Trunk E — Export/Interop** depends on having models to export, but each format module is independent

### 1.3 Critical path (the unavoidable sequence)

```
Phase 2.A UI complete (extrude+revolve+sweep+loft+pattern+fillet+shell)
        ↓
   ~3 months
        ↓
Assembly UI v1 (insert + mate + interference)
        ↓
   ~3 months
        ↓
Drawing UI v1 (HLR + sheet + dimension + GD&T basic + PDF + DXF)
        ↓
   ~3 months
        ↓
STEP AP214 R/W (real-world 90% pass)
        ↓
   ~2 months
        ↓
5 design partners onboarded + $30K MRR (seed-ready)
        ↓
   ~3 months
        ↓
SEED ROUND → 5-person team → 5x throughput
```

**Critical path = 14 months minimum solo.** Everything else can run in parallel around this spine.

---

## Section 2 · Parallel Tracks for Solo + Claude Agents

The Agent tool supports multiple concurrent agents. Each agent thread can work on an independent module while the main thread coordinates.

### 2.1 Recommended track allocation (6-8 sustainable concurrent threads)

| # | Track name | Module/area | Avg duration | Blocks | Blocked by |
|---|---|---|---|---|---|
| 1 | **Sketch UI extension** | `sketch/` UI (trim/extend/offset/mirror/fillet) | ~3 mo | nothing | nothing |
| 2 | **Part feature UI scaffold** | `part/` panels (revolve/sweep/loft modals) | ~3 mo | Trunk B downstream | extrudeFromSketch ✅ |
| 3 | **Drawing renderer (SVG)** | `drawing/` UI from Phase 4 IR | ~2 mo | Trunk D | nothing (IR done) |
| 4 | **STEP AP214 W** | `interop/stepWrite.ts` extension | ~2 mo | partner Q3 | brep-bridge partial |
| 5 | **AI assistant prompt tuning** | `ai/sketchAssistantLlm` + `featureTreeAssistantLlm` | ongoing | nothing | LLM call wire (✅) |
| 6 | **Documentation** | `docs/strategy/*` + `docs/roadmap/*` | ongoing | nothing | nothing |
| 7 | **Test backfill** | tests for partial-IR areas (assembly motion, drawing) | ongoing | nothing | nothing |
| 8 | **Design partner outreach** | EXECUTION.md actions | ongoing (user) | revenue | nothing |

**Coordination overhead:** ~1 hour/day reviewing each thread's commits + merging.

**Throughput estimate:** 6 parallel tracks × ~70% efficiency vs sequential = ~4x faster than serial.

### 2.2 Track conflict matrix (what NOT to parallelize)

| Track A | Track B | Conflict? | Reason |
|---|---|---|---|
| Sketch UI | Part UI | ❌ no | Different files |
| Sketch UI | SketchSolver internals | ⚠️ yes | Both touch `src/lib/sketch/` — coordinate |
| Part UI | Assembly UI | ❌ no | Different components |
| Part feature IR | Part UI | ⚠️ yes | UI consumes IR — UI must wait |
| Drawing IR | Drawing UI | ⚠️ yes | UI consumes IR |
| Drawing UI | Part UI | ❌ no | Different routes |
| STEP write | STEP read | ⚠️ yes | Both in `interop/` — file-level conflict |
| AI assistant tuning | AI infra | ⚠️ yes | Both in `ai/` — coordinate |
| Outreach (user task) | Anything code | ❌ no | Different actor |
| Production deploys | UI track | ⚠️ time-coord | Don't deploy mid-UI-rewrite |

**Rule of thumb:** Two tracks safe in parallel if they touch ≠ files AND ≠ public API surface.

### 2.3 Recommended weekly rhythm (solo + Claude max parallel)

```
Monday    : Plan week. Spawn 6 agent tasks. Triage outreach replies.
Tuesday   : Agent results land. Review + merge. Spawn next batch.
Wednesday : Same. + first 1-2 demo calls.
Thursday  : Same. + integration day (manual stitch of parallel work).
Friday    : QA + production deploy. + outreach follow-ups.
Saturday  : Doc / strategic thinking (rest from code).
Sunday    : Rest. Hard cap.
```

**Expected weekly output (Y0-Y1):** 6 IR/UI modules + 20 outreach messages + 1 production deploy + 5 docs updates.

---

## Section 3 · Parallel Tracks for Funded Team

### 3.1 5-engineer team (Year 2 seed stage)

| Eng # | Role | Owns |
|---|---|---|
| 1 | **Geometry kernel + sketch** | OCCT integration, sketch solver upgrades, B-spline support |
| 2 | **Part + assembly UI** | All modeling UI, mate UI, motion study |
| 3 | **Drawing + interop** | HLR rendering, sheet UI, STEP/DXF/DWG |
| 4 | **Cloud + collab + perf** | CRDT scaling, large-assembly performance, multi-region |
| 5 | **AI + GTM eng** | LLM features, prompt engineering, demo automation |
| (founder) | **Architecture + design partners** | ADRs, strategy, partner interviews |

**Communication overhead:** daily standup (15 min) + weekly design review (60 min).

**Throughput estimate:** ~3.5x solo (not 5x due to communication overhead).

### 3.2 15-engineer team (Year 3 Series A)

| Sub-team | Eng count | Owns |
|---|---|---|
| **Kernel** | 3 | OCCT/Parasolid, geometric primitives, boolean robustness |
| **Sketch + Part** | 3 | All 2D sketch features, all part-modeling features |
| **Assembly + Motion** | 2 | Mate solver, motion study, large-assembly perf |
| **Drawing + PMI** | 2 | Full 2D output, Y14.5 GD&T |
| **Interop** | 2 | STEP/IGES/DWG/native format reader writers |
| **AI / ML** | 2 | LLM integration, generative design prototypes |
| **Platform / Infra** | 1 | CRDT, deploy, perf, observability |
| (founder + CTO) | n/a | Strategy + recruitment |

### 3.3 35-engineer team (Year 5 Series B)

Above + CAM team (5), FEA team (5), Enterprise team (3), QA (2), Plugin/marketplace (2), Design (3) = 35.

---

## Section 4 · Per-Section Parallelization Score

Coloring the 17 sections from the [detailed spec](./SW_FUSION_FEATURE_SPEC_FULL.md) by how parallelizable they are:

| Section | Features | Parallelizable? | Recommended threads | Constraints |
|---|---|---|---|---|
| 1. Sketching | 85 | **HIGH** | 3-4 | constraint solver upgrades serialize |
| 2. Part modeling | 110 | **HIGH** | 4-5 | each feature IR independent |
| 3. Surface | 25 | **MED** | 2 | NURBS continuity requires kernel context |
| 4. Sheet metal | 30 | **HIGH** | 2 | bend-table accuracy = serial deep work |
| 5. Weldments | 12 | **HIGH** | 1-2 | profile lib parallel; cut-list serial |
| 6. Mold | 10 | **LOW** | 1 | parting line is hand-tuned per part |
| 7. Assembly | 75 | **HIGH** | 3 | mate solver upgrades serialize |
| 8. Drawing | 100 | **HIGH** | 3-4 | HLR algorithm = serial deep work |
| 9. CAM | 55 | **MED** | 2-3 | post-processor matrix = many small parallel files |
| 10. FEA | 45 | **LOW** | 1-2 | mesher + solver tight coupling |
| 11. Rendering | 25 | **HIGH** | 2 | each material type independent |
| 12. File interop | 60 | **HIGHEST** | 5+ | each format = independent module |
| 13. PDM / Collab | 30 | **MED** | 2 | branch/merge math is one critical brain |
| 14. Plugin / API | 35 | **HIGH** | 3 | each endpoint independent |
| 15. AI features | 35 | **HIGH** | 3 | each LLM use case independent |
| 16. UX / Platform | 50 | **MED** | 2-3 | shell architecture serial; tools parallel |
| 17. Enterprise | 55 | **HIGH** | 3 | each compliance / auth method independent |

**Total recommended concurrent threads at full team size:** ~40 — but coordination cost caps practical at 15-25.

---

## Section 5 · The 30% Serial Bottleneck

What MUST happen serially, in order, and cannot be parallelized:

### 5.1 One-time foundational decisions

| Decision | Why serial | When | Blocks |
|---|---|---|---|
| Native file format schema (.nfp/.nfa/.nfd) | Lock once — migrating later is painful | Year 1 Q3 | All interop, PDM, plugin SDK |
| Kernel choice (OCCT stay vs Parasolid switch) | Migration is multi-month team effort | Year 3 Q1 decision | Surface modeling, exact interop, B-rep boolean reliability |
| Plugin SDK API surface | Once published, breaking changes hurt | Year 2 Q4 | Plugin marketplace ecosystem |
| Pricing model (per-seat vs token vs hybrid) | Affects 30+ surfaces (billing, admin, marketing) | Year 1 Q4 | Enterprise sales |
| Multi-tenancy isolation model (SaaS vs SaaS-isolated vs on-prem) | Affects every API + storage layer | Year 1 Q4 | Enterprise deals |
| Default GD&T standard (ASME vs ISO) | Drives drawing template defaults | Year 2 Q2 | Drawing UI shell |

### 5.2 Tight-coupling work (small teams, full focus)

| Work | Reason | Estimated effort |
|---|---|---|
| Boolean robustness on real-world STEP | Iterative fix-find-fix loop, can't parallelize the same kernel | 6-12 months × 2 engineers |
| Sketch solver numerical stability under user drag | One brain on the solver | 3 months × 1 engineer |
| HLR (hidden-line removal) integration | OCCT HLR is delicate | 4 months × 1-2 engineers |
| CAM toolpath collision math | Kernel-deep | 6 months × 2 engineers |
| FEA mesher | Computational geometry deep dive | 6 months × 2 engineers |
| Multi-user CRDT merge for FeatureTree | Concurrency math is one brain | 2 months × 1 engineer |

### 5.3 Pseudo-serial (small dependencies that ripple)

| Activity | Why ripples | Impact |
|---|---|---|
| UX shell architecture (panel system, menus, shortcuts) | All UI tracks depend on it | Lock by Year 2 Q1 |
| Theming / design tokens | All visual changes propagate | Lock by Year 2 Q1 |
| i18n key conventions | All strings must follow | Already locked |
| Telemetry / event schema | All product analytics depend | Lock by Year 1 Q4 |

**Total serial bottleneck: ~14 months min critical path.**

---

## Section 6 · Concrete Next Week — Parallel Spawn

Translating the above into "what to do Monday morning":

### Spawn plan (Claude Agent threads)

```
Monday morning, spawn 6 concurrent agents:

1. AGENT-A "sketch-trim" — Implement Trim / Extend / Offset tools in SolverSketchEditor.
   Files: src/app/[lang]/shape-generator/sketch/SolverSketchEditor.tsx (+helpers)
   Tests: src/test/sketch/solverSketchEditorTrim.test.tsx
   Estimated: 1 day

2. AGENT-B "part-revolve-ui" — Wire Revolve modal in SolverSketchEditorWithExtrude
   (or new sibling). Use Phase 2.2 revolveProfile IR.
   Files: src/app/[lang]/shape-generator/sketch/RevolveModal.tsx
   Tests: src/test/sketch/revolveModal.test.tsx
   Estimated: 1 day

3. AGENT-C "drawing-svg-renderer" — Convert Phase 4 Sheet IR → SVG component.
   Files: src/app/[lang]/shape-generator/drawing/SheetRenderer.tsx
   Tests: src/test/drawing/sheetRenderer.test.tsx
   Estimated: 1.5 days

4. AGENT-D "step-write-extension" — Extend brep-bridge STEP write to AP214
   assembly hierarchy.
   Files: src/lib/brep-bridge/stepWrite.ts (new) + tests
   Estimated: 2 days

5. AGENT-E "ai-prompt-tuning" — Add multi-turn memory to sketchAssistantLlm
   (system + 2 prior user/assistant turns). Test with mocked chat.
   Files: src/lib/ai/sketchAssistantLlm.ts + test
   Estimated: 0.5 day

6. AGENT-F "test-backfill" — Add tests for SolverSketchEditorWithExtrude
   error paths (rate-limited fetch, empty sketch, large STL).
   Files: src/test/sketch/solverSketchEditorWithExtrude.error.test.tsx
   Estimated: 0.5 day
```

Coordination: main thread reviews each agent's PR-equivalent (a diff + test pass), merges sequentially, hot-fixes conflicts.

### User track (parallel, no code)

```
1. Outreach: 5 Reddit DMs (Day 1 of EXECUTION.md plan)
2. Demo video: 2-min recording of solver page flow
3. Calendly: 3 slots/day × 14 days
4. Browser smoke test on production solver route (5 min)
```

### Total expected end-of-week deliverable

- 6 features advanced (trim/revolve UI/SVG renderer/STEP/AI memory/tests)
- 5+ outreach messages sent
- 1-2 demo calls scheduled
- Production deploys 1-2x (with rollback safety)

---

## Section 7 · Where the Plan Breaks (failure modes)

Reread before each phase. If any of these happen, the parallel plan stops working:

1. **Coordination collapse (>8 agents, founder can't review fast enough)**
   - Symptom: PRs pile up; merges stall; conflicts multiply.
   - Mitigation: cap at 6 agents. Each agent finishes a discrete commit before spawning replacement.

2. **Foundation breakage (planegcs / OCCT / CRDT bug)**
   - Symptom: all dependent tracks fail tests simultaneously.
   - Mitigation: foundation work always has 2-engineer review (or solo + AI review pass). Never merge foundation change on Friday.

3. **Schema drift (IR or native format)**
   - Symptom: agents work against incompatible field assumptions.
   - Mitigation: schema lock in Year 1 Q3. After lock, additions are additive only (no field renames/removals).

4. **AI assistance regression (Claude becomes less capable / API outage)**
   - Symptom: agent thread quality drops; manual rework required.
   - Mitigation: provider chain redundancy. Never have all agents on same provider.

5. **Design partner feedback inverts a roadmap row** (e.g., "we don't need extrude but we need sheet metal")
   - Symptom: months of part-modeling work feels less critical.
   - Mitigation: monthly partner feedback synthesis updates section priority. Don't lock 6-month plans.

6. **Hiring funnel collapse (Series A round happens but can't hire)**
   - Symptom: $5M sits unused while solo grinds continues.
   - Mitigation: build hiring pipeline pre-Series-A. 3 candidates per role identified before raise closes.

---

## Section 8 · How to use this doc

1. **Weekly sprint plan** — choose 6 parallel tracks from Section 2.1 / 4.
2. **Before spawning** — verify no track conflict per Section 2.2 matrix.
3. **Monthly** — measure: did parallel tracks ship at expected % vs serial estimate?
4. **Decision gates** — check Section 5.1 serial bottlenecks. Did the right ones happen on time?
5. **Failure-mode quarterly** — Section 7 review.

---

## Section 9 · References

- Detailed feature spec (the ~1200 atomic features): [SW_FUSION_FEATURE_SPEC_FULL.md](./SW_FUSION_FEATURE_SPEC_FULL.md)
- High-level coverage tracker: [SW_FUSION_FEATURE_SPEC.md](./SW_FUSION_FEATURE_SPEC.md)
- 10-year strategic plan: [SW_FUSION_PARITY_PLAN.md](./SW_FUSION_PARITY_PLAN.md)
- Current build roadmap: [OWN_PRO_CAD.md](../roadmap/OWN_PRO_CAD.md)
- Design partner Week-1 execution: [DESIGN_PARTNER_OUTREACH_EXECUTION.md](./DESIGN_PARTNER_OUTREACH_EXECUTION.md)
- ADR-013 own pro-CAD commit: [../adr/013-own-pro-cad-track.md](../adr/013-own-pro-cad-track.md)
