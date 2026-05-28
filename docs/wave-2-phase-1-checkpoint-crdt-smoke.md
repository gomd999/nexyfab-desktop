# Phase 1 Review — CRDT Smoke Harness Runbook

**Purpose:** Provide two 60-second browser checks that the Phase 1 Week 2
CRDT prototypes work end-to-end in a real browser. This is checkpoint
signal #1 of three for the Phase 1 → Phase 2 review decision (per
[ADR-010](adr/010-wave-2-b-full-collab.md)).

The 161 vitest tests in `src/app/[lang]/shape-generator/collab/__tests__/`
already exercise the API surface in node with `fake-indexeddb`. These
harnesses add the missing piece — confirming the same code paths run in
a real browser yjs runtime.

## Four routes (sketch + feature tree + persistence + configs)

| Route | Module under test | What it proves |
|---|---|---|
| `/[lang]/collab-smoke` | `sketchYjs.ts` | `Y.Map<id, Y.Map>` (keyed) CRDT converges in browser |
| `/[lang]/collab-smoke-feature-tree` | `featureTreeYjs.ts` | `Y.Array<Y.Map>` (ordered) + sibling `Y.Map<sketchId>` converges |
| `/[lang]/collab-smoke-persistence` | `offlinePersistence.ts` | Real-browser IndexedDB persistence survives close/reopen + clears cleanly |
| `/[lang]/collab-smoke-configs` | `configStoreYjs.ts` (Phase 2 W5 / A5) | `Y.Map<configId, Y.Map>` + flat per-key params Y.Map converges; LWW on rename / setActive / setParent |

The four modules have different runtime concerns — sketches are
unordered CRDT, the feature tree is ordered, persistence is
browser-only IndexedDB (uncovered by node-side `fake-indexeddb`), and
configurations have the flattened-params topology that prevents the
two-peer-creates-disjoint-Y.Map merge anomaly found during A5
implementation. Running all four is the full signal #1 coverage for
Phase 1 + Phase 2 W5.

All four routes are **not linked from any nav** — only reachable by
typing the URL. They are developer tools.

## What you see

Two side-by-side panels (A blue, B green), each owning an independent
`Y.Doc`. Both bootstrap with one empty sketch keyed by `smoke-sketch`.

Controls per panel:
- `+ Segment` — add a random line segment via `applySketchOp({ kind: 'addSegment' })`
- `Move first` — translate the first segment's start point via `updateSegment`
- `− First` — `removeSegment` on the first one

Global controls:
- `auto-sync` checkbox — when on, every local update on A is immediately
  applied to B (and vice versa) via `Y.encodeStateAsUpdate` /
  `Y.applyUpdate`. This mirrors the cloud-transport path.
- `Sync A→B` / `Sync B→A` — full-state push, useful after disabling auto-sync.
- `Stress: 20 concurrent` — disables auto-sync, adds 10 segments to each
  panel, then runs a two-way manual sync. Demonstrates that concurrent
  ops on different ids merge cleanly.

Status badge in the upper right shows `CONVERGED` / `DIVERGED` based on
segment count equality between A and B.

## 60-second checklist

Run through these. **All four should pass.** If any fail, report Yellow
or Red on signal #1.

1. **Basic round-trip.** With auto-sync ON, click `+ Segment` on A three
   times. Both panels should show the same 3 segments with identical ids
   and points. Status: CONVERGED.

2. **Concurrent different-id merge.** Turn auto-sync OFF. Click `+ Segment`
   on A twice and on B twice (so each has different segments). Click
   `Sync A→B` then `Sync B→A`. Both panels should now show 4 segments
   total. Status: CONVERGED.

3. **Concurrent same-id LWW.** With auto-sync OFF: on A click `+ Segment`
   once, then `Sync A→B` (now both panels know about that segment). Click
   `Move first` on A. Click `Move first` on B. Both panels now have
   different positions for the same segment id. Click `Sync A→B` then
   `Sync B→A`. Both panels should converge on the same value (whichever
   peer's clock won — LWW is deterministic; the value is not predictable
   but the convergence is).

4. **Stress.** Click the `Stress: 20 concurrent` button. Op log should
   show 20 adds then two manual syncs. Status: CONVERGED, both panels
   showing 20 segments.

## Feature-tree checklist (`/[lang]/collab-smoke-feature-tree`)

Same shape, different ops. **All four should pass.**

1. **Basic round-trip.** Auto-sync ON, click `+ Feature` on A three
   times. Both panels show root + 3 features with identical ids,
   types, and params. Status: CONVERGED.

