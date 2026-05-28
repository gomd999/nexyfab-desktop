# Wave 2 — Phase 2 · Master Task Tracker

**Status:** planning / coordination doc — supersedes the per-spec timelines for sequencing only; per-spec docs remain canonical for *technical* detail.
**Date:** 2026-05-28 (Wave 2 Phase 1, Week 4 — end-of-week planning artifact)
**Author:** wave-2 phase-2 coordination
**Risk tier:** P0 (mis-sequencing here cascades into 5 feature streams)
**Budget:** 8 calendar weeks (Month 2-3 per ADR-010 §Phase 2)
**Owner:** solo developer + agent pair (see §9 owner table)

## Inputs consolidated by this tracker

| Spec | Path | Stated timeline | LoC / hour estimate |
|---|---|---|---|
| Configurations | `docs/wave-2-phase-2-configurations-spec.md` | weeks 1-4 (80h, ½ time) | ~80 engineer-hours |
| Sheet Metal | `docs/wave-2-phase-2-sheet-metal-spec.md` | weeks 1-4 (generic) | not LoC-stated — 4 fixtures |
| Hole Wizard | `docs/wave-2-phase-2-hole-wizard-spec.md` | weeks 1-4 (generic) | not LoC-stated |
| Reference Geometry | `docs/wave-2-phase-2-reference-geometry-spec.md` | weeks 1-4 (generic) | not LoC-stated |
| Threads | `docs/wave-2-phase-2-threads-spec.md` | **weeks 5-8** (~6 300 LoC) | ~6 300 LoC over 4 weeks |
| ADR-010 (referenced) | (not yet on disk in `docs/adr/`) | Phase 2 = Month 2-3 | — |
| CRDT architecture | `docs/wave-2-crdt-architecture.md` | continuous (envelope) | — |

> Naive sum: 4×4 + 1×4 = **20 spec-stated feature-weeks**. With one developer at
> Phase 2 capacity this is infeasible at face value. §6 explains the
> consolidation pattern that brings it back to **6-7 weeks of work in the
> 8-week budget** (asset-audit correction below).

---

## 0. TL;DR for the impatient

- **Threads is the only spec that self-positions in weeks 5-8.** All other
  four specs claim weeks 1-4. That is internally inconsistent and the master
  tracker resolves it by interleaving (see §1 matrix).
- **Configurations has a *corruption bug* surface** (`handleConfigurationSelect`
  scene-store mutation) that must land before any other Phase 2 feature
  edits a `.nfab` file — otherwise we risk multiplying the polluted-master
  problem (spec §13.5). **This is the single highest-priority task.**
- **Sheet Metal consolidation is the heaviest "non-feature" cost**: two
  folder namespaces (`sheetmetal/` and `sheet-metal/`) and two material
  catalogues to unify before new code lands. This is mostly bookkeeping
  but blocks Week 2+ delivery.
- **Real expected calendar: 6-7 weeks** for the agent+solo pair given the
  asset audit (existing code is 60-70% of what 4 of the 5 specs need —
  pure greenfield estimate was over-budgeted). Threads is the only true
  ~4-week net-new feature.
- **Two hard external blockers**: (a) occt-worker `src/` materialising
  before Week 1, (b) CRDT Phase 1 scaffolding stable enough for
  ReferenceNode + ConfigurationTable subtree promotion in Week 3-4.

---

## 1. Week × Track Matrix (8 weeks, 5 parallel tracks)

> Cells are work-units; an empty cell means the track is dormant that week.
> `BLOCK` = explicit blocking dependency on another track this week.
> `GATE` = decision point at end of week (see §7).

| Week | Track A (Configurations) | Track B (Sheet Metal) | Track C (Hole Wizard) | Track D (Ref-Geom + Threads) | Track E (Integration / UI / Tests) |
|------|---|---|---|---|---|
| **W1** | **A1.** Corruption fix: remove `handleConfigurationSelect` scene-store mutation. Spike `.nfab` v2→v3 schema. **(HIGH risk, ship first)** | **B1.** Namespace + K-table consolidation (`sheet-metal/` → `sheetmetal/`, `kFactorTable.ts` aliasing). Worker `src/` smoke check. | **C1.** Library extension: M1.6/M2/M2.5/M14/M18/M22/M24/M27/M30 + NPT/BSP rows. ISO/UTS/PIPE export split. | **D1.** Ref-geom: data model (`ReferenceNode` union) + dep solver + cycle detection. Math additions (planeAngleAboutAxis, planeTangentToCylinder). | **E1.** CI matrix verify (Wave 2 burn-in suite still green). Set up `phase-2-burnin/` fixture dir. Daily-standup file. |
| **W2** | **A2.** `ConfigurationTable` class (port `diffConfigs` / `validateModel` from `multiConfigPartVariant`). Unit tests 30+. | **B2.** Worker endpoints `/occt/op/sheetmetal/baseFlange` + `/bend`. Hook material picker. F-SM-01 green. **(BLOCK on worker `src/`)** | **C2.** `holeArray.ts` (multi-position) + worker `/occt/op/hole/drilled` endpoint. F-HW-01 green. Burn-in for N ∈ {1, 4, 8, 16, 32}. | **D2.** Ref-geom UI shell (toolbar dropdown, method-picker dialog), tree integration, .nfab v3 schema + v2 migration. | **E2.** **GATE: §7 mid-Phase-2-quarter check.** A1 merged? B1 consolidated? If no, slip W3 plans. |
| **W3** | **A3.** Pipeline integration: replace `ExpressionEngine` with `positionDrivers`. Wire `useConfigurationTable` into `ShapeGeneratorInner`. Perf regression test (≤50ms p95 / 30-feature part). | **B3.** Multi-bend + `/occt/op/sheetmetal/addFlange`. DFM min-bend-radius warnings. F-SM-02 + F-SM-03 green. | **C3.** Counterbore + Countersink endpoints. Termination tab (blind/through/up-to-next/up-to-face). F-HW-02 + F-HW-02b green. | **D3.** Sketch integration: PlaneRef union, plane-picker rework, visualization. **BLOCK if CRDT Phase 1 unstable — fallback to local-only.** | **E3.** i18n CSV additions (KR canonical, EN sync) for sheet-metal + hole-wizard. |
| **W4** | **A4.** UI Excel-table refactor: expression cells, parent dropdown, `react-window` virtualization. ExpressionVarsPanel. Family Export + CSV BOM. | **B4.** Unfold + DXF flat export. `/occt/op/sheetmetal/unfold`. F-SM-05 + F-SM-04 green. **(HIGH risk — see Risk R-3)** | **C4.** Counterdrill + Tap + sketch-input. F-HW-03 + F-HW-04 green. DFM `TAP_BOTTOM_RISK` gate. | **D4.** Ref-geom korean strings + KS hooks + fixtures 01-05 green. **Ref-geom Phase 2 ship by end W4.** | **E4.** **GATE: §7 mid-Phase-2 check.** Configurations corruption fix verified? Sheet-metal namespace clean? → proceed to W5 second-half. |
| **W5** | **A5.** CRDT integration: Y-backed `ConfigStore`, Y.Doc subtree migration. Multi-client soak (3 users × 5 configs × 10 min). | **B5.** Sheet-metal Korean UI + bend table + auto-drawing. F-SM full set green. **Sheet metal Phase 2 ship by end W5.** | **C5.** Pipe-tap endpoint. Position-tab pattern helpers (linear/rect/circular) + CSV paste. | **D5.** **Threads start.** `threadCatalog.ts` with ISO M coarse/fine + UTS UNC/UNF + NPT + BSP. Cosmetic worker endpoint (metadata-only). | **E5.** Reference geom & sheet-metal regression in unified burn-in. Sentry coverage gaps. |
| **W6** | **A6.** Delete `ConfigurationManager`, `ConfigurationPanel.tsx`, `multiConfigPartVariant.{ts,test.ts}`. Update CRDT arch doc. **Configurations Phase 2 ship by end W6.** | (dormant — sheet-metal shipped W5; absorbed into E for polish) | **C6.** 6-lang i18n + UI polish. `holeMeta` projection. Schema v7→v8 migration. Flag flip `hole_wizard_v2=on`. **Hole-wizard Phase 2 ship by end W6.** | **D6.** Threads UI: hole-wizard section per §10.1 + standalone "Add thread" + edit-in-place + 6-lang. Migration banner. | **E6.** Soak runbook update (`docs/wave-2-soak-runbook.md`) with all five features. |
| **W7** | (dormant — shipped W6) | (dormant) | (dormant) | **D7.** Threads geometric mode: `thread60DegVProfile`, `threadWhitworthProfile`, sweep-with-profile, geometric worker endpoint. Cap warnings + live-drag demotion. | **E7.** Burn-in pass — all five features in one 3-hour soak. Performance regressions logged. |
| **W8** | (dormant) | (dormant) | (dormant) | **D8.** Threads drawing-callout prep (Phase 3 handoff): `formatThreadCallout` extension + `bomAggregation.ts` `threadOps`. **Threads Phase 2 ship by end W8.** | **E8.** **GATE: §7 Phase 2 exit.** All 5 features at shipping quality? → Phase 3 entry. Final integration polish + onboarding tour updates. |

