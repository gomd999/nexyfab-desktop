# Wave 2 Phase 3 — W4 Mid-Phase-3 Gate Runbook

> Status: **runbook draft** — written W4-precursor to feed the W4 gate
> decision. The actual W4 gate is user-owned (master tracker §9 Owner
> Table); this document is the agent-prepared evidence + procedure.
>
> Companion: `docs/wave-2-phase-3-compat-evidence.md` for the
> automated-test signals this runbook references.

---

## 1. The four Phase 3 gates at a glance

Per `docs/wave-2-phase-3-master-task-tracker.md` §7 and ADR-012 §9, the
Phase 3 critical path has four gates:

| Gate | Week | Owner | Mandate                                                      | Memo target                                     |
|------|------|-------|--------------------------------------------------------------|-------------------------------------------------|
| W4   | W4   | user  | Z1-Z4 + E1-E2 done? Continue or descope?                     | `docs/wave-2-phase-3-w4-gate.md` (2 pages, 4h)  |
| W8   | W8   | user  | Z5-Z8 + E3-E5 done? Permissions server-side?                 | `docs/wave-2-phase-3-w8-gate.md` (2 pages, 6h)  |
| W11  | W11  | user  | Q1 full Wave 2 burn-in (3-user × 3-hour soak + STEP matrix)  | (no memo — feeds W12)                            |
| W12  | W12  | user  | Q2 Phase 3 exit gate. Green / Yellow / Red.                  | `docs/wave-2-phase-3-exit.md` (4 pages, 6h)     |

This runbook is for **W4 only**. The W8 / W12 runbooks build on this
template and will be drafted at W7 / W11.

---

## 2. W4 status to date (Phase 3 W1-W3)

The Phase 3 stack to W3 head (`origin/wave-2/phase-3-w3-e1-direct-edit-stack`)
delivers FIVE PRs:

| PR  | Track | Deliverable                                                     | Status     |
|-----|-------|-----------------------------------------------------------------|------------|
| 1   | Z1    | Yjs Provider — local + BC + IDB + WS-ready foundation           | Merged W2  |
| 2   | Z2    | Sketch CRDT — `SketchStore` adapter (`?crdt=v2`)                | Merged W2  |
| 3   | Z3    | Feature tree CRDT — `FeatureTreeStore` adapter (`?crdt=v2`)     | Merged W3  |
| 4   | Z4    | Ref-geom CRDT — `RefGeomStore` adapter (`?crdt=v2`)             | Merged W3  |
| 5   | E1    | Direct-edit foundation — push-pull + session stack              | Merged W3  |

W4 work in flight:
  - **E2** Fillet/chamfer dynamic — variable-radius live drag (in progress)
  - **P-W4** i18n KR + EN sync for direct-edit toolbar
  - **Q-precursor (THIS PR)** compat + perf + soak harness + runbook

The Q-precursor is NOT a tracker task — it's an agent-side derisking
step so the W4 gate has automated evidence to lean on, not just user
eyeballs.

---

## 3. The W4 questions (verbatim from master tracker §7)

Per `docs/wave-2-phase-3-master-task-tracker.md` §7 W4:

1. Z1 Yjs Provider integrated end-to-end? `useYDocProvider({docId})`
   returns a Y.Doc that survives reloads via y-indexeddb?
2. Z2 Sketch editor on `?crdt=v2`? 2-tab divergence test green (peer A
   draws a line, peer B sees it within 200ms)?
3. Z3 Feature tree on `?crdt=v2`? Concurrent insert from 2 tabs
   converges to both nodes?
4. Z4 Ref-geom subtree wired? 2-peer plane-add converges?
5. E1 Direct-edit foundation? Single-face push-pull live drag works
   end-to-end?
6. E2 Direct-edit fillet dynamic? Live drag preview is responsive
   (p95 ≤ 30ms)?