2. **Concurrent different-id merge.** Auto-sync OFF. `+ Feature` twice
   on A and twice on B. `Sync A→B` then `Sync B→A`. Both panels show
   root + 4 features. Status: CONVERGED.

3. **Concurrent per-key param merge.** Auto-sync OFF: `+ Feature` on
   A once, `Sync A→B`. Click `Edit first` on A (changes one param).
   Click `Edit first` on B (changes another param, since edit picks
   the first param key — but if both panels have only one param the
   updates collide and LWW; that's expected). `Sync A→B`, `Sync B→A`.
   Both panels converge to the same param values.

4. **Stress.** `Stress: 20 concurrent` button. Both panels end with
   root + 20 features. Status: CONVERGED.

## Persistence checklist (`/[lang]/collab-smoke-persistence`)

This one is browser-only — `fake-indexeddb` cannot test the same
runtime. **All four should pass.**

1. **Survival round-trip.** On a fresh page (after `Wipe + reopen` if
   prior runs left state): click `+ Segment` three times. **Refresh
   the browser tab.** The page loads, status badge shows
   `READY · cycle #1 · 3 seg`, segments list shows the same 3 ids.
   Op log shows `replayed 3 segments from cache`.

2. **Close + reopen.** Click `Close + reopen`. Status flickers
   `WAITING…` then `READY · cycle #2 · 3 seg`. Segments unchanged.

3. **Wipe.** Click `Wipe + reopen`. Status returns to
   `READY · cycle #N · 0 seg`. Segments list is empty. Op log shows
   `DB deleted, opening fresh`.

4. **Cache size sanity.** After adding 10+ segments and clicking
   `Refresh size`, the badge should show non-zero KB (likely tens
   of KB — origin total, may include other sites). Wipe should
   not necessarily drop it (other origins share the budget).

## Configurations checklist (`/[lang]/collab-smoke-configs`) — Phase 2 A5

Companion to the three Phase 1 routes. Same two-panel pattern; ops
are configurations CRDT primitives (`addConfig`, `setOverride`,
`renameConfig`, `removeConfig`). **All four should pass.**

1. **Basic round-trip.** Auto-sync ON, click `+ Config` on A three
   times. Both panels show master + 3 configs with identical ids,
   names, and (empty) overrides. Status: CONVERGED.

2. **Concurrent different-id merge.** Auto-sync OFF. `+ Config` twice
   on A and twice on B. `Sync A→B` then `Sync B→A`. Both panels show
   master + 4 configs. Status: CONVERGED.

3. **Concurrent override merge.** Auto-sync OFF: `+ Config` on A once
   then `Sync A→B`. Click `Override first` on A. Click `Override first`
   on B (same target, same param key — LWW). `Sync A→B`, `Sync B→A`.
   Both panels converge to the same param value (whichever peer's
   clock won). The flat per-key params topology guarantees that
   disjoint-key concurrent overrides BOTH survive — not exercised by
   the UI (which only edits the `radius` key) but covered by
   `configStoreYjs.divergence.test.ts` case #8.

4. **Stress.** `Stress: 40 concurrent` button — 10 adds + 10 overrides
   on each panel. Both panels end with master + 20 configs. Status:
   CONVERGED.

The node-side soak (`__tests__/configStoreSoak.test.ts`) runs
3 peers × 150 random ops × 6 seeds with assertions that all peers
converge after each op — that's the heavy CI signal. The browser
harness only verifies the same code path runs under React + jsdom
client bundling.

## What this does NOT verify

- **Cloud transport.** This harness uses in-memory Y.Doc-to-Y.Doc
  shipping. The Cloudflare Worker + Durable Object path
  (`occt-collab-worker/`) is exercised by its own tests and a real
  deployment is not part of this signal.
- **IndexedDB persistence.** `offlinePersistence.ts` is covered by its
  own 15 vitest cases. This harness intentionally does not persist —
  reload clears state.
- **Awareness / multi-cursor / chat.** Those modules
  (`AwarenessCursors.tsx`, `CollabChat.tsx` etc.) are scaffolded but not
  wired here.
- **Feature tree CRDT.** `featureTreeYjs.ts` has its own 22 tests but no
  harness yet — sketch is the most fragile primitive (Y.Map re-key wart,
  JSON-LWW for points), so it gets the smoke first.

## Finding while building the harness

The first version of the harness bootstrapped `createSketch` on both
panels independently. Tests failed: panel B "lost" segments after sync.
Root cause: two `createSketch` ops with the same `sketchId` on
different docs create competing entries on the root Y.Map; one wins LWW
and the loser's entire sub-tree (including any segments added before
sync) is discarded.