### Reading the matrix

- A track is **shipping-ready** at the row marked "Phase 2 ship". After
  that row it goes dormant in this tracker (regression coverage moves to
  Track E).
- Track A (Configurations) ends at W6 because the CRDT integration step
  (A5) takes the longest tail.
- Track D folds reference-geometry (W1-W4) and threads (W5-W8) into one
  track because they touch overlapping sketch + feature-tree surfaces and
  the same developer should serialise them.

---

## 2. Track Definitions

### Track A — Configurations (P0: corruption fix first)

**Why P0:** the existing host (`ShapeGeneratorInner.tsx:1404-1420` per
configurations spec §1.3) mutates `sceneStore.params` and calls
`updateNode(nodeId, { enabled })` on every config switch. This **pollutes
the master feature tree** with whatever config was last active. Any user
who saves a `.nfab` while a non-master config is selected has *already*
lost their original master values (spec §13.5: "v2→v3 cannot recover").

Until A1 lands, every other Phase 2 feature that touches `.nfab` save/load
risks compounding the damage (sheet-metal v2 SchemaPart, reference-geom v3
schema bump, hole-wizard v7→v8 migration). **A1 is the dependency root.**

Scope: spec §3 (data model), §4 (pipeline integration), §5 (UI),
§6 (worker boundary), §9.4 (Y-backed ConfigStore), §11 (timeline).

### Track B — Sheet Metal (heaviest consolidation)

**Why heavy:** spec §1.1 lists 17 files in `sheetmetal/`, 4 files in
`sheet-metal/` (dashed), and two parallel material catalogues with
incompatible material-id formats. Before any new worker endpoint lands,
this surface must be normalised. The consolidation is **not** delete-and-
rewrite — it is keep-the-math, rename-the-namespace, alias-the-ids. Spec
§1.4 explicitly: "What we keep (don't rewrite)".

External dependency: **occt-worker `src/` directory not on disk** in the
current checkout (spec §1.2). If the worker layer is not online by start
of W1, Week 1 sheet-metal work is blocked on it materialising; the
mitigation is the `sheetMetalV2=true` feature flag (spec §8 W1 risk note).

Scope: spec §2 (data model), §3 (worker API), §5 (unfold), §6 (UI),
§7 (fixtures), §8 (timeline).

### Track C — Hole Wizard (V2 extension)

**Why "extension" rather than "consolidation":** Wave 1 shipped a
single-position hole modal that works. Phase 2 builds **alongside** it
under the `hole_wizard_v2` flag (spec §6.1 W4 flag flip). Less risk to
existing users, more risk to schema migration (v7→v8). The library
extension (W1) is mostly data-table work.

Scope: spec §2 (taxonomy), §3 (standard library), §4 (data model),
§5 (worker API), §6 (UI), §9 (timeline).

### Track D — Reference Geometry + Threads (sketch-touching, serialised)

**Why combined:** reference-geometry spec §10 reworks the sketch
plane-picker; threads spec §10.1 hangs the thread UI off the hole-wizard
which itself uses sketch points. Both reach into `sceneStore` / sketch
node data. **Doing them in parallel risks merge conflicts in the same
files.** Serialised on the same track, with ref-geom finishing W4 and
threads kicking off W5, lets the same dev hold the mental model.

Scope: spec §15 (ref-geom timeline), spec §15 (threads timeline weeks 5-8).

### Track E — Integration / UI Polish / Tests / Korean

A meta-track. No new feature code; the work is i18n CSV additions
(KR/EN/JA/ZH/ES/AR — six languages per project policy), soak-runbook
updates, burn-in regression catches, Sentry dashboard tuning, onboarding
tour edits. Slots in around the four feature tracks rather than blocking
them.

---

## 3. Weekly Breakdown — Per Track

### Track A — Configurations (8-week, ship by W6)

