# 011 — Adopt CRDT-first state and scope Phase 2 around consolidating existing assets

**Status:** accepted
**Date:** 2026-05-28
**Author:** wave-2 architecture
**Risk tier:** P0 (data model + 12-month roadmap dependency)
**Supersedes:** none
**Superseded by:** none
**Related:**
- ADR-010 (Wave 2 = B-Full + collab; 12-month Onshape-parity target; $53–122K budget envelope)
- `docs/wave-2-crdt-architecture.md` (1,105-line design spike; this ADR is its decision capture)
- `docs/wave-2-phase-2-sheet-metal-spec.md`
- `docs/wave-2-phase-2-hole-wizard-spec.md`
- `docs/wave-2-phase-2-threads-spec.md`
- `docs/wave-2-phase-2-reference-geometry-spec.md`
- `docs/wave-2-phase-2-configurations-spec.md`
- `docs/wave-2-soak-runbook.md` (Wave 1 GA gate evidence procedure)
- `docs/wave-1-compat-matrix.md` (20 × 5 STEP round-trip gate)
- `docs/wave-2-cad-advisor-jd.md` (CAD-domain QA capacity that this ADR assumes)

---

## Context

ADR-010 committed us to **Wave 2 = B-Full + collab** over a 12-month horizon
with a $53–122K cash envelope. The cap-stones were: CRDT-first state (so
multi-user editing is not a retrofit), five Phase 2 modeling features at
commercial-CAD parity (sheet metal, hole wizard, threads, reference
geometry, configurations), and the existing Wave 1 GA gates (4-hour soak +
20 × 5 STEP round-trip matrix) preserved without slippage.

Phase 1 of Wave 2 produced three concrete deliverables that change what
Phase 2 should look like:

1. **Week 1 design spike** — `docs/wave-2-crdt-architecture.md` (1,105
   lines) mapped six mutable state surfaces (`constraintSolver.ts`,
   `useFeatureStack.ts`, `bodyManagement.ts`, `assemblyTree.ts`,
   `matesSolver.ts`, `nfabFormat.ts`) onto Yjs structures, identified five
   high-risk concurrent-edit scenarios, sized the performance envelope
   (sketch doc ~55 KB Yjs encoded vs ~32 KB JSON; ~30% overhead acceptable),
   and proposed a 4–6 month, 6-phase migration. Sub-question parking lot
   left in §8 of that doc.
2. **Week 2 working prototype** — under
   `src/app/[lang]/shape-generator/collab/` the following files now ship
   and pass tests:
   - `sketchYjs.ts` (725 LoC) — sketches Y.Map<sketchId, Y.Map> per
     architecture §2.2; segments / constraints / dimensions keyed-by-id
     Y.Map (not Y.Array, intentional — see §2.2 of architecture doc);
     `applySketchOp` wraps each op in exactly one `doc.transact()`.
   - `featureTreeYjs.ts` (615 LoC) — feature tree as Y.Array<Y.Map> per
     architecture §2.4; atomic addNode (child + parent.children) inside
     transact.
   - `offlinePersistence.ts` (137 LoC) + `useOfflineSync.ts` (162 LoC) —
     IndexedDB local persist + sync recovery.
   - `occt-collab-worker/` — Cloudflare Worker + Durable Object hosting
     `y-websocket` sync/awareness over `wss://collab.nexyfab.com`, 30s KV
     snapshots, 30 min idle eviction.
   - Test suite under `__tests__/`: **161 `it(...)` cases across 11 files,
     all green** — multiUser, sketchYjs, featureTreeYjs, sketchCrdt,
     assemblyCrdt, collabUndo, conflictLog, offlinePersistence,
     offlineQueue, presenceEnriched, yjsDoc.