7. occt-collab-worker on `wss://collab.nexyfab.com`? (External — Wave
   1 task #31)

---

## 4. Decision matrix — Green / Yellow / Red

### Green → proceed to W5 (Z5 awareness + E3 move/rotate)

All of:
- Compat suite 100% pass (excluding documented `.todo` divergences).
- Perf bench: all p95 budgets met (sketch add ≤ 16ms, tree reorder ≤ 50ms,
  refgeom add ≤ 16ms, direct-edit ≤ 30ms).
- Soak harness: 18/18 convergence runs (3 stores × 6 seeds × 3 peers ×
  100 ops).
- Two-tab manual verification (peer-A-draws / peer-B-sees) within 200ms.
- occt-collab-worker reachable at `wss://collab.nexyfab.com`.

### Yellow → W4 with mitigation (continue, but log a known issue)

Any of:
- Compat suite has a small NEW divergence (additional to the 3 documented
  `.todo` cases below). Mitigation: file follow-up + descope the affected
  surface from W5-W8 work.
- Perf bench p95 exceeds budget by < 25%. Mitigation: profile, but don't
  block. Carry to W8.
- Soak harness has a flake on 1 seed but is reproducible-clean on the
  same seed when re-run. Mitigation: pin the seed, file investigation
  ticket for W8.
- occt-collab-worker reachable but rate-limited. Mitigation: continue;
  proceed on BroadcastChannel + y-indexeddb fallback.

### Red → invoke ADR-011 Reversal B

Any of:
- Compat suite has a NEW divergence on byte-identical equivalence
  (legacy ≠ v2 silently). Reversal: flip `?crdt=v2` default-OFF
  flag-gate harder (no auto-graduation path through W11) and file a
  full-scope investigation.
- Perf bench p95 exceeds budget by > 50% on any of sketch-add /
  tree-reorder / refgeom-add. Reversal per ADR-012 line 67-69: trigger
  Phase 3.5 buffer immediately.
- Soak harness has a divergence under random workload (any of 18 runs
  fails convergence). Reversal: full Phase 3 stop. Pull `?crdt=v2`
  default-OFF guard. Reversal B per ADR-011 §Reversal B.
- occt-collab-worker unreachable AND no BroadcastChannel fallback.
  Descope per master tracker §7.W4.1.

---

## 5. Documented divergences (W4 baseline — pre-existing, NOT a Red signal)

The Q-precursor compat suite (this PR) discovered three divergences
between local-mode and Yjs-mode of the FeatureTreeStore. **These are
pre-existing and the W4 gate should NOT treat them as Red** — they are
adapter-layer semantic gaps documented in
`src/app/[lang]/shape-generator/__tests__/phase3CompatSuite.test.ts`:

| # | Surface                          | Divergence                                                                                                                                  | Disposition         |
|---|----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|---------------------|
| 1 | `reorder(id, toIndex)`           | Local: reorders `parent.children[]`. Yjs: reorders the flat `tree` Y.Array index; `parent.children[]` unchanged.                            | follow-up, NOT now  |
| 2 | `getSnapshot().tree.nodes[i].sketchData` after `addNode(node, sketchData)` | Local: `sketchData` lives only in `sketches[id]`. Yjs decoder hydrates `sketchData` back onto the node from `sketches[id]`. | follow-up, NOT now  |
| 3 | `getSnapshot().tree.nodes[i].sketchData` after `updateSketch(id, patch)` | Same shape as #2. The `sketches[id]` map matches; the node-embedded copy diverges.                                            | follow-up, NOT now  |

The remaining 35 compat cases pass byte-identical. ADR-012 §9 graduation
gate (W11) should require these three to be unified before flipping
`?crdt=v2` default-ON (or the embedded-sketchData consumers must be
audited for safe behaviour under both modes).

---

## 6. Mandatory signals — automated test commands

Run from repo root. Each must report exit 0.

### 6.1 Compat suite (legacy = v2 byte-identical for canonical ops)

```sh
npx vitest run src/app/[lang]/shape-generator/__tests__/phase3CompatSuite.test.ts
```

Expected: 37 passed, 1 todo (the documented reorder divergence).

### 6.2 Perf bench (ADR-012 §8 budgets)

```sh
npx vitest run src/app/[lang]/shape-generator/__tests__/phase3PerfBench.test.ts
```

Expected: 13 passed. The CI reporter prints per-case p50/p95/p99 lines —
copy them into the W4 memo for trend tracking.

### 6.3 Soak harness (3 stores × 6 seeds × 3 peers × 100 ops)

```sh
npx vitest run src/app/[lang]/shape-generator/__tests__/phase3SoakHarness.test.ts
```

Expected: 18 passed (no flakes). Any divergence triggers a Red signal
under §4 above.

### 6.4 Phase 2 regression (sanity — Phase 2 features still work)

```sh
npx vitest run src/app/[lang]/shape-generator/io/__tests__/phase2RegressionSuite.test.ts
```

Expected: all green. Failure here means a Phase 2 feature regressed
during W1-W3 work (which would itself be a Red signal — Phase 3 work
should NOT touch Phase 2 surfaces).

### 6.5 Store-level adapter tests

```sh
npx vitest run \
  src/app/[lang]/shape-generator/sketch/__tests__/SketchStore.test.ts \
  src/app/[lang]/shape-generator/featureTree/__tests__/FeatureTreeStore.test.ts \
  src/app/[lang]/shape-generator/referenceGeometry/__tests__/RefGeomStore.test.ts
```

Expected: all green. These are the per-PR acceptance tests for Z2/Z3/Z4
and are the canonical adapter contracts.

### 6.6 TypeScript clean

```sh
npx tsc --noEmit
```

Expected: exit 0, zero output.

---

## 7. Manual W4 verification checklist (user-owned, ~2h)

The automated signals above are necessary but not sufficient. The user-
owned manual pass covers what node-side tests cannot reach:

- [ ] **Two-tab local Sketch CRDT.** Open `/shape-generator?crdt=v2` in
  two tabs of the same browser. Draw a line in tab A. Tab B shows it
  within 200ms (BroadcastChannel-bound; sub-200ms expected on a single
  device).
- [ ] **Two-tab local Feature Tree CRDT.** Add a fillet in tab A. Tab B
  shows it. Reorder in tab A. Tab B reflects the new order. (See §5
  divergence #1 — the visible behaviour may differ; document what you
  observe.)
- [ ] **Two-tab local Ref-Geom CRDT.** Add a plane in tab A. Tab B shows
  it. Add a child plane referencing tab A's plane. The cycle banner
  appears in NEITHER tab (no cycle).
- [ ] **Yjs reload survives.** Draw a line in tab A. Close tab A. Re-
  open. The line is still there (y-indexeddb-bound).
- [ ] **E1 push-pull live drag.** With `?direct-edit=v1`, push-pull a
  face on a 50mm box. The drag is responsive (subjective: feels like
  60+fps under finger).
- [ ] **occt-collab-worker reachable.** `curl -I https://collab.nexyfab.com/health`
  or equivalent. Should respond 200. If 404, descope per master tracker §7.W4.1.

---

## 8. The W4 memo structure (user output)

The W4 memo lives at `docs/wave-2-phase-3-w4-gate.md` (per master tracker
§7) and follows this template:

```markdown
# Wave 2 Phase 3 — W4 Gate Decision

**Date:** YYYY-MM-DD
**Decision:** Green | Yellow | Red

## Status
- Z1: [✓ / partial / ✗]
- Z2: [✓ / partial / ✗]
- Z3: [✓ / partial / ✗]
- Z4: [✓ / partial / ✗]
- E1: [✓ / partial / ✗]
- E2: [✓ / partial / ✗]
- occt-collab-worker: [✓ deployed / ✗ R-1 triggered]

## Automated signals (this runbook §6)
- Compat suite: 37/37 + 1 todo [✓ / ✗]
- Perf bench:   13/13 [✓ / ✗], p95 actuals attached
- Soak harness: 18/18 [✓ / ✗]
- Phase 2 regression: ... [✓ / ✗]
- TypeScript: ... [✓ / ✗]

## Manual signals (this runbook §7)
- Two-tab sketch CRDT: [observed behaviour]
- Two-tab feature tree CRDT: [observed behaviour, noting §5 divergences]
- Two-tab ref-geom CRDT: [observed behaviour]
- Yjs reload: [observed]
- E1 push-pull: [subjective + recorded video link if any]

## New divergences (NOT in §5 baseline)
- [if any — describe, severity, follow-up]

## Decision rationale
- [2-3 paragraphs tying status + signals to the §4 Green/Yellow/Red decision]

## Follow-ups (filed during this gate)
- [ ] [ticket / PR descriptor]
- [ ] ...
```

---

## 9. Standup template for W5-W8 stretch

Carrying forward from W4, the W5-W8 daily standup (Track Z heavy weeks
per master tracker §7) follows this template. Keep it short — the
master-tracker §10 "How to run the project" pattern applies.

```markdown
**[YYYY-MM-DD] Phase 3 W{n} standup**

- ✓ Yesterday: [PR / commit / code-review]
- ⤳ Today:    [PR target / experiment / blocker]
- ⚠ Blocker:  [if any]
- 📊 Compat:  [last green run timestamp; if regressed, link to TODO]
- 📊 Perf:    [last green p95 from §6.2; if regressed, # delta]
- 📊 Soak:    [last green 18/18 timestamp; if flaky, seed + freq]
- 📊 Sentry:  [collab/* failure_rate; should stay < 5% per ADR-012 §9]
- 📊 i18n:    [drift count; should stay < 30 per R-7]
```

Reminder per master tracker R-8: "Solo dev burn-out (12 weeks of P0/P1
work in a row)". If the standup shows three consecutive "stuck /
avoiding" entries, slip a Track P week onto the W10 → W12 buffer.