| Week | Tasks (spec ref) | Hours | Risk | Tests? |
|------|---|---|---|---|
| W1 | **A1.** Remove `handleConfigurationSelect` mutation (spec §3, §4.1). `.nfab` v2→v3 schema + `migrateV2ToV3` (spec §11 W1). Fixture round-trip. | 14 | **HIGH** (regression on existing files) | Yes — 6 fixtures |
| W2 | **A2.** Implement `ConfigurationTable` class. Port `diffConfigs` / `validateModel` from `multiConfigPartVariant.ts`. Cycle detection, resolution order tests. | 16 | Med | Yes — 30+ unit |
| W3 | **A3.** Replace `ExpressionEngine` with `positionDrivers`. Wire `useConfigurationTable` in host. Pipeline integration (spec §11 W2). Perf p95 ≤ 50ms. | 18 | Med (perf cliff possible) | Yes — perf regression |
| W4 | **A4.** UI Excel table v2 (spec §11 W3). Expression cells, parent dropdown, `react-window`. ExpressionVarsPanel + Family Export + CSV BOM + i18n 6-lang. | 22 | Low (UI only) | Yes — Playwright |
| W5 | **A5.** Y-backed `ConfigStore` (spec §11 W4). Multi-client soak 3×5×10 min. CRDT divergence test. | 18 | **HIGH** (CRDT subtle bugs) | Yes — soak run |
| W6 | **A6.** Cleanup deletes (spec §11 W4 last block). CRDT arch doc update. Final fixture regression. | 8 | Low | Yes — final regression |

**Track A total: ~96 hours** (configurations spec stated 80h at ½ time;
the +16h is the corruption-fix safety pass that the spec underestimates).

### Track B — Sheet Metal (5-week, ship by W5)

| Week | Tasks (spec ref) | Hours | Risk | Tests? |
|------|---|---|---|---|
| W1 | **B1.** Namespace consolidation `sheet-metal/` → `sheetmetal/`. Delete `kFactorTable.ts`. Alias old material-id format. Worker `src/` directory presence smoke check. | 12 | Med (file moves break imports) | Yes — unit suite still green |
| W2 | **B2.** Worker `/occt/op/sheetmetal/baseFlange` + `/bend` (spec §3.2, §3.4). Material picker → worker payload. F-SM-01 fixture. **`sheetMetalV2=true` flag.** | 22 | **HIGH** (worker side new) | Yes — F-SM-01 |
| W3 | **B3.** `/occt/op/sheetmetal/addFlange` (spec §3.3). Multi-bend ordering. DFM warnings. F-SM-02 + F-SM-03. | 20 | Med | Yes — 2 fixtures |
| W4 | **B4.** `/occt/op/sheetmetal/unfold` (spec §3.5, §5). Topology unfold. DXF flat export (`analysis/flatPatternDrawing.ts` bridge). F-SM-05 + F-SM-04. | 26 | **HIGH** (B-Rep topology walk; see Risk R-3) | Yes — 2 fixtures |
| W5 | **B5.** Korean UI right pane (spec §6.3). Bend table dock. Auto-drawing PDF pipeline. i18n keys (`절곡선`, `전개도`, `K-팩터`). Onboarding tour step. | 14 | Low | Yes — Playwright |

**Track B total: ~94 hours.**

### Track C — Hole Wizard (6-week, ship by W6)

| Week | Tasks (spec ref) | Hours | Risk | Tests? |
|------|---|---|---|---|
| W1 | **C1.** Extend `holeStandards.ts` with KS B 0201 + ISO 273 + ANSI new + PIPE rows. Fit-class fields. Three-file split per spec §3.4. | 8 | Low | Yes — table unit |
| W2 | **C2.** `features/holeArray.ts` (multi-position). Worker `/occt/op/hole/drilled` (fuse + cut). HoleWizardModalV2 skeleton (Type + Size + Position tabs). Burn-in N∈{1,4,8,16,32}. ADR-009 capacity update if needed. F-HW-01 green. | 22 | Med (burn-in numbers) | Yes — F-HW-01 + burn-in |
| W3 | **C3.** Counterbore + Countersink endpoints. Termination tab wired (blind/through/up-to-next/up-to-face). Cross-section preview (Tab 5). F-HW-02 + F-HW-02b. | 20 | Med | Yes — 2 fixtures |
| W4 | **C4.** Counterdrill + Tap endpoints. `positionMode='fromSketch'` path. Sketch↔Hole bidirectional propagation. DFM `TAP_BOTTOM_RISK`. F-HW-03 + F-HW-04. | 22 | Med | Yes — 2 fixtures |
| W5 | **C5.** Pipe-tap endpoint. Linear/rect/circular pattern helpers. CSV paste. F-HW-05 green. | 16 | Low | Yes — F-HW-05 |
| W6 | **C6.** 6-lang i18n full pass. `holeMeta` projection. Schema v7→v8 migration. Flag flip `hole_wizard_v2=on`. F-HW-AGG-01 burn-in (3.0s GA gate). | 14 | Med (schema migration) | Yes — migration + agg |

**Track C total: ~102 hours.**

### Track D — Reference Geometry → Threads (8-week, ref-geom ships W4, threads ships W8)

| Week | Tasks (spec ref) | Hours | Risk | Tests? |
|------|---|---|---|---|
| W1 | **D1.** Ref-geom data model (`ReferenceNode` union per spec §6.1). Dep solver + cycle detection (spec §7). Math additions (spec §11.1, §11.2). | 18 | Med (dep-solver loops) | Yes — Vitest math |
| W2 | **D2.** Ref-geom UI shell (toolbar dropdown + method-picker dialog per spec §13). Tree integration. `.nfab` v3 schema bump + v2 migration. | 16 | Med (schema collides with Configurations v3) | Yes — migration round-trip |
| W3 | **D3.** Ref-geom sketch integration (PlaneRef union per spec §6.3, §10). Plane-picker rework. Visualization (Three.js, spec §8). | 18 | **HIGH** (CRDT readiness BLOCK per spec §15) | Yes — Fixtures 01-05 |
| W4 | **D4.** Korean strings + KS A/B hooks + fixtures 06-10. Performance pass (100-ref stress, spec §8.5). Phase 3 assembly-mate API surface (no impl). | 14 | Low | Yes — fixtures 06-10 |
| W5 | **D5. Threads start.** `threadCatalog.ts` (5 tables — ISO M coarse/fine, UTS UNC/UNF, NPT, BSP). `ThreadFeature` type. Cosmetic worker endpoint (metadata-only, no geometry). Catalog unit tests. | 16 | Low | Yes — catalog unit |
| W6 | **D6.** Hole-wizard threads section (spec §10.1). Standalone "Add thread" (spec §10.2). Edit-in-place (spec §10.3). 6-lang per §10.5. Magenta dashed-circle viewport hint. | 18 | Med (UI integration with hole-wizard W6) | Yes — UI Playwright |
| W7 | **D7.** Threads geometric mode (spec §15 W3). Profile builders, sweep-with-profile, geometric worker endpoint. Cap warnings (§8.1), live-drag demotion (§11.2). All §13.1/§13.2 fixtures. | 24 | **HIGH** (geometry-heavy; ~2 500 LoC + 600 LoC OCCT bindings — by far the largest single PR in Phase 2) | Yes — §13.1 + §13.2 |
| W8 | **D8.** `formatThreadCallout` extension. `bomAggregation.ts` `threadOps`. ISO 6410-1 dashed-line rep (Phase-3-gated). STEP round-trip fixture. | 12 | Low | Yes — STEP round-trip |