3. **Week 3 five-spec audit** — each of the five Phase 2 modeling features
   was specced to design-only depth (see file list above; 4,828 lines
   total). The **single biggest finding across all five** is that NexyFab
   already has substantial parallel implementations of every targeted
   feature, and Phase 2 is mostly a *consolidation* problem, not a
   greenfield modeling problem:

   | Feature | Existing assets | Phase 2 nature |
   |---|---|---|
   | Sheet metal | 826-line `sheetMetal.ts` (Three.js), 17 files under `sheetmetal/`, 4 files under `sheet-metal/` (dash-namespace duplicate), 2 parallel K-factor tables with incompatible material ids | namespace + table consolidation + OCCT-backed unfold (genuinely new) |
   | Hole wizard | `features/hole.ts` + `HoleWizardModal.tsx` + `holeStandards.ts` (M3–M20 + partial ANSI) | extend library (M1.6/M2/M2.5/M14/M18/M22/M24/M27/M30 + NPT/BSP), add types (counterdrill / tap / pipe-tap), multi-position via fused-tool boolean, sketch input |
   | Threads | helix sampler `sketch3d/helix.ts`, `occtSweepHelix` in `features/sweep.ts`, callout-only `ThreadCallout` in `annotations/GDTTypes.ts`, `formatThreadCallout` already emits `M8×1.25-6H` form | promote callout from annotation array to feature-tree child of host hole; add 60° V profile sweep for geometric mode |
   | Reference geometry | `features/referenceGeometry.ts` complete math module (planes, axes, CSys, points + standards). Currently **unreferenced** outside its own file. | promote math module to first-class feature-tree entities with identity, dep tracking, persistence, UI |
   | Configurations | `NfabConfigurationV1` schema in `.nfab` (round-trips), `panels/ConfigurationTable.tsx` Excel-grid UI (wired), `config/configurationManager.ts` (rich runtime class, 11 tests pass, **never invoked from host** — dead code), `assembly/multiConfigPartVariant.ts` (third parallel API, used only by its own test) | **three parallel implementations exist with no consolidation** — delete two, consolidate on one, fix the corruption bug |

   The meta-finding: **Phase 2 is not a greenfield modeling project, it
   is a consolidation + extension project on top of ~60% existing
   assets**. Same Claude-driven max-parallel velocity, but the work
   shape changed — audit, normalize, extend, gate — not build-from-zero.

A separate finding from the configurations audit demands its own
treatment: `ShapeGeneratorInner.tsx:1404–1420`
(`handleConfigurationSelect`) writes config values **directly into
`sceneStore.params` and calls `updateNode(nodeId, { enabled })`** on every
config switch. The master feature tree is silently overwritten by the
*last activated* config. Files saved while a non-master config was active
**cannot be fully recovered** — the original master is gone. See
`docs/wave-2-phase-2-configurations-spec.md` §1.1 (E) and §13.5. This is
a P0 data-loss bug that has been latent in the codebase since the
configurations feature shipped, and every Phase 2 day we ship without
the fix accumulates more polluted user files.

This ADR locks the CRDT architecture (formal acceptance of the spike),
records the meta-finding (consolidation, not greenfield) as a Phase 2
scope shift, and schedules the corruption fix to land in Phase 2 Week 1
ahead of all other modeling work.

---

## Decision

We adopt **CRDT-first state** as the authoritative architecture for
NexyFab Wave 2, using **Yjs 1.x** as the implementation, per the design in
`docs/wave-2-crdt-architecture.md`. We re-scope Wave 2 Phase 2 from
"build five modeling features greenfield" to **"consolidate the existing
~60% assets per feature, extend them to commercial-CAD parity, and ship
behind feature flags inside the CRDT envelope"** — with the
configurations master-tree corruption bug fixed in Week 1 ahead of all
other modeling deliverables. Phase 2 ships in **4 weeks per feature**;
the five features run on overlapping 4-week timelines, total Phase 2
calendar duration is **~5–7 weeks** depending on coordination overhead
(not 20 weeks sequential — the spec docs were drafted to be parallelizable
since the worker layer is shared and the consolidation surfaces don't
intersect).

### Detailed sub-decisions

1. **CRDT shape locked.** Yjs 1.x. One `Y.Doc` per `.nfab` project.
   Top-level keys per architecture §2.1: `tree`, `sketches`, `bodies`,
   `bodyOrder`, `assembly`, `mates`, `scene`, `manufacturing`, `meta`,
   `configurations`, `aiHistory`. Sketches keyed-by-id Y.Map (segments /
   constraints / dimensions). Feature tree as Y.Array<Y.Map>. Points /
   knots / weights / entityIds / position / config / faceFrame stored
   as JSON-stringified LWW atomic blobs (§2.2.1 of architecture; §2.3
   for constraint/dimension shape).