`sketchYjs.ts:417` documents this as a UI-bug case ("caller is
responsible for not colliding ids"). The harness now bootstraps on
panel A only and ships the initial Y update to panel B, mirroring how
production collab will work (peers arrive at an existing cloud doc via
sync, they do not race to create the doc locally).

**Implication for Phase 2:** the cloud document API must guarantee
"join existing doc" is the only path; clients should never call
`createSketch` for a sketchId they did not just receive from the
server. This is already implied by the cloud document migration doc
§1.5 ("IndexedDB is a cache — never authoritative") but worth calling
out as a concrete invariant.

## Phase 3 Z2 — sketch CRDT in the production editor (flag-gated)

Phase 3 wires the sketch CRDT through the production `SketchPanel` via the
new `SketchStore` adapter (`src/app/[lang]/shape-generator/sketch/SketchStore.ts`)
and the `useSketchStore` hook. The flag is `?crdt=v2` (default OFF — legacy
useState path stays the production default until W4 gate).

**Smoke**: try editing a sketch in `?crdt=v2` mode across two tabs;
convergence confirmed.

Procedure:
1. Open `/[lang]/shape-generator?crdt=v2` in two tabs of the same browser
   (the BroadcastChannel fallback bridges them while Z1's CollabProvider
   is in parallel development).
2. Draw a line in tab A — should appear in tab B within ~100 ms.
3. Drag the same line's endpoint in both tabs simultaneously — both tabs
   converge on one position (LWW), and the loser tab shows the
   "Your edit was overridden by …" toast in the SketchPanel header.
4. Add a constraint in tab A → appears in tab B.

What this proves: the `SketchStore` adapter routes mutations through
`applySketchOp` so the Y.Doc remains the convergence source, with the
panel rendering from the same store via the React subscribe pattern.

What this does NOT prove (deferred to Z1 + W4 gate):
- Cross-network sync (BroadcastChannel is same-origin only — the
  Cloudflare Calls / Durable Object transport is Z1's territory).
- Awareness peer names — the toast falls back to "another collaborator"
  until Z1 wires `resolvePeerName`.
- Default-on flag rollout — `?crdt=v2` stays opt-in through W3.

## Phase 3 Z3 — feature tree CRDT integration (flag-gated)

Phase 3 W3 wires the feature tree (history nodes + sketches map + meta)
through the production editor via the new `FeatureTreeStore` adapter
(`src/app/[lang]/shape-generator/featureTree/FeatureTreeStore.ts`) and the
`useFeatureTreeStore` hook. The flag is `?crdt=v2` (default OFF — legacy
`useFeatureStack` reducer path stays the production default until W4 gate).

**Smoke**: try reordering a feature in `?crdt=v2` mode across two tabs;
convergence confirmed.

Procedure:
1. Open `/[lang]/shape-generator?crdt=v2` in two tabs of the same browser
   (the BroadcastChannel fallback bridges them while occt-collab-worker is
   pre-deploy).
2. Add a fillet feature in tab A → should appear in tab B within ~100 ms.
3. Drag the fillet to reorder it in tab A → tab B reflects the new order.
4. Edit the same fillet's `radius` param in BOTH tabs simultaneously →
   both tabs converge on one value (LWW), and the loser tab shows the
   "Your edit on \"F1\" was overridden by …" toast in the feature-tree
   panel header.
5. Toggle a feature's enabled flag in tab A → tab B mirrors the change.

What this proves: the `FeatureTreeStore` adapter routes mutations through
`applyFeatureOp` (from Phase 1 W2 `featureTreeYjs.ts`) so the Y.Doc remains
the convergence source. The `useFeatureTreeStore` hook composes a local-mode
store when the flag is OFF and a Yjs-mode store backed by either the Z1
`<CollabProvider>` doc (via `<CollabDocBridge>`) or a per-`docId` BC
fallback when the Provider isn't wrapping the call site.

What this does NOT prove (deferred to Z1 wiring + W4 gate):
- Cross-network sync (same as Z2 — BroadcastChannel is same-origin only).
- Per-peer `editingNodeId` UI — Z3 keeps editing pointer local per peer
  (intentional, see `FeatureTreeStore.ts` header on the spec ambiguity);
  Z5 will surface remote peers' editing focus via awareness, not the doc.
- `useFeatureStack` retrofit — the legacy reducer stays untouched. Opt-in
  is via the new `useFeatureStackBridge(crdtDocId)` hook; W4 walks call
  sites and migrates them one-by-one behind the flag.

## Phase 3 Z4 — reference geometry CRDT in the production editor (flag-gated)

Phase 3 Z4 wires the reference-geometry CRDT through the production editor
via the new `RefGeomStore` adapter
(`src/app/[lang]/shape-generator/referenceGeometry/RefGeomStore.ts`) and the
`useRefGeomStore` hook. The flag is `?crdt=v2` (default OFF — the existing
Zustand `useReferenceGeometryStore` stays the production default until W4
gate).

**Smoke**: try creating ref-geom planes in `?crdt=v2` across two tabs;
cycle detection across peers verified.

Procedure:
1. Open `/[lang]/shape-generator?crdt=v2` in two tabs of the same browser
   (the BroadcastChannel fallback bridges them while Z1's CollabProvider
   wiring is parallel).
2. Add a reference plane (e.g. an offset plane parented to Front) in
   tab A — it should appear in tab B within ~100 ms.
3. Edit the plane's offset distance in both tabs concurrently — the
   JSON-LWW resolves; both tabs converge on one value, and the loser tab
   shows the "Your ref-geom edit was overridden by …" toast via the
   `useRefGeomLwwCollisionToast` hook.
4. Cross-peer cycle case: in tab A add plane X depending on plane Y; in
   tab B (disconnected — disable auto-sync if available, or do this very
   quickly) add plane Y depending on plane X. When the sync runs, BOTH
   tabs surface the `useRefGeomCycleWarning` banner showing the cycle
   path X→Y→X. The cycle is NOT auto-broken; the user breaks it by
   editing one of the deps (e.g. changing X to method='standard').

What this proves: the `RefGeomStore` adapter routes mutations through
`applyRefGeomOp` so the Y.Doc remains the convergence source, with the
`useRefGeomCycleWarning` hook running `findAllCycles` on every update so
the merged-graph cycle case (which neither peer's `wouldCreateCycle`
local check rejected) surfaces in the UI.

What this does NOT prove (deferred):
- Cross-network sync (BroadcastChannel is same-origin only).
- Awareness peer names on the LWW toast — falls back to
  "another collaborator" until Z1 wires `resolvePeerName`.
- Awareness cursors over ref-geom dialog inputs — that's Z5's territory.
- Default-on flag rollout — `?crdt=v2` stays opt-in through W3.

## Phase 3 E1 — direct edit foundation (flag-gated)

Wave 2 Phase 3 W3 introduces the **direct edit** modality. E1 ships
the foundation: face-pick + push-pull math + session-only stack +
toolbar. Flag-gated `?direct-edit=v1`; default-OFF until W11 burn-in.

ADR-012 §6 lock-ins (recap):
- Session-only Y.Array stack; **NOT** persisted by `serializeProject`.
- History-rerun invalidates the stack with a non-blocking toast.
- Opt-in commit-to-history is E5 (W7), out of scope for E1.

60-second smoke (manual, single user):

1. Open `/[lang]/shape-generator?direct-edit=v1`
2. Generate a `box` base shape (so the +Y face exists with a known
   `lastFeatureId` set by the pipeline).
3. Enable the **Direct edit** toggle in the toolbar.
4. Click a face on the box and drag along its normal — release.
5. Check the toolbar status: "1 direct edit applied this session".
6. Click **Undo direct edit** → status returns to "No direct edits".
7. Push two more ops, then re-run the parametric history (toggle any
   feature in the tree to bump `historyVersion`). Expect a toast:
   *"Direct edits cleared — history was rerun."*
8. Re-export the .nfab and re-open. Expect: **none** of the direct
   edits persisted (session-only by design).

Passing all 8 steps = E1 foundation Green. Failure cases (non-planar
face on a cylinder, oversize offset, malformed faceId) are covered by
unit tests in `src/app/[lang]/shape-generator/directEdit/__tests__/`.

## Reporting result

Update [project_nexyfab_wave2_phase1_complete.md](../.. memory note) or
just tell the assistant which of the four checks passed/failed. The
Green/Yellow/Red decision matrix:

- All 4 pass → **signal #1 Green**, contributes to overall Green
- Any 1-2 fail → **signal #1 Yellow**, investigate before Phase 2 entry
- 3-4 fail → **signal #1 Red**, prototype work needed before Phase 2
- Page won't load / crashes on first add → **signal #1 Red**, build issue