**Track D total: ~136 hours.** Threads alone is ~70h (W5-W8); ref-geom is
~66h (W1-W4).

### Track E — Integration / UI / Tests (all 8 weeks)

| Week | Tasks | Hours | Risk |
|------|---|---|---|
| W1 | CI matrix verify (Wave 2 burn-in still green). `phase-2-burnin/` fixture dir. Daily-standup file at `docs/wave-2-phase-2-standup.md`. | 6 | Low |
| W2 | Mid-quarter gate check (§7). Standup audit. | 4 | Low |
| W3 | i18n CSV additions for sheet-metal + hole-wizard tracks. KR canonical + EN sync. | 6 | Low |
| W4 | Mid-Phase-2 gate check (§7). Configurations corruption verification (load 6 fixtures, deep-equal). | 6 | Med |
| W5 | Ref-geom + sheet-metal regression in unified burn-in suite. Sentry coverage gap review. | 6 | Low |
| W6 | Soak runbook (`docs/wave-2-soak-runbook.md`) updated for all 5 features. | 5 | Low |
| W7 | Burn-in: all 5 features in one 3-hour soak run. Performance regressions logged. | 8 | Med |
| W8 | Phase 2 exit gate (§7). Final integration polish, onboarding tour updates. | 8 | Low |

**Track E total: ~49 hours.**

---

## 4. Dependency Graph

```
              ┌──────────────────────────────┐
              │  occt-worker src/ on disk    │ ← EXTERNAL pre-req for W1
              └─────────────┬────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────┐
          │  A1 corruption fix (Configurations) │ ← P0 — blocks all .nfab edits
          └─────────────┬───────────────────────┘
                        │
        ┌───────────────┼─────────────────┬──────────────────┐
        ▼               ▼                 ▼                  ▼
    B1 namespace    C1 standards      D1 ref-geom model    E1 burn-in
    consolidate     library extend
        │               │                 │                  │
        ▼               ▼                 ▼                  │
    B2 baseFlange   C2 holeArray      D2 ref-geom UI         │
    + bend                                                   │
        │               │                 │                  │
        ▼               ▼                 ▼                  │
    B3 addFlange    C3 cbore/csk      D3 sketch integ        │
    + DFM                              ┌──┴──┐               │
        │               │              │  CRDT Phase 1  │ ← W3 SOFT BLOCK
        ▼               ▼              └──┬──┘               │
    B4 unfold       C4 cdrill/tap         ▼                  │
    + DXF           + sketch-input    D4 KS + fixtures       │
        │               │                 │                  │
        ▼               ▼                 ▼                  │
    B5 KR UI ✓SHIP  C5 pipe-tap       D5 thread catalog      │
                        │                 │                  │
                        ▼                 ▼                  │
                    C6 i18n + flag    D6 threads UI ─┐       │
                    ✓SHIP                            │       │
                                                     │       │
              A2-A6 (independent of B/C/D after A1)  │       │
                    │                                 ▼      │
                    ▼                              D7 geom   │
              ✓SHIP A end W6                      thread  ◄──┘ HIGH risk W7
                                                     │
                                                     ▼
                                                  D8 drawing
                                                  hook ✓SHIP

       (all tracks feed Track E continuously)
```

### Conflict surfaces (where two tracks touch the same code)

| File / surface | Tracks colliding | When | Mitigation |
|---|---|---|---|
| `nfabFormat.ts` schema (v3 bump) | A (Configurations) + D (Ref-Geom) + C (Hole-Wizard v7→v8) | W1-W2 | **Single schema-version PR landed first by A**, then C and D extend within the same v3 envelope (no parallel v3 bumps). |
| `sceneStore.ts` / `useFeatureStack` | A (config switch) + D (sketch plane) | W2-W3 | Track A removes mutation first; Track D extends `sketchPlane` field to PlaneRef union *after* A's removal. |
| Sketch plane-picker UI | D (ref-geom plane picker) + ? | W3 | Single owner: same dev does ref-geom AND threads → no parallel sketch edits. |
| `applyFeatureContext` | A (config resolver) + D (threads if feature-tree-resident) | W3, W6 | A's resolver runs before D's thread features (insertion order in pipeline). |
| i18n CSV | All tracks | continuous | Track E owns merges; per-track adds rows but doesn't reorganise the CSV. |
| occt-worker route table | B, C, D | W2-W7 | Each track adds new `/occt/op/*/...` routes — non-overlapping namespaces. |

---

## 5. Task Specifications (canonical)

Each task referenced in the matrix below. Use this as the source of truth
when opening PRs; the spec docs remain canonical for *technical* detail.

> Format: **ID** | name | spec ref | hours | dep | assignable | risk | tests

