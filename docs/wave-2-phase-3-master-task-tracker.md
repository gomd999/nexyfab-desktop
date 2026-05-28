# Wave 2 — Phase 3 · Master Task Tracker

**Status:** planning / coordination doc — companion to ADR-012; supersedes per-spec timelines for sequencing only. Per-spec technical detail lives in the Phase 2 spec docs and in `docs/wave-2-crdt-architecture.md`.
**Date:** 2026-05-28 (Wave 2 Phase 2 close — Phase 3 planning artifact)
**Author:** wave-2 phase-3 coordination
**Risk tier:** P0 (CRDT integration is the load-bearing decision of Wave 2; direct edit is a second-modality bet)
**Budget:** 12 calendar weeks (Month 4-6 per ADR-010 §Phase 3)
**Owner:** solo developer + agent pair (see §9 owner table)

## Inputs consolidated by this tracker

| Input | Path | What it commits Phase 3 to |
|---|---|---|
| ADR-010 | wave commitment (not on disk; canonical in master memory) | Phase 3 = Month 4-6, scope = "CRDT 전체 통합 + Direct edit"; 12 weeks of capacity |
| ADR-011 | `docs/adr/011-crdt-architecture-and-phase-2-scope.md` | Y.Doc shape locked; sketches/tree/configs subtrees defined; transport pattern set |
| ADR-012 | `docs/adr/012-wave-2-phase-3-crdt-integration-and-direct-edit.md` | Phase 3 architecture decisions (CRDT integration topology + direct-edit semantics + reversal flags) — companion to this tracker |
| Phase 2 master tracker | `docs/wave-2-phase-2-master-task-tracker.md` | Five modeling features shipped at commercial-CAD parity — these are the surfaces Track Z wires into Y.Doc |
| CRDT architecture | `docs/wave-2-crdt-architecture.md` | Six mutable state surfaces mapped to Yjs structures; reversal plan defined |
| Phase 2 specs | `docs/wave-2-phase-2-*-spec.md` (5 docs, 4,828 LoC) | Data shapes for each subtree (sketches, configs, ref-geom, holes, threads) |
| Phase 1 CRDT primitives | `src/app/[lang]/shape-generator/collab/` | `sketchYjs.ts`, `featureTreeYjs.ts`, `configStoreYjs.ts`, `offlinePersistence.ts`, awareness scaffolding |
| occt-collab-worker | `occt-collab-worker/src/` | Cloudflare DO transport, `y-websocket` sync/awareness, KV snapshots — scaffolded in Phase 1 W2 (PR #35), **not deployed** |

> Naive sum: ~12 weeks of distinct integration + editor work, plus the 12-week budget envelope per ADR-010. This tracker apportions the budget across 4 parallel tracks (Z/E/Q/P) with one mid-phase gate at W4, one at W8, and the Phase 3 exit gate at W12.

---

## 0. TL;DR for the impatient

- **Phase 3 wires CRDT into the production editor.** Phase 1 shipped the
  CRDT *primitives* (sketchYjs, featureTreeYjs, configStoreYjs, offline
  persistence, 161 tests green) but they are NOT wired to the production
  editor. Sketches still use `React.useState`. The feature tree still
  uses local arrays. Phase 3 Track Z replaces the local state with
  Y.Doc-backed state behind `?crdt=v2` flag.
- **Direct edit is the second deliverable.** Track E adds SolidWorks-
  style push/pull face editing as a *session-only* modeling modality,
  flag-gated `?direct-edit=v1`. Direct edits do NOT commit to parametric
  history unless the user opts in (E5 "promote to history").
- **occt-collab-worker deployment is W1 Day 1.** The worker exists on
  disk but has never been deployed (depends on Wave 1 task #31, not
  yet closed). Z1 Yjs Provider work cannot proceed past local
  BroadcastChannel until the worker is live on
  `wss://collab.nexyfab.com`.
- **Mid-phase reversal is real.** Both `?crdt=v2` and `?direct-edit=v1`
  ship default-OFF until W11 burn-in clears. If burn-in shows >5%
  divergence or >2 "edit lost" incidents per soak, the W8 reversal
  flips Phase 3 to **CRDT-local-only mode** (BroadcastChannel + IndexedDB
  only, no WebSocket). Direct edit can ship independently of CRDT.
- **Real expected calendar: 10-11 weeks** of focused work in the
  12-week budget. The 1-2 week slack absorbs (a) DO deploy ramp-up,
  (b) direct-edit OCCT binding fragility (E1 worst case), (c)
  permissions enforcement edge cases (Z8).

---

## 1. Week × Track Matrix (12 weeks, 4 parallel tracks)

> Cells are work-units; an empty cell means the track is dormant that
> week. `BLOCK` = explicit blocking dependency on another track this
> week. `GATE` = decision point at end of week (see §7).

| Week | Track Z (CRDT Sync) | Track E (Direct Edit) | Track Q (Quality / Gate) | Track P (Polish / i18n / Perf) |
|------|---|---|---|---|
| **W1** | **Z1.** Yjs Provider: Y.Doc host integration in `ShapeGeneratorInner`. BroadcastChannel local multi-tab. y-indexeddb offline wire. WebSocket-ready stub (no live worker yet). Awareness scaffolding (no UI). **(BLOCK on occt-collab-worker deploy — Wave 1 task #31)** | (dormant — direct edit starts W3) | **Q-cont.** Wave 2 burn-in still green check. Set up `phase-3-burnin/` fixture dir. Daily standup file. | **P1.** Sentry coverage check on collab module pre-integration. New i18n keys reserved (`동기화`, `브랜치`, `참여자`, `직접편집`). |
| **W2** | **Z2.** Sketch editor CRDT integration. Replace `useState` for `SketchSegment[] / SketchConstraint[] / SketchDimension[]` in `SketchCanvas.tsx` with `useSketchYjs(docId, sketchId)` hook. Flag-gate `?crdt=v2`. 2-tab divergence test. | (dormant) | (dormant) | **P2.** Sketch i18n strings audited (no new strings — CRDT is invisible). |
| **W3** | **Z3.** Feature tree CRDT integration. Replace `useFeatureStack`'s `Map<id, HistoryNode>` with `useFeatureTreeYjs(docId)`. Atomic addNode (child + parent.children in one transact). Flag-gate `?crdt=v2`. | **E1.** Direct edit foundation: face-pick + push-pull math. Three.js raycast → OCCT face id mapping. No history commit yet. Worker endpoint `/occt/op/direct/pushPull` (metadata + B-Rep delta only). Flag `?direct-edit=v1` introduced. | **Q-cont.** | **P3.** Direct-edit dictionary (`밀기/당기기`, `면 직접편집`) drafted. |
| **W4** | **Z4.** Ref-geom CRDT integration. `ReferenceNode` storage migrates to Y.Doc subtree. Multi-user fixture: 2 peers add planes concurrently, converge. | **E2.** Direct-edit fillet/chamfer dynamic. Face-pair pick → variable-radius fillet preview (live drag). Worker `/occt/op/direct/fillet`. | **GATE: §7 W4 mid-Phase-3 gate.** Z1-Z4 + E1-E2 done? occt-collab-worker on `wss://collab.nexyfab.com`? Awareness wired? If NO → descope decision tree (§7.W4). | **P4.** i18n KR canonical for direct-edit toolbar. EN sync. |
| **W5** | **Z5.** Awareness UI. Peer cursors in sketch canvas. Peer-pinned active node in feature tree. Peer-edited input field highlight in modal forms. NOT in 3D viewport (deferred — see §2 Track Z scope notes). | **E3.** Direct-edit move/rotate body. Body-level transform pick → live-drag preview → worker apply on commit. F-DE-01 fixture (push-pull a face on a single body). | **Q-cont.** | **P5.** Awareness color palette (8 distinct colors, color-blind-safe). |
| **W6** | **Z6.** Branching + branches UI. Per-doc branches (fork-on-write, Y.Doc clones doc into a new id). Branch list + create/switch UI. Manual merge only (no auto-merge). | **E4.** Direct-edit subtract body. Body B from body A by face-pick. F-DE-02 fixture. | **Q-cont.** | **P6.** Branch UI strings 6-lang. |
| **W7** | **Z7.** Activity feed + presence panel. Op log per doc (last N ops surfaced). Presence panel with peer list, last-seen, current selection. | **E5.** Direct-edit history merge. "Promote direct edits to history" opt-in UI: every direct edit recorded in a session-only stack; user clicks "Commit to history" → stack flushes into N feature-tree nodes (`DirectEditPushPull`, `DirectEditFillet`, …). F-DE-03 fixture. | **Q-cont.** | **P7.** Activity-feed strings 6-lang. |
| **W8** | **Z8.** Permissions UI (workspace + doc) + role enforcement. Read/write gates on doc-perm > workspace-perm per ADR-011 §2.4. 404-not-403 anti-enumeration. | (dormant — direct-edit shipped W7) | **GATE: §7 W8 mid-Phase-3 gate.** Z5-Z8 + E3-E5 done? Permissions enforced server-side? If NO → §7.W8 descope. | **P8.** Permissions strings (`소유자`, `편집자`, `뷰어`) 6-lang. |
| **W9** | (dormant — Z shipped W8) | (dormant — E shipped W7) | (dormant — burn-in W11) | **P9.** End-to-end i18n sweep across Z + E new strings. JA / ZH / ES / AR translations land. |
| **W10** | (dormant) | (dormant) | (dormant) | **P10.** Sentry breadcrumb tuning for CRDT + direct-edit failure channels. Perf-budget regression run (sketch entity add p95 ≤ 16ms, feature tree reorder p95 ≤ 50ms, direct-edit push-pull p95 ≤ 30ms). |
| **W11** | (dormant) | (dormant) | **Q1.** Full Wave 2 burn-in: sheet-metal + hole-wizard + threads + configs + ref-geom + direct-edit + CRDT (3 users × full pipeline × 3-hour soak). 20 × 5 STEP round-trip matrix re-run. | **P11.** Onboarding tour update for collab + direct-edit. |
| **W12** | (dormant) | (dormant) | **Q2.** **GATE: §7 Phase 3 exit gate.** Green / Yellow / Red decision. Exit memo `docs/wave-2-phase-3-exit.md`. | **P12.** Final UI polish; flag-graduation PR drafted (separate from this Phase 3 close PR). |

### Reading the matrix

- A track is **integration-complete** at the row marked Phase 3
  integration end. After that row it goes dormant in this tracker;
  regression coverage moves to Track Q.
- Track Z (CRDT sync) ends at W8 — the four integration weeks (Z1-Z4)
  plus the four collab-UX weeks (Z5-Z8) consume the full Track Z budget.
- Track E (direct edit) ends at W7. The fifth direct-edit deliverable
  (E5 history merge) is the optional commit path; without E5, direct
  edits stay session-only.
- Track Q (quality / gate) is event-driven, not continuous. Three
  gates at W4 / W8 / W12 are the only Q deliverables that block.
- Track P (polish / i18n / perf) runs continuously, slot-loading into
  any week with capacity.

---

## 2. Track Definitions

### Track Z — Zynchronization (CRDT integration layer; P0)

**Why P0:** Phase 1 shipped CRDT primitives in isolation. Phase 2 shipped
modeling features without touching them (except A5 ConfigStore Y.Map
backing, which is one of three subtrees the editor must consume).
Phase 3 is the *only* phase where wiring the editor to those primitives
happens. If Track Z slips into Phase 4, the 12-month Wave 2 plan stops
making sense — Phase 4 is reserved for AI / CAM / FEA work (per
ADR-010) and pushing CRDT into Phase 4 either cancels Phase 4 or breaks
the ADR-010 commitment.

Eight deliverables across W1-W8:

- **Z1 (W1):** Yjs Provider — Y.Doc host integration, BroadcastChannel,
  y-indexeddb, WebSocket-ready (offline-first; worker not yet required).
- **Z2 (W2):** Sketch editor CRDT integration — `useSketchYjs` hook
  replaces `useState` in `SketchCanvas.tsx`.
- **Z3 (W3):** Feature tree CRDT integration — `useFeatureTreeYjs`
  replaces `useFeatureStack`'s flat lookup.
- **Z4 (W4):** Ref-geom CRDT — `ReferenceNode` storage in Y.Doc subtree.
- **Z5 (W5):** Awareness UI — peer cursors + selections.
- **Z6 (W6):** Branching + branches UI.
- **Z7 (W7):** Activity feed + presence panel.
- **Z8 (W8):** Permissions UI + role enforcement.

**Awareness scope (locked):** sketch viewport, feature tree, modal
forms. NOT the 3D viewport (camera position broadcast is a P5 nice-to-
have per ADR-012 §3). The 3D viewport touches every render frame; the
broadcast cost is not justified by Phase 3 collab UX needs.

External dependency: **occt-collab-worker on `wss://collab.nexyfab.com`**
must be deployed by start of W4 at latest (Z4 ref-geom test requires
real WebSocket, not just BroadcastChannel). If Wave 1 task #31 has not
closed by W3 EOD, Z4 falls back to local-only test mode.

### Track E — dirEct edit (push/pull face editing modality)

**Why "second modality":** Parametric history is the primary editing
modality in NexyFab. Direct edit is a SolidWorks-style synchronous
modeling layer that operates on the *current resolved B-Rep* — face
picks, push/pull math, body-level booleans — without modifying the
parametric tree. Direct edits compose at the geometry level, not the
history level.

**Relationship to parametric history (resolved in ADR-012 §6):**
- Direct edits are a *session-only stack* by default. They live in
  memory + the Y.Doc subtree `directEdits` (a Y.Array<DirectEditOp>),
  applied on top of the parametric pipeline output during the current
  session.
- "Promote direct edits to history" is the opt-in flush (E5). The user
  reviews the stack and clicks "Commit to history" → each direct edit
  becomes one feature-tree node, the stack clears, and the parametric
  pipeline regenerates from the new tree.
- If the user does NOT promote, direct edits are flushed at session end
  (file close) or when the parametric tree is re-run from earlier in
  the history (re-running history invalidates the direct-edit stack —
  the stack assumes a specific resolved geometry that re-running the
  tree changes).

Five deliverables across W3-W7:

- **E1 (W3):** Foundation — face-pick + push-pull math. Worker endpoint
  `/occt/op/direct/pushPull`.
- **E2 (W4):** Fillet/chamfer dynamic — face-pair pick → variable-radius
  fillet preview.
- **E3 (W5):** Move/rotate body — body-level transform.
- **E4 (W6):** Subtract body — body B from A by face-pick.
- **E5 (W7):** History merge — opt-in commit-to-history flush.

External dependency: **OCCT push-pull face binding** must materialise
in `occt-collab-worker/src/` by start of W3. The Wave 1 OCCT worker
exposes mesh-level booleans but not face-modify ops; E1 needs the
new endpoint. Wave 1 task #31 closure unblocks this in parallel with
Track Z's WebSocket dependency.

### Track Q — Quality + ship gate

**Why event-driven:** Q has only three deliverables (W4 gate, W8 gate,
W12 exit gate + W11 burn-in). Between gates, Q is dormant; the standup
file (`docs/wave-2-phase-3-standup.md`) absorbs day-to-day quality
signals.

- **Q1 (W11):** Full Wave 2 burn-in. 3 users × full pipeline × 3-hour
  soak. 20 × 5 STEP round-trip re-run. All Phase 2 features regression-
  tested in CRDT mode + direct-edit mode.
- **Q2 (W12):** Phase 3 exit gate. Green / Yellow / Red decision. Exit
  memo `docs/wave-2-phase-3-exit.md`.

### Track P — Polish / i18n / Perf / Sentry

A meta-track across all 12 weeks. No new feature code; the work is
i18n CSV additions (KR canonical → EN sync → JA / ZH / ES / AR per
project policy), Sentry breadcrumb tuning, perf-budget regression
catches, onboarding tour updates.

**Performance budgets (ADR-012 §8):**
- Sketch entity add — p95 ≤ 16ms (per-keystroke target).
- Feature tree reorder — p95 ≤ 50ms (drag-drop in tree).
- Direct-edit push-pull preview — p95 ≤ 30ms (live drag).
- Awareness propagation — p95 ≤ 200ms (peer cursor lag).
- Y.Doc snapshot encode (50 sketches × 200 segments + 500 features) —
  ≤ 5MB in-memory.

---

## 3. Weekly Breakdown — Per Track

### Track Z — CRDT Sync (8-week, integration done W8)

| Week | Tasks (spec / ADR ref) | Hours | Risk | Tests? |
|------|---|---|---|---|
| W1 | **Z1.** Yjs Provider in host: `useYDocProvider({docId})` hook. BroadcastChannel transport. y-indexeddb wire-up. WebSocket stub. Awareness scaffolding (no UI). ADR-012 §1, §2. | 18 | **HIGH** (cross-cutting host change) | Yes — 2-tab BroadcastChannel test |
| W2 | **Z2.** Sketch editor CRDT integration. Replace `useState<SketchSegment[]>` in `SketchCanvas.tsx` with `useSketchYjs(docId, sketchId)`. Atomic op application via `applySketchOp`. Flag `?crdt=v2`. 2-tab divergence test (peer A draws, peer B sees). ADR-011 §2.2, sketch spec (Phase 1). | 22 | **HIGH** (sketch is the most-touched editor surface) | Yes — F-Z-01 (2-tab sketch divergence) |
| W3 | **Z3.** Feature tree CRDT integration. Replace `useFeatureStack`'s `Map<string, HistoryNode>` with `useFeatureTreeYjs`. Atomic addNode (child + parent.children in one `doc.transact()`). Flag `?crdt=v2`. ADR-011 §2.4. | 20 | Med (atomic transact pattern proven in Phase 1) | Yes — F-Z-02 (2-tab tree concurrent insert) |
| W4 | **Z4.** Ref-geom CRDT (D3b from Phase 2). `ReferenceNode` storage migrates from local array (Phase 2 D3 left it local) to Y.Doc subtree. Dep-solver runs locally; only data is shared. Multi-user fixture. | 14 | Med | Yes — F-Z-03 (2-peer ref-geom add) |
| W5 | **Z5.** Awareness UI. Peer cursors in `SketchCanvas` (existing `AwarenessCursors.tsx` wires up). Peer-pinned active node highlight in feature tree. Peer-edited input-field highlight in modal forms. ADR-012 §3. | 18 | Med | Yes — Playwright awareness E2E |
| W6 | **Z6.** Branching. Per-doc branches (Y.Doc clone-on-write). Branch list UI. Switch / create / rename / delete. Merge button surfaces "Branch merging requires manual review — Phase 3 ships fork-only". ADR-012 §4. | 22 | **HIGH** (Y.Doc clone semantics; conflict on merge) | Yes — F-Z-04 (3-branch fork + switch) |
| W7 | **Z7.** Activity feed + presence panel. Op log surface (last 100 ops per doc, stored in Y.Array<OpLogEntry>). Presence panel: peer list, last-seen, current selection. | 14 | Low | Yes — Playwright activity feed |
| W8 | **Z8.** Permissions UI. Workspace-level (owner / editor / viewer) + doc-level (per-doc override). Role enforcement: client trusts server 404-not-403 response per ADR-011 §2.4. ADR-012 §5. | 18 | Med (server-side enforcement is the load-bearing piece) | Yes — F-Z-05 (perm denial test) |

**Track Z total: ~146 hours.**

### Track E — Direct Edit (5-week, integration done W7)

| Week | Tasks (ADR ref) | Hours | Risk | Tests? |
|------|---|---|---|---|
| W3 | **E1.** Foundation — face-pick + push-pull math. Three.js raycast → OCCT face id. Worker endpoint `/occt/op/direct/pushPull`. No history commit yet. Flag `?direct-edit=v1`. ADR-012 §6. | 24 | **HIGH** (new OCCT bindings; face-id correspondence is fragile) | Yes — F-DE-01 (single-face push-pull) |
| W4 | **E2.** Fillet/chamfer dynamic. Edge / face-pair pick → variable-radius fillet preview during live drag. Worker `/occt/op/direct/fillet`. | 20 | Med (extends E1 pattern) | Yes — F-DE-02 (dynamic fillet) |
| W5 | **E3.** Move/rotate body. Body-level transform pick → live-drag preview → worker-applied commit. Snap-to-axis hint. | 16 | Low | Yes — F-DE-03 (move + rotate) |
| W6 | **E4.** Subtract body. Body B subtracted from body A by face-pick → boolean. Worker `/occt/op/direct/subtract`. DFM warning on through-volume removed. | 18 | Med | Yes — F-DE-04 (boolean subtract) |
| W7 | **E5.** History merge. Direct-edit stack stored as Y.Array<DirectEditOp>. "Commit to history" button flushes stack into N feature-tree nodes (`DirectEditPushPull`, `DirectEditFillet`, etc.). Stack clears. Invalidate stack on history rerun-from-earlier. ADR-012 §6. | 20 | **HIGH** (session-state ↔ parametric-state transition is the largest correctness surface in Track E) | Yes — F-DE-05 (commit-to-history round-trip) |

**Track E total: ~98 hours.**

### Track Q — Quality / Gate (3 deliverables: W4, W8, W11/W12)

| Week | Tasks | Hours | Risk |
|------|---|---|---|
| W4 | Mid-Phase-3 gate (§7). Z1-Z4 + E1-E2 review. Worker deploy verify. 1-page gate memo at `docs/wave-2-phase-3-w4-gate.md`. | 4 | Low |
| W8 | Mid-Phase-3 gate (§7). Z5-Z8 + E3-E5 review. Permissions enforcement verify. 2-page gate memo at `docs/wave-2-phase-3-w8-gate.md`. | 6 | Low |
| W11 | **Q1.** Full Wave 2 burn-in. 3 users × full pipeline × 3-hour soak. 20 × 5 STEP round-trip. Phase 2 features in CRDT mode. Direct-edit mode end-to-end. | 16 | **HIGH** (the burn-in is the last chance to catch regressions before exit gate) |
| W12 | **Q2.** Phase 3 exit gate (§7). Green / Yellow / Red. 4-page exit memo at `docs/wave-2-phase-3-exit.md`. | 6 | Low |

**Track Q total: ~32 hours.**

### Track P — Polish / i18n / Perf / Sentry (all 12 weeks)

| Week | Tasks | Hours | Risk |
|------|---|---|---|
| W1 | Sentry coverage check on collab module. New i18n keys reserved. | 4 | Low |
| W2 | Sketch i18n audit (no new strings for Z2 — CRDT is invisible). | 2 | Low |
| W3 | Direct-edit dictionary (KR canonical). | 4 | Low |
| W4 | i18n KR + EN sync for direct-edit toolbar. | 4 | Low |
| W5 | Awareness color palette (8 colors, color-blind-safe). | 4 | Low |
| W6 | Branch UI strings 6-lang. | 6 | Low |
| W7 | Activity-feed strings 6-lang. | 6 | Low |
| W8 | Permissions strings 6-lang. | 4 | Low |
| W9 | End-to-end i18n sweep. JA / ZH / ES / AR translations land. | 12 | Med (JA / ZH / AR Cinese vs Korean idioms) |
| W10 | Sentry breadcrumb tuning. Perf-budget regression. | 8 | Med |
| W11 | Onboarding tour update for collab + direct-edit. | 6 | Low |
| W12 | Final UI polish. | 4 | Low |

**Track P total: ~64 hours.**

---

## 4. Dependency Graph

```
              ┌──────────────────────────────────────┐
              │  occt-collab-worker on wss://...     │ ← EXTERNAL pre-req for W4
              │  (Wave 1 task #31 closure)           │
              └─────────────┬────────────────────────┘
                            │
                            ▼
          ┌─────────────────────────────────────┐
          │  Z1 Yjs Provider in host            │ ← W1 P0
          └─────────────┬───────────────────────┘
                        │
        ┌───────────────┼─────────────────┬──────────────────┐
        ▼               ▼                 ▼                  ▼
    Z2 sketch       Z3 feature        Z4 ref-geom         (Z subtree
    CRDT integ      tree CRDT         CRDT  ◄── BLOCK     foundation
                                       on worker live)     complete W4)
        │               │                 │                  │
        └───────────────┴─────────┬───────┘                  │
                                  │                          │
                                  ▼                          │
                              Z5 awareness UI                │
                              (peer cursors + selection)     │
                                  │                          │
                                  ▼                          │
                              Z6 branching                   │
                              (Y.Doc clone-on-write)         │
                                  │                          │
                                  ▼                          │
                              Z7 activity feed               │
                              + presence panel               │
                                  │                          │
                                  ▼                          │
                              Z8 permissions UI              │
                              + role enforcement             │
                                                             │
       ┌─────────────────────────────────────────────────────┘
       ▼
   E1 face-pick + push-pull (W3 start; BLOCK on /occt/op/direct/* endpoints)
       │
       ▼
   E2 fillet/chamfer dynamic (W4)
       │
       ▼
   E3 move/rotate body (W5)
       │
       ▼
   E4 subtract body (W6)
       │
       ▼
   E5 history merge (W7) ─┐
                          │
                          ▼
                      Q1 burn-in (W11)
                          │
                          ▼
                      Q2 exit gate (W12)

       (Track P feeds Q1 continuously; Track P does not block any other track)
```

### Conflict surfaces (where two tracks touch the same code)

| File / surface | Tracks colliding | When | Mitigation |
|---|---|---|---|
| `ShapeGeneratorInner.tsx` Y.Doc provider | Z1 (W1) + E1 (W3) | W3 | Z1 lands first; E1 layers on top via `useDirectEditYjs(docId)` consuming the same provider. |
| `SketchCanvas.tsx` event handlers | Z2 sketch hook + Z5 awareness cursors | W2 + W5 | Z2 owns the hook contract first; Z5 extends `useSketchYjs` to emit awareness updates. |
| `useFeatureStack.ts` API surface | Z3 (replace internals) + E5 (commit-to-history adds nodes) | W3 + W7 | Z3 preserves the public hook API. E5 calls `addNode` through the public API; the Y.Doc backing is transparent to E5. |
| `nfabFormat.ts` serialization | Z3 (feature tree in Y.Doc) + E5 (direct-edit stack persisted on save?) | W7 | Direct-edit stack is **NOT persisted** on save (session-only). On save, the parametric tree is serialized; the stack is dropped. ADR-012 §6 locks this. |
| `referenceGeometry/__tests__/` fixtures | Z4 (Y.Doc-backed refs) + Phase 2 D4 fixtures | W4 | Z4 adds new `*.crdt.test.ts` fixtures; existing fixtures unchanged. Run both. |
| occt-collab-worker route table | Z1 (`/sync` WebSocket) + E1-E5 (`/occt/op/direct/*`) | W1, W3-W7 | Separate route namespaces; no overlap. |
| `configStoreYjs.ts` (already shipped W5 Phase 2) | Z1 host wire-up | W1 | Already CRDT; Z1 plugs it into the host provider. |

---

## 5. Task Specifications (canonical)

> Format: **ID** | name | spec / ADR ref | hours | dep | assignable | risk | tests

| ID | Task | Spec § | Hours | Dependency | Assignable | Risk | Test |
|---|---|---|---|---|---|---|---|
| **Z1** | Yjs Provider in host | ADR-012 §1, §2 | 18 | occt-collab-worker scaffold present | **user** (load-bearing host change) | HIGH | 2-tab BroadcastChannel |
| **Z2** | Sketch editor CRDT integration | ADR-011 §2.2 + ADR-012 §1 | 22 | Z1 | **user** (sketch is highest-touch surface) | HIGH | F-Z-01 2-tab |
| **Z3** | Feature tree CRDT integration | ADR-011 §2.4 + ADR-012 §1 | 20 | Z2 (proves the integration pattern) | either | Med | F-Z-02 2-tab |
| **Z4** | Ref-geom CRDT subtree | ADR-012 §1 | 14 | Z3 + worker live | agent | Med | F-Z-03 2-peer |
| **Z5** | Awareness UI | ADR-012 §3 | 18 | Z2 + Z3 | both | Med | Playwright |
| **Z6** | Branching + branches UI | ADR-012 §4 | 22 | Z4 | **user** (Y.Doc clone semantics) | HIGH | F-Z-04 3-branch |
| **Z7** | Activity feed + presence panel | ADR-012 §3 | 14 | Z6 | agent | Low | Playwright |
| **Z8** | Permissions UI + role enforcement | ADR-012 §5 + ADR-011 §2.4 | 18 | Z7 + server-side perm endpoint | **user** (server boundary) | Med | F-Z-05 perm denial |
| **E1** | Direct-edit foundation: face-pick + push-pull | ADR-012 §6 | 24 | `/occt/op/direct/*` endpoint scaffold | **user** (new OCCT bindings) | HIGH | F-DE-01 push-pull |
| **E2** | Direct-edit fillet/chamfer dynamic | ADR-012 §6 | 20 | E1 | either | Med | F-DE-02 dynamic fillet |
| **E3** | Direct-edit move/rotate body | ADR-012 §6 | 16 | E2 | agent | Low | F-DE-03 move + rot |
| **E4** | Direct-edit subtract body | ADR-012 §6 | 18 | E3 | both | Med | F-DE-04 boolean |
| **E5** | Direct-edit history merge | ADR-012 §6 | 20 | E4 + Z3 (history API) | **user** (session-↔-parametric boundary) | HIGH | F-DE-05 commit-to-history |
| **Q-W4** | W4 mid-Phase-3 gate memo | §7 | 4 | Z1-Z4 + E1-E2 done | **user** | Low | — |
| **Q-W8** | W8 mid-Phase-3 gate memo | §7 | 6 | Z5-Z8 + E3-E5 done | **user** | Low | — |
| **Q1** | Full Wave 2 burn-in | §7 W11 | 16 | All Z + E done | **user** (burn-in eyeballs) | HIGH | 3-hour soak + STEP matrix |
| **Q2** | Phase 3 exit gate memo | §7 W12 | 6 | Q1 results | **user** | Low | — |
| **P1-P12** | Polish / i18n / Sentry / perf | per matrix §3 | 64 total | continuous | mostly agent | Low-Med | various |

### Total estimated hours

- Track Z: 146h
- Track E: 98h
- Track Q: 32h
- Track P: 64h
- **Grand total: 340 engineer-hours**

### Calendar fit

- 12 weeks × 5 weekdays × 6 hours/day (sustainable solo pace) =
  **360 hours of dev capacity**.
- 340h estimated against 360h budget = **94% utilisation, 20h slack**.
- Agent absorbs ~35-45% of Low / Med tasks (~140h agent throughput across
  12 weeks); solo dev critical path ~200h.
- **Headroom is intentional and absorbs:**
  - occt-collab-worker deploy slip beyond W3 (W4 fallback to local-only test).
  - Direct-edit OCCT face-id fragility (E1 worst-case fall back to mesh-level only).
  - Permissions enforcement edge cases (Z8 worst-case ships "view-only" mode for shared docs).

### Bottom-line calendar estimate

- **10-11 weeks** of focused solo+agent work fits in the **12-week budget**.
- The 1-2 week slack is intentional and absorbs:
  - DO worker deploy ramp-up (Wave 1 task #31 close timing).
  - E1 OCCT push-pull binding fragility → fall back to mesh-level direct edit (degraded but ship-able).
  - Z6 Y.Doc clone-on-write semantics — if Y.Doc clone proves expensive on large docs, fall back to "branch = snapshot in branches Y.Map" pattern (snapshot on branch create, copy-on-write inside the branch).

---

## 6. Total Estimate — Asset Audit Correction

Each track has a "what exists today" reality check:

| Track | Naive estimate | What exists from Phase 1-2 | Correction | Net dev |
|---|---|---|---|---|
| Z CRDT Sync | 8 weeks × ~20h = 160h | Phase 1 primitives: `sketchYjs.ts` (725 LoC), `featureTreeYjs.ts` (615 LoC), `configStoreYjs.ts` (A5 W5), `offlinePersistence.ts` (137 LoC), `useOfflineSync.ts` (162 LoC), `AwarenessCursors.tsx`, `AwarenessPresencePanel.tsx`, 161 tests green. Phase 2 A5: configurations subtree wired end-to-end. | ~50% exists (primitives + 1 of 3 subtrees wired) | **~80h net new** wiring (sketch + tree + ref-geom + awareness + branching + activity + perm; against 146h budget = 66h slack absorbed by HIGH-risk tasks Z1/Z2/Z6) |
| E Direct Edit | 5 weeks × ~20h = 100h | OCCT worker has mesh-level booleans (Phase 1). Three.js raycast surface-pick exists in viewport. No `/occt/op/direct/*` route family yet. No face-id correspondence helper. | ~20% exists (raycast + booleans) | **~80h net new** (face-id mapping is the largest unknown; against 98h budget = 18h slack) |
| Q gate | 32h budget | Burn-in fixture set exists (Phase 2 `phase-2-burnin/`); soak runbook exists; STEP matrix exists. | ~70% exists (procedure documented) | **~28h** to extend coverage |
| P polish | 64h budget | i18n CSV exists, Sentry exists, onboarding tour exists. | ~60% exists (new strings + breadcrumbs only) | **~50h** active |
| **TOTAL** | — | — | — | **~238h net new** |

The naive 340h estimate over-budgets the Phase 1-2 inheritance. Real
net-new work is ~238h, fits comfortably in the 360h capacity with ~120h
slack — enough to absorb both HIGH-risk tasks AND the W4 / W8 gate
descope outcomes.

---

## 7. Decision Points (Phase 3 mid-review gates)

### Gate at end W4 (mid-Phase-3 stop-go)

**This is the major checkpoint.** Questions:
- Z1 Yjs Provider integrated end-to-end? `useYDocProvider({docId})` returns a Y.Doc that survives reloads via y-indexeddb?
- Z2 Sketch editor on `?crdt=v2`? 2-tab divergence test green (peer A draws a line, peer B sees it within 200ms)?
- Z3 Feature tree on `?crdt=v2`? Concurrent insert from 2 tabs converges to both nodes?
- Z4 Ref-geom subtree wired? 2-peer plane-add converges?
- E1 Direct-edit foundation? Single-face push-pull live drag works end-to-end?
- E2 Direct-edit fillet dynamic? Live drag preview is responsive (p95 ≤ 30ms)?
- occt-collab-worker on `wss://collab.nexyfab.com`? (External — Wave 1 task #31)

If YES → proceed to W5 (Z5 awareness UI, E3 move/rotate).

If NO → **descope decision tree**:
  1. **occt-collab-worker not deployed:** Continue with BroadcastChannel-only mode. Z4-Z7 fall back to local multi-tab only; remote collab demo postponed to W8.
  2. **E1 face-id mapping broken:** Fall back to **mesh-level direct edit** — direct edit operates on the rendered mesh and reapplies as a new feature-tree node on commit (E5 becomes the only path; no session-only stack). Degraded UX but shippable.
  3. **Z2/Z3 perf cliff:** Sketch entity add > 100ms → roll back sketch CRDT, ship Phase 3 with **feature tree + configs CRDT only**. Sketch stays single-user-per-doc.
  4. **Never slip Z1.** The provider is the foundation; everything else depends on it. If Z1 not done by W4, Phase 3 is in trouble — invoke Reversal B from ADR-011.

Output: 2-page gate memo at `docs/wave-2-phase-3-w4-gate.md` (4 hours).

### Gate at end W8 (Phase 3 mid-late stop-go)

**Second major checkpoint.** Questions:
- Z5 awareness UI shipping? Peer cursor latency p95 ≤ 200ms?
- Z6 branching UI working? Branch create / switch / list functional?
- Z7 activity feed + presence panel live?
- Z8 permissions enforced server-side? 404-not-403 on unauthorized doc access?
- E3 move/rotate body shipping?
- E4 boolean subtract shipping?
- E5 commit-to-history shipping?

If YES → proceed to W9-W10 polish (Track P heavy weeks) + W11 burn-in.

If NO → **descope decision tree**:
  1. **Z6 branching brittle on large docs (>5MB Y.Doc):** Ship Phase 3 with **read-only branches** — users can create + view branches but not switch + edit. Full branch editing → Phase 4.
  2. **Z8 permissions not server-side enforced:** Ship Phase 3 with **client-side permission display only**. All authenticated users have full edit access in practice; permissions UI is informational. Server-side enforcement → Phase 4 (high priority).
  3. **E5 commit-to-history corrupts parametric tree:** Disable "Commit to history" button. Direct edits remain session-only. User loses direct edits on session end. Document workaround: "Use 'Save snapshot' before direct editing."
  4. **Z2 sketch awareness perf cliff:** Ship awareness without sketch (feature tree + form fields only). Sketch awareness → Phase 4.

Output: 2-page gate memo at `docs/wave-2-phase-3-w8-gate.md` (6 hours).

### Gate at end W12 (Phase 3 exit gate)

**Mandatory go/no-go for Phase 4 entry.** Questions:
- All Z deliverables shipping-quality?
  - 3-user × 3-hour soak with all CRDT subtrees active: 0 unhandled crashes, < 2 "edit lost" incidents, sync RTT p95 < 200ms.
  - Branching: 5 branches per doc tested, fork-on-write working.
  - Permissions: 404-not-403 enforced; 3-role matrix (owner / editor / viewer) tested.
- All E deliverables shipping-quality?
  - F-DE-01..05 all green.
  - Direct-edit live drag p95 ≤ 30ms.
  - Commit-to-history round-trip clean on 10 test files.
- All Phase 2 features regression-clean in CRDT mode?
  - Sheet metal, hole wizard, threads, configs, ref-geom — all `phase2RegressionSuite.test.ts` green with `?crdt=v2`.
- Korean / EN / JA / ZH / ES / AR i18n complete for all new strings?
- Sentry < 5% failure rate on each `*.failure_rate` channel for collab + direct edit?

If YES → **Phase 4 starts** (AI / CAM / FEA work per ADR-010).
Flags `?crdt=v2` and `?direct-edit=v1` graduate to default-on in a
follow-up PR (separate from Phase 3 exit PR).

If NO → **Phase 3.5 buffer (2 weeks)**. Triage which features to
ship-flag-off vs. descope vs. push to Phase 4. Specifically:
  - **Yellow** (small regressions, 1-2 weeks fix): flags stay default-off, ship at end of Phase 3.5.
  - **Red** (CRDT divergence > 5%, or direct-edit corruption seen in soak): invoke ADR-011 Reversal B — flip `?crdt=*` off in production, keep CRDT codebase but disabled. Direct-edit can still ship if independent.

Output: 4-page exit memo at `docs/wave-2-phase-3-exit.md` (6 hours).

---

## 8. Risk Register

| # | Risk | Track | Severity | Trigger condition | Response | Reversal floor |
|---|---|---|---|---|---|---|
| **R-1** | occt-collab-worker not deployed by W3 (Wave 1 task #31 open) | Z | **HIGH** | `wss://collab.nexyfab.com` returns 404 at W3 Mon | Z4-Z8 fall back to BroadcastChannel + local-only. Remote collab demo postponed to W8 / W9. | Ship Phase 3 with local-multi-tab collab only; flag `?crdt=v2` enables sketch + tree CRDT but no remote peers. Remote → Phase 3.5 buffer. |
| **R-2** | Sketch CRDT introduces typing latency (Z2) | Z | **HIGH** | Sketch entity add p95 > 30ms in W2 soak | Profile + reduce transact frequency (batch keystroke ops in 50ms windows). Fallback: keep sketch local, only sync on segment-completion. | Ship Phase 3 with **sketch CRDT off**; feature tree + configs + ref-geom CRDT only. Sketch stays single-user. |
| **R-3** | Y.Doc clone-on-write expensive for branching (Z6) | Z | Med | Branch create > 2s on 5MB Y.Doc | Replace clone with **snapshot-in-Y.Map** pattern (branches subtree stores Y.Doc snapshots; copy-on-write within the branch). Trade: slower switch, faster create. | Ship Phase 3 with **read-only branches** (create + view, not switch + edit). |
| **R-4** | E1 OCCT push-pull face-id mapping fragile | E | **HIGH** | F-DE-01 fails on > 20% of test geometries in W3 | Fall back to **mesh-level direct edit** — pick on mesh face, OCCT receives mesh face index + position delta + normal, OCCT reconstructs B-Rep operation. Slower but works on more geometries. | Ship Phase 3 with mesh-level only. Native B-Rep face-pick → Phase 4. |
| **R-5** | E5 commit-to-history corrupts parametric tree | E | **HIGH** | F-DE-05 round-trip diff > 0 on > 10% of test files | Disable "Commit to history" button. Direct edits stay session-only. User loses direct edits on close. Document workaround: "Use 'Save snapshot' before direct editing." | Phase 4 reopens E5 with deeper review; Phase 3 ships direct-edit as session-only modality. |
| **R-6** | Z8 server-side permission enforcement not ready by W8 | Z | **HIGH** | `wss://` returns 200 to unauthenticated peer at W8 audit | Ship Phase 3 with **client-side display only** for permissions. All authenticated users have edit access in practice. Server-side enforcement → Phase 4 (high priority follow-up). | Same as response. |
| **R-7** | i18n drift (6 langs × ~80 new strings = 480 cells) | P | Med | i18n drift detector flags > 30 untranslated keys at W11 | KR canonical → EN sync → JA / ZH / ES / AR translation pass (W9 budget). | Ship Phase 3 with KR + EN canonical; AR / ES marked `[machine-translated]` with banner. |
| **R-8** | Solo dev burn-out (12 weeks of P0/P1 work in a row) | all | Med | Standup file shows 3+ consecutive "stuck / avoiding" entries | Slip a Track P week onto W10 → W12 buffer. Take a 3-day pause. **No heroics on the Phase 3 exit gate.** | Phase 3.5 is the official buffer (2 weeks); use it. |
| **R-9** | Agent throughput lower than 140h/12w estimate | all | Med | At W4 gate, agent-completed task list < 30% of expected | Re-balance: more low-risk Track P + Track Q tasks to agent, fewer touchpoints on Z critical path. User absorbs more medium-risk work. | If chronic, drop Track P polish work; ship with rough i18n + minimal Sentry, fix in Phase 3.5. |
| **R-10** | Wave 2 perf regression from CRDT overhead (~30% encoding) | all | Med | Burn-in p95 sketch/tree/perf creeps past Phase 2 budget | Profile after W4 + W8 burn-ins. Worst-case: ship with **per-feature CRDT opt-in** (sketch-only, or tree-only) rather than all-on. | Re-baseline perf budgets in soak runbook with documented "Phase 3 CRDT adds N% on average". |

---

## 9. Owner Table

| Task | Owner (this turn) | Owner (next turn) | User review time est. | Notes |
|------|---|---|---|---|
| **Z1** Yjs Provider | **user** | — | 4h (host integration; foundational) | Load-bearing; user reviews provider lifecycle + reload behavior. |
| **Z2** Sketch CRDT | **user** | — | 4h (sketch surface is highest-touch) | First end-to-end CRDT user-facing feature; user owns the latency profile. |
| Z3 Feature tree CRDT | both | user (review) | 2h | Pattern set by Z2; agent extends. |
| Z4 Ref-geom CRDT | agent | user (review) | 2h | Subtree migration; agent does the wiring, user verifies dep-solver. |
| **Z5** Awareness UI | both | user (UX) | 3h (peer cursor + selection UX) | Color palette + cursor smoothing user-owned. |
| **Z6** Branching | **user** | — | 5h (Y.Doc clone semantics; HIGH risk) | Largest unknown in Track Z; user holds mental model. |
| Z7 Activity + presence | agent | user (review) | 1h | Mechanical wiring once Z6 done. |
| **Z8** Permissions | **user** | — | 4h (server boundary; security-load-bearing) | 404-not-403 + role enforcement; user reviews server endpoint contracts. |
| **E1** Push-pull foundation | **user** | — | 5h (new OCCT bindings; HIGH risk) | User owns first-of-kind worker endpoint. |
| E2 Fillet dynamic | both | user (review) | 2h | Pattern set by E1. |
| E3 Move / rotate body | agent | user (review) | 1h | Mechanical. |
| E4 Boolean subtract | both | user (review) | 2h | DFM warning user-reviewed. |
| **E5** Commit to history | **user** | — | 5h (session-↔-parametric boundary; HIGH risk) | Largest correctness surface in Track E. |
| Q-W4 gate memo | **user** | — | 4h | User-owned gate. |
| Q-W8 gate memo | **user** | — | 6h | User-owned gate. |
| **Q1** Burn-in | **user** | — | 16h (3-user × 3-hour soak + STEP matrix) | Hands-on soak run + STEP eyeballs. |
| **Q2** Exit gate memo | **user** | — | 6h | Final go/no-go. |
| P1-P12 | mostly agent | user (gate reviews) | 1h / week (12h total) | Gates at W4 / W8 / W12 are user-owned. |

### User attention summary

| Block | User hours |
|---|---|
| Critical-path tasks (bolded above: Z1, Z2, Z6, Z8, E1, E5) | ~27h direct + ~36h review = 63h |
| Code review + UX click-throughs (other Z + E) | ~15h |
| Gate memos (W4 + W8 + W12) | ~16h |
| Burn-in (W11) | ~16h |
| **Total user attention over 12 weeks** | **~110h** |
| **User per-week attention** | **~9h/week** |

This is *review + verify + critical-path code* time. The agent absorbs
~140h of execution work. Net solo-dev time: 110h user critical + ~190h
execution = manageable in 12 weeks at sustainable pace.

---

## 10. Daily Standup Template (solo dev self-check)

File: `docs/wave-2-phase-3-standup.md` (append-only, one block per day).

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

### CRDT health (Phase 3 only)
- Today's "edit lost" incident count: __
- Today's sync RTT p95 (if measurable): __ms
- Today's Y.Doc snapshot size for biggest test doc: __MB
```

**Rule:** any single day with 3+ burn-out signals at 4-5 → mandatory
24h off + re-estimate the active task. Per Risk R-8.

**Rule:** any 3 consecutive days marked "blocked" on the same task →
escalate to either: descope (drop from the spec), park (move to Phase
3.5 buffer), or ask for review help (user vs agent flip).

**Rule (Phase 3 specific):** any single day with > 5 "edit lost"
incidents in the CRDT health line → halt feature work, run the Z2 /
Z3 / Z4 divergence-heal test suite, identify the source. CRDT
correctness is non-negotiable.

---

## 11. Track-level kickoff sequence (week-by-week)

This is the *suggested* execution order if everything goes nominal.

**Week 1 (Mon)**
- Verify Wave 1 task #31 status — occt-collab-worker deploy on track?
  If not, file the blocker and continue Z1 with local-only stub.
- Kick off Z1 (user starts; foundational host integration).
- Track P: Sentry coverage audit on collab module.

**Week 2 (Mon)**
- Verify Z1 merged. If not, **stop Z2 start** until Z1 lands (provider
  is the foundation).
- Kick off Z2 (user owns; sketch surface).

**Week 3 (Mon)**
- Verify Z2 merged + 2-tab divergence test green.
- Kick off Z3 (either; pattern set by Z2).
- Kick off E1 (user owns; new OCCT bindings; depends on /occt/op/direct/
  endpoint scaffold).

**Week 4 (Mon)**
- Run W4 gate (§7) before kicking off W4 tasks.
- Either proceed full speed (Z4, E2) or descope per gate output.
- Verify occt-collab-worker live by EOD or invoke fallback.

**Week 5 (Mon)**
- Verify Z4 merged + E2 merged.
- Kick off Z5 (both; awareness UI), E3 (agent; move/rotate).

**Week 6 (Mon)**
- Kick off Z6 (user owns; branching is the largest Z unknown), E4
  (both; boolean subtract).

**Week 7 (Mon)**
- Kick off Z7 (agent; activity feed), E5 (user owns; history merge).

**Week 8 (Mon)**
- Run W8 gate (§7) before kicking off W8 tasks.
- Kick off Z8 (user owns; permissions + server boundary).

**Week 9 (Mon)**
- Track P heavy week: i18n sweep, JA/ZH/ES/AR translations.

**Week 10 (Mon)**
- Track P: Sentry tuning, perf-budget regression.

**Week 11 (Mon)**
- **Q1 burn-in week.** 3-user × 3-hour soak, STEP matrix re-run.
- Daily standup tracks burn-in findings; defects feed back to Z / E for
  end-of-week fix.

**Week 12 (Mon)**
- Track P final polish.
- Track Q exit gate (§7).
- Phase 3 exit memo published.
- Flag-graduation PR drafted (separate; not in Phase 3 close PR).

---

## 12. Out of Scope (Phase 4 / Wave 3 hand-offs)

Each track has explicit out-of-scope items pushed to Phase 4 or Wave 3:

| Item | Source track | Target wave/phase |
|---|---|---|
| 3D viewport camera-position broadcast (peer-camera-sync) | Z5 awareness | P5 (Phase 5 polish) |
| Auto-merge UI for branches | Z6 branching | Phase 4 candidate |
| Sketch CRDT awareness — peer selection within a sketch profile | Z5 + Z2 | Phase 4 |
| Server-side permission enforcement (if Z8 ships client-only) | Z8 (Risk R-6 path) | Phase 4 (mandatory) |
| Per-feature CRDT-opt-in granularity (e.g. CRDT for tree only, not sketch) | Z (overall) | Phase 4 if R-2 triggers |
| Native B-Rep face-pick for direct edit (if R-4 triggers) | E1 | Phase 4 |
| Sub-cell direct edit (mesh-level vertex edit) | E (overall) | Wave 3 |
| Direct-edit history as a permanent feature (not session-only) | E (overall) | Wave 3 (revisit) |
| Collaborative direct edit (peers see each other's session stack) | Z + E | Wave 3 |
| AI / CAM / FEA work | all | **Phase 4 (next phase)** |
| Mobile / tablet UX for collab | Z | Phase 5 or Year 2 |
| Plugin SDK (3rd-party apps consume the Y.Doc) | Z | Year 2 |
| Onshape-style "release" / immutable doc versions | Z6 + nfabFormat | Wave 3 |
| STEP AP242 with collab metadata embedded | nfabFormat | Wave 3 |
| Per-doc commit messages (richer than activity feed) | Z7 | Phase 4 candidate |
| Audit log export | Z7 + Z8 | Phase 4 candidate |
| 2FA / SSO for workspace membership | Z8 | Phase 4 |

---

## 13. Cross-references

- `docs/adr/010-...md` — Wave 2 = B-Full + collab (canonical in master memory; not on disk in this worktree)
- `docs/adr/011-crdt-architecture-and-phase-2-scope.md` — CRDT Y.Doc shape locked; subtrees defined; Reversal A/B documented
- `docs/adr/012-wave-2-phase-3-crdt-integration-and-direct-edit.md` — companion decision capture for this tracker
- `docs/wave-2-phase-2-master-task-tracker.md` — Phase 2 (structurally mirrored here)
- `docs/wave-2-crdt-architecture.md` — 1,105-line CRDT design spike
- `docs/wave-2-phase-2-configurations-spec.md` — A5 (W5) shipped Y.Map-backed ConfigStore
- `docs/wave-2-phase-2-sheet-metal-spec.md` — B5 Phase 2 shipped Korean UI + bend table
- `docs/wave-2-phase-2-hole-wizard-spec.md` — C6 Phase 2 shipped V2 flag flip
- `docs/wave-2-phase-2-reference-geometry-spec.md` — D4 Phase 2 shipped; D3 ref-geom is the Z4 subtree
- `docs/wave-2-phase-2-threads-spec.md` — D8 Phase 2 shipped drawing-callout prep
- `docs/wave-2-soak-runbook.md` — burn-in procedure for Q1
- `docs/wave-1-compat-matrix.md` — 20 × 5 STEP matrix re-run target for Q1
- `occt-collab-worker/` — Cloudflare DO transport (deploy = Wave 1 task #31)
- `src/app/[lang]/shape-generator/collab/` — Phase 1 CRDT primitives + Phase 3 integration target

---

## 14. Top 3 Priorities (TL;DR for the user)

1. **Z1 Yjs Provider (Week 1, user-owned, HIGH risk)** — the foundation
   for every other Z task. If Z1 slips, the entire 8-week Track Z slides
   accordingly. Non-negotiable W1 task.
2. **occt-collab-worker deploy (external, Wave 1 task #31)** — by W3
   start at latest, ideally W1. The worker is scaffolded in PR #35 but
   not deployed. Without it, Z4-Z7 fall back to local-only mode and the
   "Phase 3 ships remote collab" demo is at risk.
3. **E1 + E5 direct-edit pair (Week 3, Week 7, user-owned)** — E1's OCCT
   face-id mapping is the largest unknown in Track E (mesh-level
   fallback exists but is degraded UX). E5's commit-to-history is the
   largest correctness surface (session-↔-parametric transition). User
   attention clusters W3 + W7 on these two.

---

*End of master task tracker. Update at each gate (W4 / W8 / W12) with
actuals vs. estimates.*
