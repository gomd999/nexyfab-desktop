# Phase 1 Review — CRDT Smoke Harness Runbook

**Purpose:** Provide two 60-second browser checks that the Phase 1 Week 2
CRDT prototypes work end-to-end in a real browser. This is checkpoint
signal #1 of three for the Phase 1 → Phase 2 review decision (per
[ADR-010](adr/010-wave-2-b-full-collab.md)).

The 161 vitest tests in `src/app/[lang]/shape-generator/collab/__tests__/`
already exercise the API surface in node with `fake-indexeddb`. These
harnesses add the missing piece — confirming the same code paths run in
a real browser yjs runtime.

## Three routes (sketch + feature tree + persistence)

| Route | Module under test | What it proves |
|---|---|---|
| `/[lang]/collab-smoke` | `sketchYjs.ts` | `Y.Map<id, Y.Map>` (keyed) CRDT converges in browser |
| `/[lang]/collab-smoke-feature-tree` | `featureTreeYjs.ts` | `Y.Array<Y.Map>` (ordered) + sibling `Y.Map<sketchId>` converges |
| `/[lang]/collab-smoke-persistence` | `offlinePersistence.ts` | Real-browser IndexedDB persistence survives close/reopen + clears cleanly |

The three modules have different runtime concerns — sketches are
unordered CRDT, the feature tree is ordered, and persistence is
browser-only IndexedDB (uncovered by node-side `fake-indexeddb`).
Running all three is the full signal #1 coverage.

All three routes are **not linked from any nav** — only reachable by
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

## Reporting result

Update [project_nexyfab_wave2_phase1_complete.md](../.. memory note) or
just tell the assistant which of the four checks passed/failed. The
Green/Yellow/Red decision matrix:

- All 4 pass → **signal #1 Green**, contributes to overall Green
- Any 1-2 fail → **signal #1 Yellow**, investigate before Phase 2 entry
- 3-4 fail → **signal #1 Red**, prototype work needed before Phase 2
- Page won't load / crashes on first add → **signal #1 Red**, build issue