| ID | Task | Spec § | Hours | Dependency | Assignable | Risk | Test |
|---|---|---|---|---|---|---|---|
| **A1** | Remove `handleConfigurationSelect` mutation + `.nfab` v3 schema | configurations §3, §4.1, §11 W1 | 14 | occt-worker `src/` present | **user** (load-bearing) | HIGH | 6 fixture round-trip |
| **A2** | `ConfigurationTable` class + port `diffConfigs`/`validateModel` | configurations §3, §11 W1 | 16 | A1 | agent | Med | 30+ unit |
| **A3** | Pipeline wire + perf p95 ≤ 50ms | configurations §11 W2 | 18 | A2 | either | Med | perf regression |
| **A4** | Excel-table v2 UI + ExpressionVarsPanel + Family Export + i18n | configurations §5, §11 W3 | 22 | A3 | agent | Low | Playwright |
| **A5** | Y-backed `ConfigStore` + CRDT subtree migration + soak | configurations §9.4, §11 W4 | 18 | A4 + CRDT Phase 1 stable | **user** | HIGH | soak 3×5×10 min |
| **A6** | Cleanup deletes + CRDT arch doc update | configurations §11 W4 last | 8 | A5 | agent | Low | final regression |
| **B1** | Namespace + K-table consolidation | sheet-metal §1.1, §1.2 | 12 | — | agent | Med | unit suite green |
| **B2** | Worker baseFlange + bend + material picker + F-SM-01 | sheet-metal §3.2, §3.4, §8 W1 | 22 | B1 + occt-worker `src/` | **user** (worker boundary) | HIGH | F-SM-01 |
| **B3** | addFlange + multi-bend + DFM | sheet-metal §3.3, §8 W2 | 20 | B2 | either | Med | F-SM-02 + F-SM-03 |
| **B4** | Unfold + DXF | sheet-metal §3.5, §5, §8 W3 | 26 | B3 | **user** (B-Rep topology) | HIGH | F-SM-05 + F-SM-04 |
| **B5** | Korean UI + bend table + auto-drawing | sheet-metal §6, §8 W4 | 14 | B4 | agent | Low | Playwright |
| **C1** | Library extension (KS + ANSI + PIPE) | hole-wizard §3, §9 W1 | 8 | — | agent | Low | table unit |
| **C2** | holeArray + drilled endpoint + burn-in N∈{1..32} | hole-wizard §4, §9 W1 | 22 | C1 + occt-worker `src/` | **user** (burn-in numbers) | Med | F-HW-01 + burn-in |
| **C3** | Counterbore + Countersink + Termination | hole-wizard §9 W2 | 20 | C2 | either | Med | F-HW-02 + F-HW-02b |
| **C4** | Counterdrill + Tap + sketch input + DFM | hole-wizard §9 W3 | 22 | C3 | either | Med | F-HW-03 + F-HW-04 |
| **C5** | Pipe-tap + pattern helpers + CSV paste | hole-wizard §9 W4 | 16 | C4 | agent | Low | F-HW-05 |
| **C6** | 6-lang i18n + holeMeta + v7→v8 migration + flag flip | hole-wizard §9 W4 last | 14 | C5 | **user** (schema flip) | Med | migration + AGG |
| **D1** | Ref-geom model + dep solver + math additions | ref-geom §6, §7, §11 | 18 | — | either | Med | Vitest math |
| **D2** | Ref-geom UI shell + tree + .nfab v3 (shared with A1) | ref-geom §13, §15 W2 | 16 | A1 (v3 schema) + D1 | agent | Med | migration round-trip |
| **D3** | Sketch integration + plane-picker rework + visualization | ref-geom §6.3, §8, §10 | 18 | D2 + CRDT stable | **user** (sketch surface) | HIGH | Fixtures 01-05 |
| **D4** | Korean strings + KS hooks + fixtures 06-10 + perf | ref-geom §13.4, §13.5, §15 W4 | 14 | D3 | agent | Low | Fixtures 06-10 |
| **D5** | Thread catalog + cosmetic endpoint | threads §15 W1 | 16 | D4 | agent | Low | catalog unit |
| **D6** | Threads hole-wizard section + standalone + edit-in-place + 6-lang | threads §10, §15 W2 | 18 | D5 + C6 (hole-wizard flag) | agent | Med | UI Playwright |
| **D7** | Geometric mode: profiles + sweep + boolean + entry chamfer | threads §15 W3 | 24 | D6 | **user** (geometry-heavy, largest PR) | HIGH | §13.1 + §13.2 |
| **D8** | Drawing-callout extension + BOM threadOps + STEP round-trip | threads §15 W4 | 12 | D7 | agent | Low | STEP round-trip |
| **E1-E8** | Integration / burn-in / soak / Korean | (per matrix §3) | 49 total | continuous | mostly agent | Low-Med | various |

### Total estimated hours

- Track A: 96h
- Track B: 94h
- Track C: 102h
- Track D: 136h (ref-geom 66h + threads 70h)
- Track E: 49h
- **Grand total: 477 engineer-hours**

### Calendar fit

- 8 weeks × 5 weekdays × 6 hours/day (sustainable solo pace, not 8h burn-out
  pace) = **240 hours of dev capacity**.
- Solo dev cannot deliver 477h in 8 weeks. **This is why the agent pair
  matters** — agent absorbs ~50% of medium/low-risk tasks (estimated 200h
  agent throughput per 8 weeks), leaving ~277h for the solo dev. Still
  37h over the 240h dev capacity.
- §6 asset-audit correction: 30-50% of the *spec-estimated* hours are
  already implemented (per spec §1.4 "what we keep" notes). Real
  net-new dev work is roughly **(477 × 0.65) ≈ 310h**, of which agent
  absorbs ~130h. Solo dev: ~180h, fits in 240h budget with headroom.

---

## 6. Total Estimate — Asset Audit Correction

Each spec has a §1 audit ("what exists today / what doesn't"). The
multiplier is per-track:

| Track | Spec naive estimate | What exists | Correction | Net dev |
|---|---|---|---|---|
| A Configurations | 80h | `NfabConfigurationV1` schema + `ConfigurationManager` (dead-code class, 11 tests pass) + `ConfigurationTable.tsx` UI skeleton + `multiConfigPartVariant.ts` 3rd impl + `equationManager.ts` expression engine | ~50% exists (need consolidation, not greenfield) | **~48-64h** (within 96h budget; 32h slack absorbs corruption-fix safety) |
| B Sheet Metal | (not stated) | `sheetMetal.ts` 826 LoC (Three.js path) + `sheetMetalTables.ts` 400 LoC + 17 files in `sheetmetal/` + 4 in `sheet-metal/` + `flatPatternDrawing.ts` 150 LoC | ~60% exists (Three.js path), 0% OCCT path | **~70h** OCCT new + 24h consolidate (within 94h) |
| C Hole Wizard | (not stated) | `features/hole.ts` single-position + `holeStandards.ts` partial library + `HoleWizardModal.tsx` v1 + OCCT boolean engine | ~40% exists (V1 single-position works) | **~80h** V2 net-new (within 102h budget) |
| D Ref-Geom + Threads | (4w + 4w naive) | Ref-geom: `referenceGeometry.ts` math helpers only (unused). Threads: helix sampler + sweep + ThreadCallout annotation + METRIC_COARSE_PITCHES + formatThreadCallout | Ref-geom ~25% (math only, no node/UI/dep-solver). Threads ~30% (cosmetic infra exists, no feature-node/geometry/full catalog) | **~50h ref-geom + ~70h threads = 120h** (within 136h budget) |
| E Integration | — | i18n CSV + soak runbook + burn-in fixtures exist | ~70% exists | **~30h** active maintenance (within 49h) |
| **TOTAL** | — | — | — | **~310-330h** |