2. **Y.Map re-key wart → "root subscribe + canonical JSON" rule.**
   Yjs has no Y.Map re-key primitive. `sketchYjs.ts:584` documents the
   workaround: re-encode under the new id, delete the old; observers
   attached to the *old* Y.Map are detached. React hooks consuming
   shared collections **must subscribe at the collection root** (not at
   per-entity Y.Map handles) so that rename-by-recreate is observable.
   Equality comparisons across the boundary use the canonical JSON
   serializer in `sketchYjs.ts:712` (`canonicalJson`) which sorts object
   keys so that round-trips through the encode/decode path produce
   byte-equal JSON. New code that compares CRDT snapshots **must** use
   `canonicalJson`, never `JSON.stringify` directly.

3. **`bodyIndex → bodyId` migration deferred to `.nfab` import (Phase
   4).** `Mate.selections[i].bodyIndex` is a positional integer
   (architecture §1.5, §4 scenario C). Eliminating it is the largest
   correctness win of the migration but it is a one-way `.nfab` schema
   change. We do **not** ship it in Phase 2 — it lands during Phase 4
   (Wave 2 month 5–6, per architecture §6 Phase 4 timing), bundled with
   the v2→v3 `.nfab` migration script. Until then, mate references remain
   positional but the CRDT envelope around them is in place.