---

## 10. What we explicitly did NOT do in this Q-precursor

To make the W4 gate possible, this PR added:
- compat suite (37 cases, 1 documented divergence)
- perf bench (13 cases, all green)
- soak harness (18 runs, all converge)
- this runbook
- companion evidence doc

This PR did **NOT**:
- broker the W4 gate decision — that's user-owned (master tracker §9)
- flip `?crdt=v2` default — stays OFF per ADR-012 §9
- fix the 3 documented compat divergences — follow-up tickets
- modify any Z2/Z3/Z4/E1 surface — read-only consumer
- modify Phase 1 collab primitives (sketchYjs / featureTreeYjs / refGeomYjs)
- add UI surface beyond the runnable tests

---

## 11. References

- ADR-012 §8 (perf budgets), §9 (default-OFF reversal path)
- ADR-011 §Reversal B (CRDT reversal path)
- ADR-010 §Phase structure (Phase 3 vs Phase 4 boundary)
- `docs/wave-2-phase-3-master-task-tracker.md` §7 (W4 / W8 / W11 / W12 gates)
- `docs/wave-2-soak-runbook.md` (burn-in procedure that Q1 extends)
- `docs/wave-2-phase-3-compat-evidence.md` (this PR's companion doc —
  the automated-test signals laid out by test file)
- `docs/wave-1-compat-matrix.md` (Q1 STEP matrix re-run target)

*End of W4 gate runbook. Updated 2026-05-28 (W3 closure + Q-precursor
PR). Re-review at W4 gate; archive after Phase 3 exit per master tracker
§7.*