### Bottom-line calendar estimate

- **6-7 weeks** of *focused* solo+agent work fits in the **8-week budget**.
- The 1-2 week slack is intentional and absorbs:
  - Unfold B-Rep topology walk failure (Risk R-3) → fall back to spec stopgap.
  - CRDT Phase 1 readiness slip → fall back to local-only ref-geom.
  - Threads geometric mode failure (Risk R-4) → fall back to cosmetic-only Phase 2 ship.
- **Decision rule:** if at the end of W4 gate, we have used 4 full weeks
  on Track A + Track B alone (i.e. spec-bound naive pace), trigger the
  reversal floor — descope §16 / §13 / §9 items per each spec.

---

## 7. Decision Points (Phase 2 mid-review gates)

### Gate at end W2 (sanity check, not a stop-go)

Questions:
- A1 corruption fix merged + 6 fixture round-trip passing?
- B1 namespace consolidation complete (no import errors across `pnpm
  build`)?
- C1 library extension landed (table unit tests pass)?
- D1 ref-geom model + dep solver merged?
- Has occt-worker `src/` materialised? If not, B2 + C2 + D2 are at risk
  → flip `sheetMetalV2 / hole_wizard_v2` flags off and continue
  client-side-only.

Output: 1-page gate memo at `docs/wave-2-phase-2-w2-gate.md` (1 hour).

### Gate at end W4 (mid-Phase-2 stop-go)

**This is the major checkpoint.** Questions:
- A1-A4 done? Specifically: Configurations corruption fix verified in
  the field (load 6 .nfab fixtures, deep-equal post-migration)?
- B1-B4 done? Specifically: sheet-metal namespace consolidate complete +
  unfold working on F-SM-05?
- D1-D4 done? Specifically: ref-geom shippable as a standalone feature?
- Cumulative burn-in: do *all five* features in their current state pass
  in one 3-hour soak?

If YES → proceed to W5 second half (Track A finish, Sheet-metal Korean
UI ship, threads start).
If NO → **descope decision tree**:
  1. Slip Threads geometric mode (D7) to Phase 2.5 — ship cosmetic-only.
  2. Slip Sheet Metal unfold (B4) — ship without DXF flat export, surface
     "manual flatten" message in UI.
  3. Slip Ref-Geom Sketch integration (D3) — ship plane / axis / point /
     CSys as feature-tree entities but keep the existing 3-plane sketch UI.
  4. **Never slip A1.** The corruption fix must ship even if everything
     else slips.

Output: 2-page gate memo at `docs/wave-2-phase-2-w4-gate.md` (2 hours).

### Gate at end W8 (Phase 2 exit)

**Mandatory go/no-go for Phase 3 entry.** Questions:
- All 5 modeling features shipping-quality? Specifically:
  - Configurations: family-export 4 STEP files in zip, soak 30 min clean.
  - Sheet Metal: 5 fixtures green, DXF passes Korean partner pricebook layer convention.
  - Hole Wizard: 6 fixtures + F-HW-AGG-01 burn-in passes 3.0s GA gate.
  - Ref-Geom: fixtures 01-09 green, ADR-011 published.
  - Threads: §13.1 + §13.2 fixtures green, STEP round-trip clean.
- Korean UI: all `절곡선`, `전개도`, `K-팩터`, `구멍`, `나사`, `참조평면`
  strings in i18n CSV.
- Soak: 3-hour run with all 5 features active.
- Sentry: < 5% failure rate on each `*.failure_rate` channel.

If YES → Phase 3 starts (drawing module, assembly Phase 3).
If NO → **Phase 2.5 buffer (2 weeks)**. Triage which features to ship-flag-off vs.
descope vs. push to Phase 3.

Output: 4-page exit memo at `docs/wave-2-phase-2-exit.md` (4 hours).

---

## 8. Risk Register

| # | Risk | Track | Severity | Trigger condition | Response | Reversal floor |
|---|---|---|---|---|---|---|
| **R-1** | occt-worker `src/` not on disk by W1 start (sheet-metal spec §1.2) | B, C, D | **HIGH** | `ls occt-worker/src/` empty at W1 Mon | Block all `/occt/op/*` work this week. Continue with client-only mocks. Slip W1 → W5 (sheet-metal spec §8 buffer note). | Ship Phase 2 with all worker endpoints stubbed; flip `sheetMetalV2=false`, `hole_wizard_v2=false`; only Configurations + Ref-Geom ship. |
| **R-2** | `.nfab` v3 schema collision (A vs C vs D each bump version independently) | A, C, D | **HIGH** | Two tracks land conflicting v3 PRs in same week | Track A owns the schema-version master PR; C uses v8 (which is the same v3 envelope for hole features); D extends within v3 envelope. **Coordination through E2 gate.** | If collision unrecoverable, force a v3 → v4 fast-follow PR by Track A; mark all v3 files as transitional. |
| **R-3** | Sheet-metal unfold B-Rep topology walk fails on real parts (sheet-metal §5.2 `UNFOLD_CYCLIC` / `UNFOLD_SELF_INTERSECT`) | B | **HIGH** | F-SM-04 / F-SM-05 fail in W4 | Fall back to existing **1-D arc-length unfold** (current `flatPatternDrawing.ts`). Ship Phase 2 with only L-bracket (F-SM-01) + U-channel (F-SM-02) + hat (F-SM-03) fixtures green. | Sentry breadcrumb on `UNFOLD_CYCLIC` rate > 5%, weekly digest via `sendOpsAlert`. |
| **R-4** | Threads geometric mode crashes OCCT (threads §7) | D | **HIGH** | D7 W7 fixtures fail or OOM | **Defer geometric mode to Phase 2.5.** Phase 2 ships cosmetic-only. The wizard still works; the magenta dashed circle shows; the BOM still emits `THREAD OPERATIONS`. | Cosmetic-only is fully usable for partners; we lose the "we ship geometric threads in browser" demo but not the manufacturing pipeline. |
| **R-5** | CRDT Phase 1 scaffolding unstable at W3 (ref-geom §15 hard dependency) | A, D | Med | Concurrent-edit fixture diverges | Track D ships ref-geom in **local-only** mode (no Y.Map backing). Track A ships configurations with Y-backed store gated behind `crdtConfigsV1=false` flag; flip on in Phase 2.5. | Solo-edit fallback: `crdtMode = 'solo-only'` flag — collab features stay accessible but show "this doc is solo-edit until CRDT stabilises" toast. |
| **R-6** | Schema migration `v7 → v8` (hole-wizard §11 risk) corrupts pre-Phase-2 files | C | **HIGH** | C6 W6 fixture round-trip fails | Round-trip test on every fixture in `__tests__/migrations/`. Offer "revert" within 30 days via `.nfab.bak` sidecar. Postpone flag flip 1 week. | Keep `hole_wizard_v2=false` as default. V1 path remains canonical; V2 ships behind opt-in flag for early adopters. |
| **R-7** | i18n CSV drift across 6 languages × 5 features (×~50 new strings each) | E | Low | i18n drift detector flags > 10 untranslated keys at W7 | Korean canonical → EN sync → JA/ZH/ES/AR translation pass (1-day burst per language). | Ship Phase 2 with KR + EN only on new strings; AR/ES marked `[machine-translated]` with banner. |
| **R-8** | Solo dev burn-out (8 weeks of P1 features in a row) | all | Med | Standup file shows 3+ consecutive "stuck / avoiding" entries | Slip W7 onto W9 buffer. Take a 3-day pause. **No heroics on the Phase 2 exit gate.** | Phase 2.5 is the official buffer (2 weeks); use it. |
| **R-9** | Agent throughput lower than 200h/8w estimate | all | Med | At W4 gate, agent-completed task list < 30% of expected | Re-balance: more low-risk tasks to agent, fewer touchpoints on critical paths. User absorbs more medium-risk work. | If chronic, drop Track E's polish work; ship with rough edges, fix in Phase 2.5. |
| **R-10** | Performance regression from feature-tree bloat (5 features × N nodes) | all | Med | Burn-in p95 rebuild time creeps past Wave 2 budget | Profile after W4 + W7 burn-ins. Worst-case: ship with feature-tree node count cap (warn at 200 nodes). | Re-baseline Wave 2 perf budget in soak runbook with documented "Phase 2 added N% on average". |