4. **Five Phase 2 modeling features each ship in 4 weeks, behind a
   feature flag, with the existing path preserved as fallback:**

   | # | Feature | Existing flag pattern | Spec doc |
   |---|---|---|---|
   | 1 | Sheet metal | `sheetMetalV2=true` (URL param, falls back to current Three.js path) | `wave-2-phase-2-sheet-metal-spec.md` |
   | 2 | Hole wizard | `hole_wizard_v2 = on` (default after Week 4) | `wave-2-phase-2-hole-wizard-spec.md` |
   | 3 | Threads | new feature; no fallback needed (cosmetic mode = today's annotation behavior) | `wave-2-phase-2-threads-spec.md` |
   | 4 | Reference geometry | new node type; standard planes remain literal `'xy' \| 'xz' \| 'yz'` via `PlaneRef` adapter | `wave-2-phase-2-reference-geometry-spec.md` |
   | 5 | Configurations | new `ConfigurationTable` class replaces `ConfigurationManager` + `multiConfigPartVariant`; flag = always-on for new docs, migrate-on-open for existing | `wave-2-phase-2-configurations-spec.md` |

   The Week 1 deliverable of each spec is the gating-fixture work
   (`F-SM-01`, `F-HW-01`, ISO M coarse catalog, plane methods 1–5, fix
   `handleConfigurationSelect`). Week 4 of each spec is i18n + Phase 3
   prep handoff.

5. **Configurations corruption bug = Phase 2 Week 1 (P0, blocking
   everything else).** Per `wave-2-phase-2-configurations-spec.md` §5
   "Key invariants" and §13.5 "Polluted master from pre-v3":

   - Rip out the master-mutation code path in
     `ShapeGeneratorInner.tsx:1404–1420`. Config switch must route
     through `ConfigurationTable.resolveActive(features, equationManager)`
     and produce a *derived* feature list for the pipeline; the master
     tree (`useFeatureStack`) is **never** mutated by activation.
   - Bump `.nfab` to **v3** with `migrateV2ToV3` (spec §3.2). Existing
     `NfabConfigurationV1` rows lift into `NfabConfigurationV2` shape;
     `legacy*` fields preserved one cycle for round-trip safety.
   - Release notes call out the unrecoverable case (file saved
     pre-v3 with non-master config active had its master overwritten):
     "Open + re-save in v3; verify master matches your intended
     baseline."

   Until this lands, no other Phase 2 modeling feature ships — because
   every additional feature that participates in configurations
   compounds the damage.

---

## Consequences

### Positive

- **Wave 2 Phase 2 timeline compressed 30–50%.** All five spec docs
  identify substantial existing assets; the work is consolidation +
  extension, not greenfield. Concrete examples: `formatThreadCallout`
  already emits the `M8×1.25-6H` string (threads §1), the `referenceGeometry.ts`
  math module is complete (reference geometry §1.1), `featureContext.ts`
  is the existing pipeline seam for configurations (configurations §5).
  Per-feature Phase 2 stays at 4 weeks but the **parallelism is real** —
  the five features touch separate code paths (the only shared surface
  is the CRDT envelope, which Week 2 prototype already shipped).
- **Max-parallel Claude-driven velocity validated for the third time.**
  Phase 1 Week 1 (architecture spike, 1,105 lines), Week 2 (working
  prototype, ~1,500 LoC + 161 tests), Week 3 (five spec docs, 4,828
  lines). All inside ~3 wall-clock weeks. The 12-month Wave 2 target
  (ADR-010) requires sustained ~17–23× compression vs traditional CAD
  shop velocity; we have three concrete data points that say it is
  achievable, not aspirational.
- **161-test prototype validates the architecture's risky assumptions.**
  Sketch keyed-by-id Y.Map (not Y.Array): proven via `sketchYjs.test.ts`
  (24 cases). Atomic `applySketchOp` transact: covered. Multi-user
  divergence-free convergence: `multiUser.test.ts` (10 cases). Offline
  → online sync recovery: `offlinePersistence.test.ts` (15 cases). The
  architecture is not paper any more.
- **Configurations corruption bug closed.** The single largest latent
  data-loss surface in the entire app exits Wave 2 Phase 2 Week 1. Any
  user opening a v3-and-later file gets the safe code path.
- **CRDT-first means collab is no longer a future retrofit.** Every
  feature shipped from Phase 2 onward composes cleanly with the
  shared-edit transport (`occt-collab-worker`). Wave 3 / Wave 4 don't
  pay a retrofit tax.

### Negative

- **Asset audit + consolidation work is genuine effort, ~2–3 weeks
  added load that wasn't in the original ADR-010 Phase 2 budget.**
  The sheet-metal namespace consolidation alone (one `sheetmetal/`
  folder, one `sheet-metal/` dash-namespace folder, two K-factor
  tables with `mildSteel` vs `steel-cold-rolled` ids) is a half-week
  of careful merge work that we did not plan for. Configurations has
  three parallel APIs to collapse to one. We absorb this load by
  routing it through the same Phase 2 4-week timeline — but spec
  Week 4 acceptance gates assume the consolidation is done.
- **`.nfab` v3 migration is mandatory and one-way.** The corruption fix
  is a schema change. `migrateV2ToV3` is non-lossy *for files saved
  with `activeConfigurationId = null`*, but cannot recover the master
  for files saved with a non-master config active (the master was
  overwritten in-place by the bug). Customers with `.nfab` files that
  fell into that case will see drift; release notes document the
  recovery procedure (re-save with master active, verify baseline).
- **Yjs 1.x version is pinned for the entire 4–6 month migration.**
  Architecture §7.1: we do not upgrade Yjs mid-migration. Any
  upstream security CVE in the pinned version becomes our problem to
  patch; budget includes one CVE backport iteration.
- **CRDT-first writes still produce ~30% encoding overhead on doc
  size** (architecture §5.1). For typical CAD projects this is fine
  (~660 KB Yjs vs ~500 KB JSON), but customers with very large files
  (50 sketches × 200 segments + 500 features + 50 bodies + 200 mates)
  sit at ~5 MB in-memory Y.Doc, well within budget but not free.
- **Phase 2 is now critical-path on a single Week 1 deliverable.**
  If the configurations corruption fix slips past Week 1, every
  subsequent modeling feature inherits the polluted master risk. The
  schedule has no slack for this.

### Neutral

- **The five Phase 2 spec docs become living implementation contracts,
  not throwaway designs.** Each spec calls out a "Phase 3 prep" or
  "Phase 3 handoff" section that locks the data shape Phase 3 consumes
  (drawing callouts, hole tables, BOM, mate-on-reference-geometry).
  Wave 2 Phase 3 entry conditions are now well-defined.
- **`docs/wave-2-soak-runbook.md` and `docs/wave-1-compat-matrix.md`
  remain the GA gates.** This ADR does not change Wave 1 GA evidence
  procedure; the soak runbook still requires Q4/Q1 ≤ 2.0, ≥5 recycles,
  0 unhandled crashes; the matrix still requires ≥70 of 100 cells pass.
- **CAD advisor capacity (`docs/wave-2-cad-advisor-jd.md`) is wired
  into Phase 2 Week 1 review** for the threads catalog (KS B 0201
  numerics audit) and configurations behavior expectations (Onshape /
  SolidWorks parity check). 1–2 hours/month is sufficient at the
  current spec quality.

---

## Alternatives considered

- **Greenfield re-implementation of all five Phase 2 modeling
  features.** Rejected. The audit found substantial existing assets in
  every feature — sheet-metal has 826 lines of bend/flange/hem/jog
  already, threads have helix sampler + `occtSweepHelix` + callout
  formatter, configurations have a working file-format slot + Excel
  grid + (unused) runtime class. Starting over would discard ~60% of
  shipped work, miss the 12-month ADR-010 target, and ignore the
  documented user-visible behavior the existing code already supports.
- **Retrofit CRDT later (Wave 3 or Wave 4).** Rejected explicitly in
  ADR-010 and confirmed by the Week 2 prototype evidence. The
  architecture §7.2 "Reversal" plan exists precisely so we **don't**
  have to retrofit later — every phase ships a working single-user
  fallback. Deferring would also keep the configurations master-mutation
  bug live indefinitely; the bug compounds with every additional
  feature that participates in configurations.
- **Defer the configurations corruption fix to Phase 4** (when the
  `.nfab` v3 bump happens for `bodyIndex → bodyId`). Rejected. Every
  day the bug is live, customer files accumulate damage. The Week 1
  ship for the fix is feasible because (a) the fix surface is small —
  `ShapeGeneratorInner.tsx:1404–1420` plus `featureContext.ts:51`
  plus the new `configurationTable.ts` class; (b) the migration
  (`migrateV2ToV3`) is non-lossy for the common case; (c) the spec doc
  details all six edge cases (§13.1–13.10).
- **Pin Yjs at 2.x (or wait for 2.0 stable).** Rejected. Yjs 2.x is
  not GA at decision time; pinning a moving target during a 5-month
  migration is exactly the upstream-breakage risk architecture §7.1
  flagged. We pin 1.x latest, revisit after Phase 5 ships.
- **Replace `sketchData` JSON-blob on feature node with sketch
  Y.Doc reference now (Phase 2).** Rejected for sequencing reasons.
  Architecture §6 puts the `sketchData → sketchRef` migration in Phase
  3 (Wave 2 month 3–4) after Phase 1 ships and the body-registry +
  scene work is consolidated. Doing it now creates a two-place sketch
  storage problem during Phase 2 that the spec docs assume away.

---

## Rollout

Phase 2 calendar: **Weeks 1–4 of Wave 2 Phase 2** (starting 2026-05-29,
the day after this ADR's adoption). Each item is owned by the same
single-founder + Claude max-parallel pair as Phase 1. Acceptance
checkboxes mirror those in the per-feature spec docs.

### Week 1 — Critical-path: corruption fix, namespace consolidations, gating fixtures

- [ ] **Configurations corruption fix (P0).** Per
  `wave-2-phase-2-configurations-spec.md` §5 / §11 Week 1:
  - Implement `src/app/[lang]/shape-generator/config/configurationTable.ts`
    with `activate / resolveActive / setOverride / setSuppressed / toJSON`.
  - Route `applyFeatureContext` (`featureContext.ts:51`) through
    `ConfigurationTable`, not `ConfigurationManager`.
  - Delete master-mutation code path in
    `ShapeGeneratorInner.tsx:1404–1420`. Replace with config-switch
    that only updates `activeConfigId` + invalidates pipeline cache.
  - Land `migrateV2ToV3` in `nfabFormat.ts` (spec §3.2). Round-trip
    test on 6 fixture `.nfab` files.
- [ ] **Sheet metal namespace consolidation.** Per
  `wave-2-phase-2-sheet-metal-spec.md` §1.4:
  - Pick canonical material id format. Merge
    `sheetMetalTables.ts` ↔ `kFactorTable.ts`; delete the latter.
  - Unify `sheetmetal/` and `sheet-metal/` directories under
    `sheetmetal/`. All call sites updated.
  - Land `SheetMetalPart` type + canonical schema.
  - Ship F-SM-01 fixture (base flange + 1 bend) green via worker if
    worker layer materialized, else green via feature-flagged
    Three.js path (mitigation in spec §8 Week 1 risk note).
- [ ] **Hole wizard library extension.** Per
  `wave-2-phase-2-hole-wizard-spec.md` §9 Week 1:
  - Add M1.6 / M2 / M2.5 / M14 / M18 / M22 / M24 / M27 / M30 (ISO),
    new ANSI rows, NPT / BSP rows to `holeStandards.ts`.
  - `features/holeArray.ts` multi-position drilled feature behind
    new `/occt/op/hole/drilled` worker endpoint.
  - F-HW-01 fixture (M3 × 4) passes via new path.
- [ ] **Reference geometry Phase 1.** Per
  `wave-2-phase-2-reference-geometry-spec.md` §15 Week 1:
  - `features/referenceGeometryNodes.ts` data model + dep solver +
    cycle detection. Plane methods 1–5 + Axis methods 1–3 unit
    tests green. No UI yet.
- [ ] **Threads catalog.** Per `wave-2-phase-2-threads-spec.md` §15
  Week 1:
  - `features/threadCatalog.ts` with ISO M, ISO MF, UTS UNC, UTS UNF,
    NPT, BSP tables. KS B 0201-correct numerics. Catalog lookup +
    designation parse unit tests.
  - `/occt/op/thread/cosmetic` endpoint, metadata-only.

**Gate (Week 1 exit):** F-SM-01 green; F-HW-01 green; threads catalog
audited by CAD advisor; configurations corruption fix shipped with
six-fixture migration round-trip green.

### Week 2 — Reference geometry promotion + Hole wizard V2 extensions

- [ ] **Reference geometry UI + persistence** (spec §15 Week 2):
  toolbar dropdown, method-picker dialog (no preview yet), tree
  integration, `.nfab` v3 schema additions for ReferenceNode (compose
  with v3 bump from Week 1 configurations fix).
- [ ] **Hole wizard counterbore + countersink** (spec §9 Week 2):
  `/occt/op/hole/counterbore`, `/occt/op/hole/countersink` endpoints;
  Termination tab (blind / through / up-to-next / up-to-face) wired.
- [ ] **Threads hole-wizard integration + standalone UI** (spec §15
  Week 2): wizard panel section per §10.1; standalone "Add thread"
  entry; 6-lang translations.
- [ ] **Sheet metal multi-bend + addFlange** (spec §8 Week 2): F-SM-02
  + F-SM-03 fixtures green. DFM minimum-bend-radius warnings in
  right pane.
- [ ] **Configurations Phase 1 acceptance** (spec §11 Week 2): pipeline
  re-evaluation on activate; expression resolver wired
  (activeConfig.expressionVars >> globalVars >> equationManager).

### Week 3 — Sheet metal B-Rep topology unfold (the only genuinely new modeling work) + advanced hole types

- [ ] **Sheet metal unfold + DXF** (spec §8 Week 3): `/occt/op/sheetmetal/unfold`
  with **real B-Rep topology unfold** (not arc-length math). Wire to
  `analysis/flatPatternDrawing.ts`; DXF CUT / BEND_UP / BEND_DOWN
  layers correct. F-SM-04, F-SM-05 fixtures green.
- [ ] **Hole wizard counterdrill + tap + sketch input** (spec §9 Week 3):
  `/occt/op/hole/counterdrill`, `/occt/op/hole/tap`;
  `positionMode = 'fromSketch'` path through rebuild solver. DFM
  `TAP_BOTTOM_RISK` rule. F-HW-03 + F-HW-04 fixtures green.
- [ ] **Threads geometric mode** (spec §15 Week 3): `thread60DegVProfile.ts`,
  `threadWhitworthProfile.ts`; sweep-with-profile parameter on
  `occtSweepProfile`; geometric worker endpoint. All §13.1 + §13.2
  fixtures green.
- [ ] **Reference geometry sketch integration** (spec §15 Week 3):
  PlaneRef in `SketchNodeData`; plane-picker rework; live preview in
  method-picker dialog. Sketch-on-offset-plane end-to-end. Fixtures
  01–05 pass.

### Week 4 — UI integration, i18n, family export, Phase 3 handoff

- [ ] **Sheet metal Korean UI + bend table + auto-drawing** (spec §8
  Week 4): Right pane property block; bend table dock; PDF export via
  `io/pdfExport.ts`. New i18n keys: `절곡선`, `전개도`, `K-팩터`.
- [ ] **Hole wizard pipe-tap + i18n + polish** (spec §9 Week 4):
  `/occt/op/hole/pipeTap`; all six languages (KR / EN / JA / ZH / ES /
  AR); linear / rectangular / circular pattern helpers; flag flip
  `hole_wizard_v2 = on` by default; F-HW-AGG-01 burn-in passes 3.0s GA
  gate.
- [ ] **Threads drawing-callout prep** (spec §15 Week 4):
  `formatThreadCallout` length suffix + tap-drill suffix;
  `bomAggregation.ts` `threadOps` section; ISO 6410-1 dashed-line in
  section views (gated behind Phase 3 drawing flag).
- [ ] **Reference geometry Korean UI + KS hooks + Phase 3 mate API
  surface** (spec §15 Week 4): fixtures 06–10 pass; Playwright E2Es
  green; 100-ref perf pass.
- [ ] **Configurations UI + family STEP export + CRDT integration**
  (spec §11 Weeks 3–4): refactored `panels/ConfigurationTable.tsx`;
  parent dropdown column; `react-window` virtualization at N > 50;
  Family Export dialog + JSZip; CSV BOM export; Y-backed ConfigStore
  with 3 users × 5 configs × 10 min soak.

### Cross-cutting (parallel throughout)

- **CRDT envelope** for each new feature: every spec calls out the Y.Doc
  subtree it lives in (sketches, tree, configs). Each Week 4 deliverable
  includes the Y-backed wiring or schedules it for Phase 3 entry.
- **Test coverage parity:** every spec's fixture set has Vitest +
  Playwright coverage by its Week 4 acceptance gate.
- **`docs/wave-2-crdt-architecture.md` updates:** spec docs §3 and §9 of
  reference geometry / configurations explicitly add new subtrees;
  architecture doc gets one PR per added subtree at Phase 2 close.
- **Decision review:** after Week 4 ships, hold the
  architecture §7.4 "continue / pivot / reverse" checkpoint. Signals:
  sync RTT P95 < 200 ms, doc size growth < 10× per week, ≤ 2 "edit lost"
  incidents, solver re-run < 5 Hz, DO cost < $0.10 / active doc / day.

### Decision review

**2026-07-15** (Phase 2 close) — did we hit the four-week per-feature
target on five concurrent features? Did the corruption fix hold without
new master-tree-mutation regressions? Update this section with
pass / pivot / reverse outcome.

---

## Reversal

This decision has **two independent reversal paths**, one per major
sub-decision.

### Reversal A — Configurations corruption fix fails to ship in Week 1

If the v3 migration round-trip is not green by Week 1 exit, or if the
`ConfigurationTable.activate` path leaks state into the master tree:

- Roll back `ShapeGeneratorInner.tsx:1404–1420` to **read-only**
  config switch — the switch still updates `activeConfigId` but
  emits a warning UI banner: "Configurations are read-only in this
  build. Edit the master tree directly." This protects all new files
  from further corruption.
- Keep `NfabConfigurationV1` schema unchanged. v2 files load and save
  identically. Defer v3 to Phase 3.
- Cost: ~1 week to land the read-only mode + warning banner;
  ~0 customer-facing data risk (corruption window closes for new
  edits even without the full fix).
- Phase 2 modeling work continues — none of the other four features
  depend on the configurations runtime, only on the schema slot which
  remains intact.

### Reversal B — CRDT integration proves untenable in production

If post-Phase-2 production traffic invalidates two architecture §7.4
signals in two consecutive reviews — e.g. sync RTT P95 > 1s, or
> 5 "edit lost" incidents per phase — invoke the reversal plan in
`docs/wave-2-crdt-architecture.md` §7.2:

- **Reversal during Phase 0–1** of the broader architecture migration
  (where Phase 2 modeling work happens): flip `?crdt=*` flags off. Zero
  data impact — React-state mirrors are authoritative; the Y.Doc was a
  parallel store.
- **Reversal during Phase 2–3** (sketches migrated): React-state
  mirrors remain authoritative; stop syncing Y.Doc. Lose collab. Two
  weeks of CRDT-code delete.
- **Reversal during Phase 4** (`bodyIndex → bodyId` shipped): reverse
  migration script `bodyId → bodyIndex` from `placedParts` order, tested
  as part of Phase 4 entry.
- **Reversal during Phase 5+** (collab is default): sunset awareness
  UI, keep CRDT as single-user auto-persist. One week.

Total reversal cost from end of Phase 5: ~11.5 eng-weeks (architecture
§7.3). Acceptable ceiling per ADR-010 budget.

---

## References

### Code

- `src/app/[lang]/shape-generator/collab/sketchYjs.ts` — sketch CRDT
  shape per architecture §2.2; canonical-JSON helper at L712.
- `src/app/[lang]/shape-generator/collab/featureTreeYjs.ts` — feature
  tree CRDT per §2.4.
- `src/app/[lang]/shape-generator/collab/offlinePersistence.ts` +
  `useOfflineSync.ts` — local persist + sync recovery.
- `src/app/[lang]/shape-generator/collab/__tests__/` — 161 `it(...)`
  cases across 11 files, all green.
- `occt-collab-worker/src/` — Cloudflare DO transport
  (`wss://collab.nexyfab.com`), 30s KV snapshots, 30min idle eviction.
- `src/app/[lang]/shape-generator/io/nfabFormat.ts` — schema; v3 migration
  lands Week 1.
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx:1404–1420` —
  the corruption-bug code path (P0, fixed Week 1).
- `src/app/[lang]/shape-generator/features/featureContext.ts:51` — the
  pipeline seam the fix routes through.
- `src/app/[lang]/shape-generator/features/referenceGeometry.ts` — math
  module, currently unreferenced, promoted Phase 2 Week 1–2.

### Docs

- `docs/wave-2-crdt-architecture.md` — full 1,105-line design, this
  ADR's foundation.
- `docs/wave-2-phase-2-sheet-metal-spec.md` (1,014 LoC)
- `docs/wave-2-phase-2-hole-wizard-spec.md` (1,301 LoC)
- `docs/wave-2-phase-2-threads-spec.md` (921 LoC)
- `docs/wave-2-phase-2-reference-geometry-spec.md` (767 LoC) — §18
  "ADR Hook" anticipates this ADR.
- `docs/wave-2-phase-2-configurations-spec.md` (825 LoC) — §13.5
  "Polluted master from pre-v3" is the corruption bug detail.
- `docs/wave-2-soak-runbook.md` (542 LoC) — Wave 1 GA evidence.
- `docs/wave-1-compat-matrix.md` (450 LoC) — 20 × 5 STEP gate.
- `docs/wave-2-cad-advisor-jd.md` — CAD-domain QA capacity assumed by
  Week 1 catalog audits.
- `docs/adr/000-template.md` — template followed by this ADR.

### Prior decisions

- ADR-010 (Wave 2 = B-Full + collab; 12-month horizon; $53–122K cash
  envelope) — superset commitment this ADR operationalises.
- ADR-009 (Wave 1 GA gate, occt-worker pool) — Wave 1 evidence procedure
  preserved unchanged.