---

## 9. Owner Table

| Task | Owner (this turn) | Owner (next turn) | User review time est. | Notes |
|------|---|---|---|---|
| **A1** corruption fix | **user** | — | 2h (design review + fixture audit) | Load-bearing; user reviews fixture round-trip evidence before merge. |
| A2 ConfigurationTable class | agent | user (review) | 1h | Port from existing `multiConfigPartVariant.ts`, well-tested target. |
| A3 pipeline wire + perf | both | — | 2h (perf eyeballs) | Hand-off after pipeline wired; user runs perf bench. |
| A4 UI Excel v2 | agent | user (UX) | 2h (UX click-through) | Largely mechanical; user verifies Korean labels. |
| **A5** CRDT subtree migration + soak | **user** | — | 4h (soak run + divergence inspect) | Soak run requires hands-on. |
| A6 cleanup deletes | agent | user (final review) | 1h | Touch a lot of files; user audits delete list. |
| **B1** namespace consolidate | **user** | — | 2h (build verification across 6 deploy targets) | Import paths everywhere; user owns this. |
| B2 baseFlange + bend worker | **user** | — | 3h (worker boundary, OCCT new) | First Phase 2 worker endpoint; sets pattern. |
| B3 addFlange + DFM | both | user (review) | 1h | Pattern set by B2; agent extends. |
| **B4** unfold + DXF | **user** | — | 4h (B-Rep topology walk; HIGH risk) | Per Risk R-3 the rollback floor matters. |
| B5 Korean UI + bend table | agent | user (UX) | 2h (Korean strings + onboarding tour) | KR canonical, agent translates after. |
| C1 library extension | agent | user (review) | 1h | Pure data; user audits KS B 0201 values. |
| **C2** holeArray + burn-in | **user** | — | 3h (burn-in numbers; ADR-009 update) | First fuse-cut worker pattern; sets benchmark. |
| C3 cbore + csk + Termination | both | user (review) | 1h | Pattern set by C2. |
| C4 cdrill + tap + sketch input | both | user (sketch surface review) | 2h | Sketch ↔ Hole bidirectional propagation; subtle. |
| C5 pipe-tap + pattern helpers | agent | user (review) | 1h | Mechanical extension. |
| **C6** v7→v8 migration + flag flip | **user** | — | 3h (schema migration round-trip) | Per Risk R-6; cannot be agent-owned. |
| D1 ref-geom model + dep solver | both | user (review) | 2h (cycle detection edge cases) | Math + dep-solver is a known shape; agent can scaffold, user reviews edges. |
| D2 ref-geom UI shell + tree | agent | user (UX) | 2h | UI; user verifies tree integration UX. |
| **D3** sketch integration | **user** | — | 4h (sketch surface; HIGH risk) | Touches `sceneStore`; user holds mental model. |
| D4 KS hooks + perf | agent | user (perf eyeballs) | 1h | Perf pass; user runs 100-ref stress. |
| D5 thread catalog | agent | user (review) | 1h | Pure data; user audits KS B 0201 values. |
| D6 threads hole-wizard section | both | user (review) | 2h (UI integration with C6) | Hand-off coordinated with Track C. |
| **D7** threads geometric mode | **user** | — | 5h (geometry-heavy, largest PR; Risk R-4) | User cannot delegate; OCCT bindings + boolean fragility. |
| D8 drawing callout + BOM | agent | user (final review) | 1h | Mechanical extension; user runs STEP round-trip. |
| E1-E8 integration | mostly agent | user (gate reviews) | 1h/week (8h total) | Gates at W2/W4/W8 are user-owned. |

### User attention summary

| Block | User hours |
|---|---|
| Critical-path tasks (bolded above) | ~32h |
| Code review + UX click-throughs | ~25h |
| Gate memos (W2 + W4 + W8) | ~7h |
| Soak runs + burn-in inspection | ~12h |
| **Total user attention over 8 weeks** | **~76h** |
| **User per-week attention** | **~9.5h/week** |

This is *review + verify + critical-path code* time. The agent absorbs
~200h of execution work. Net solo-dev time: 76h user critical + ~280h
execution = manageable in 8 weeks at sustainable pace.

---

## 10. Daily Standup Template (solo dev self-check)

File: `docs/wave-2-phase-2-standup.md` (append-only, one block per day).

```markdown
## YYYY-MM-DD (Week N, Day M)

### Yesterday
- [task ID] — what shipped / merged / broke
- [task ID] — partial; where I left off

### Today
- [task ID] — concrete deliverable by EOD
- [task ID] — if-time stretch

### Blocked / stuck
- [reason] — what I tried, why it failed, who/what unblocks
- (if nothing blocked: "none")

### Burn-out signals (1-5 scale; >3 anywhere = take 24h off)
- Sleep last night: __h (3 = <6h, 5 = <4h)
- Irritation level: __  (1 = calm, 5 = snapping at machines)
- Avoidance — am I procrastinating on a known-hard task? Y/N
- Body — back/neck/eyes complaining? Y/N

### Tomorrow plan
- One thing I will do first.

### Gate-tracking
- Week-N gate criteria progress: __ / __
```

**Rule:** any single day with 3+ burn-out signals at 4-5 → mandatory
24h off + re-estimate the active task. Per Risk R-8.

**Rule:** any 3 consecutive days marked "blocked" on the same task →
escalate to either: descope (drop from the spec), park (move to Phase 2.5
buffer), or ask for review help (user vs agent flip).

---

## 11. Track-level kickoff sequence (week-by-week)

This is the *suggested* execution order if everything goes nominal.

**Week 1 (Mon)**
- Verify occt-worker `src/` on disk. If absent, file the blocker.
- Kick off A1 (user starts), B1 (agent starts in parallel), C1 (agent
  parallel), D1 (user starts, agent assists).
- Track E creates standup file + burn-in fixture dir.

**Week 2 (Mon)**
- Verify A1 merged. If not, **stop B2 / C2 / D2 starts** until A1 lands
  (corruption-fix-before-edit rule).
- Kick off A2, B2 (user owns worker boundary), C2 (user owns burn-in),
  D2 (agent + user UI review).

**Week 3 (Mon)**
- Verify CRDT Phase 1 status. If unstable, flip D3 to local-only mode.
- Kick off A3, B3, C3, D3.

**Week 4 (Mon)**
- Run W4 gate (§7) before kicking off W4 tasks.
- Either proceed full speed (A4, B4, C4, D4) or descope per gate output.

**Week 5 (Mon)**
- Verify all of Track-A-1-4 + Track-B-1-3 + Track-C-1-3 + Track-D-1-4 done.
- Kick off A5 (CRDT soak — user-heavy), B5 (Korean UI), C5 (pipe-tap),
  D5 (threads start).

**Week 6 (Mon)**
- A6 cleanup deletes, C6 flag flip + i18n, D6 threads UI.
- Ship: Configurations, Sheet Metal, Hole Wizard.

**Week 7 (Mon)**
- D7 threads geometric mode (the biggest single PR of Phase 2).
- Track E unified 3-hour soak.

**Week 8 (Mon)**
- D8 drawing callout + BOM + STEP round-trip.
- E8 exit gate (§7).
- Phase 2 exit memo published.

---

## 12. Out of Scope (Phase 3 / 4 / Wave 3 hand-offs)

Each spec lists its own out-of-scope; this is the consolidated view for
Phase 3 planning.

| Item | Source spec | Target wave/phase |
|---|---|---|
| Drawing-side hole callout `M8×20 ⌴ 13×6.5` rendering | hole-wizard §10 | Phase 3 (drawing module) |
| Reference-geom-aware assembly mates | ref-geom §16 (#4) | Phase 3 (assembly Phase 3) |
| Hem (180° bend) as first-class feature with HEM DXF layer | sheet-metal §9.1 | Wave 2 late |
| Tab + slot auto-mating between SheetMetalParts | sheet-metal §9.1 | Wave 2 (after assembly) |
| Configurable assembly mates | configurations §14 | Phase 3+ |
| Design tables linked to external Excel/CSV | configurations §14 | Phase 3+ |
| Acme / trapezoidal threads (lead screws) | threads §16 #3 | Phase 3 candidate |
| Curved bend (roll bending) | sheet-metal §9.2 | Wave 3 |
| Helicoil / threaded insert representation | threads §16 #2 | future-reserved field, Phase 3+ |
| Tangent plane to free-form B-spline surface | ref-geom §16 #1 | Wave 3 |
| Reference geometry on sheet-metal flat patterns | ref-geom §16 #5 | Phase 4 |
| STEP AP242 extended attributes for ref-geom | ref-geom §16 #7 | Phase 4 (STEP writer pass) |
| Lofted bend (OCCT path) | sheet-metal §9.2 | Wave 3 |
| Mobile / tablet UX for configurations | configurations §15 #5 | Phase 3+ |

---

## 13. Cross-references

- `docs/wave-2-phase-2-configurations-spec.md` — Track A canonical
- `docs/wave-2-phase-2-sheet-metal-spec.md` — Track B canonical
- `docs/wave-2-phase-2-hole-wizard-spec.md` — Track C canonical
- `docs/wave-2-phase-2-reference-geometry-spec.md` — Track D first-half canonical
- `docs/wave-2-phase-2-threads-spec.md` — Track D second-half canonical
- `docs/wave-2-crdt-architecture.md` — CRDT envelope all tracks slot into
- `docs/wave-2-soak-runbook.md` — perf budgets all tracks respect
- `docs/wave-2-cad-advisor-jd.md` — KS B 0201 sign-off referee
- `docs/strategy/CAD_FULLSTACK_MILESTONES.md` — Wave 2 Phase 2 falls under M4
- ADR-010 (not yet on disk in `docs/adr/`) — Wave 2 B-Full + collab; this
  tracker is the operational complement.
- ADR-011 (forthcoming, ref-geom §18) — Reference Geometry as First-Class
  Feature-Tree Entities.

---

## 14. Top 3 Priorities (TL;DR for the user)

1. **A1 corruption fix (Week 1, user-owned, HIGH risk)** — every other
   Phase 2 feature that touches `.nfab` save/load risks compounding the
   master-pollution problem until this lands. Non-negotiable W1 task.
2. **B1 sheet-metal namespace + K-table consolidation (Week 1, agent +
   user verify)** — blocks Week 2 sheet-metal worker work; mostly
   bookkeeping but invisible regressions if rushed.
3. **D3 + D7 sketch / OCCT-geometry HIGH-risk pair (Week 3, Week 7,
   user-owned)** — ref-geom sketch integration is the largest sketch
   surface touch in Phase 2, and threads geometric mode is the largest
   single PR (~2 500 LoC + 600 LoC OCCT bindings). Cluster user
   attention around these two weeks.

---

*End of master task tracker. Update at each gate (W2 / W4 / W8) with
actuals vs. estimates.*
