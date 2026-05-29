# Wave 2 — Phase 3 Exit Memo

**Status:** **Yellow** (code-complete, hands-on validation deferred)
**Date:** 2026-05-29
**Branch:** `wave-2/phase-3-w7-z7-activity-stack` + Z8 stack
**Author:** Wave 2 Phase 3 close
**Risk tier:** P0 (CRDT integration + direct edit close-out per ADR-010/-012)

Per `docs/wave-2-phase-3-master-task-tracker.md` §7 W12 — go / no-go for
Phase 4 entry.

---

## 1. TL;DR

- **Code path: Green.** All 13 of Z1-Z8 + E1-E5 deliverables shipped.
  occt-collab-worker live on Cloudflare (prod + staging). Z8 permissions
  with 404-not-403 anti-enumeration and 6-lang UI shipped this PR.
- **Automated regression: Green.** 94 pass / 1 todo across phase-3
  compat / perf / soak + phase-2 regression + STEP roundtrip. Perf
  budgets all within band (direct-edit p95 = 2700× under, RefGeom
  migrate = 6.6× under).
- **Hands-on validation: Deferred.** The four ADR-012 §9
  graduation-criteria items that require a human + multiple browser
  windows (3-peer × 3h soak, 20×5 STEP matrix, F-DE-01..05 UX click-
  through, awareness latency Playwright) have NOT been run. This is the
  load-bearing reason the decision lands at Yellow, not Green.
- **Phase 4 entry: cleared for code work, NOT for flag graduation.**
  The flag-graduation PR (`?crdt=v2` + `?direct-edit=v1` default-ON) is
  explicitly held until the four hands-on items close. Phase 4
  (AI / CAM / FEA) can start in parallel against the same trunk.

---

## 2. Deliverables — what shipped

### Track Z (CRDT sync, 8 deliverables, all green)

| ID | What | Evidence |
|---|---|---|
| Z1 | Yjs Provider in host + BC + IDB + WS-ready | `collab/CollabProvider.tsx` (commit 599bf810) |
| Z2 | Sketch CRDT via SketchStore adapter | commit fafef4dc |
| Z3 | Feature tree CRDT via FeatureTreeStore | commit 862b7ca8 |
| Z4 | Ref-geom CRDT via RefGeomStore (D3b) | commit 262871e3 |
| Z5 | Awareness UI — peer cursors + presence | commit 20fb4e98 |
| Z6 | Branches foundation — fork + switch + list | commit 439e5ccf |
| Z7 | Activity feed — chronological op log | commit e829db41 |
| Z8 | Permissions UI + DELETE route + 6-lang | this PR (3486fa5f / a0cc22f2 / 1270ca91) |

### Track E (direct edit, 5 deliverables, all green)

| ID | What | Evidence |
|---|---|---|
| E1 | Foundation — push-pull + session stack | commit 73a0fcbd |
| E2 | Dynamic fillet + chamfer (push-drag edge variant) | commit b112f6b1 |
| E3 | Move + rotate body (drag-translate + drag-rotate) | commit 1d19b4bd |
| E4 | (subtract body — folded into earlier patches) | shipped pre-W6 |
| E5 | Commit-to-history merge (opt-in flush) | commit 05091df8 |

### Track Q (quality / gate)

| ID | What | Evidence |
|---|---|---|
| Q-W4 | W4 mid-gate runbook + compat evidence | `docs/wave-2-phase-3-w4-gate-runbook.md`, `compat-evidence.md` |
| Q-W8 | W8 mid-gate (folded — no scope cut needed) | this memo §3 |
| Q1 (W11) | Automated burn-in evidence | `docs/wave-2-phase-3-w11-burnin.md` |
| Q2 (W12) | Exit memo | this file |

### Track P (polish / i18n / perf / Sentry)

| Item | State |
|---|---|
| KR canonical → 5-lang (EN/JA/ZH/ES/AR) for Z+E new strings | ✅ landed per-feature (branches, threads, perms) |
| Perf-budget regression | ✅ phase3PerfBench all within band |
| Sentry breadcrumbs on collab module | ✅ pre-Z1 audit clean |
| Onboarding tour | ⚠️ collab + direct-edit chapters drafted, full pass deferred to Phase 4 |

---

## 3. Decision Tree per Master Tracker §7 W12

**All Z deliverables shipping-quality?**

- Automated suites: ✅
- 3-user × 3h soak with all subtrees: ❌ not run (deferred)
- Branching 5-per-doc fork-on-write: ✅ unit tested, ❌ hands-on
- Permissions 404-not-403 + 3-role matrix: ✅ unit tested, ❌ hands-on UX

→ **Yellow** on Z.

**All E deliverables shipping-quality?**

- F-DE-01..05: ✅ unit math/data tests pass, ❌ click-through
- Direct-edit live drag p95 ≤ 30ms: ✅ (perf bench reports 0.011 ms)
- Commit-to-history round-trip clean on 10 test files: ✅ on 5 fixtures,
  the other 5 deferred to hands-on

→ **Yellow** on E.

**Phase 2 features regression-clean in CRDT mode?**

- `phase2RegressionSuite.test.ts` with `?crdt=v2` semantics: ✅ 24/24

→ **Green** on Phase 2 regression.

**6-lang i18n complete for all new strings?**

- KR canonical: ✅
- EN sync: ✅
- JA / ZH / ES / AR: ✅ (per-feature dict, no machine-translated banners)

→ **Green** on i18n.

**Sentry < 5% failure rate on each collab + direct-edit channel?**

- No production traffic on `?crdt=v2` yet (flags default-OFF). Channel
  baselines will populate after flag graduation. Until then, this gate
  is N/A.

→ **N/A** (gate auto-passes pre-graduation).

**Roll-up: Yellow.** Code-complete, automation-green, hands-on-deferred.

---

## 4. Risk Register Review (per master tracker §8)

| Risk | Status at exit | Notes |
|---|---|---|
| R-1 occt-collab-worker not deployed | ✅ Resolved | Live on prod + staging |
| R-2 Sketch CRDT typing latency | ✅ Resolved | Perf bench within budget |
| R-3 Y.Doc clone expensive for branching | ⚠️ Not measured at large scale | Fork-on-write tested on small fixtures; large-doc branching deferred to Phase 4 |
| R-4 E1 OCCT push-pull face-id fragile | ⚠️ Not stress-tested | Math + session stack clean; native B-Rep face-pick not yet stress-tested against the 20-fixture matrix |
| R-5 E5 commit-to-history corrupts tree | ⚠️ Not stress-tested | Round-trip clean on 5 fixtures, the remaining 10 from the spec deferred |
| R-6 Z8 server-side enforcement missing | ✅ Resolved | `cloudDoc/access.ts` resolver + DELETE route + 404-not-403 all in place |
| R-7 i18n drift | ✅ Resolved | All new strings 6-lang at commit time |
| R-8 Solo dev burn-out | ✅ Within band | 12-week plan tracked, no burn-out flag |
| R-9 Agent throughput below estimate | ✅ N/A | Phase 3 ran ahead of schedule |
| R-10 CRDT overhead perf regression | ✅ Resolved | Perf bench shows 2700× headroom on direct-edit |

Three Yellow risks (R-3 / R-4 / R-5) are the load-bearing reason the
exit lands at Yellow.

---

## 5. Phase 4 Entry — what unblocks now

Per ADR-010, Phase 4 = AI / CAM / FEA work. The exit-gate Yellow does
NOT block Phase 4 code work — only flag graduation. Phase 4 can start
on these surfaces in parallel against the same trunk:

- AI: prompt-registry expansion, shape-chat agent improvements, scad
  intent v2.
- CAM: g-code emit refinements, post-processor coverage, toolpath
  preview shell.
- FEA: NL-stress agent, modal analysis stability, toplogy opt UX.

Phase 4 work should NOT introduce hard dependencies on `?crdt=v2`
default-ON. CRDT consumers remain opt-in via the same flag until the
graduation PR lands.

---

## 6. Flag Graduation — Held

Per master tracker §7 W12: *"Flags `?crdt=v2` and `?direct-edit=v1`
graduate to default-on in a follow-up PR (separate from this Phase 3
close PR)."*

The follow-up PR is **not** drafted in this Phase 3 close. Drafting it
requires the hands-on validation outcomes (§7 below). The PR will be a
small surface — toggle the default in:

- `useFeatureStackBridge` flag reader
- `useSketchYjs` / `SketchStore` flag reader
- `useFeatureTreeStore` flag reader
- `useRefGeomStore` flag reader
- `useBranchStore` flag reader
- `useActivityFeed` flag reader
- `DirectEditController` flag reader

…plus `phase3CompatSuite.test.ts` updated to assert default-on behavior
is the new baseline.

Estimated cost: ~30 LoC + test updates, one PR. Held until hands-on items
close.

---

## 7. Hands-on Validation Sprint (Phase 3.5 buffer)

The four items below close the Yellow → Green gap. Estimated 16-24 hours
of focused work + 3-hour wall-clock soak.

1. **3-peer × 3-hour soak** with live worker URL
   `wss://occt-collab-worker.gomd999.workers.dev`. Three browser windows,
   each running a different shape-generator session, all opted into
   `?crdt=v2`. Capture: edit-lost incidents (target 0), sync RTT p95
   (target ≤ 200 ms), Y.Doc snapshot size growth (target ≤ 5 MB).

2. **20 × 5 STEP roundtrip matrix re-run** per
   `docs/wave-1-compat-matrix.md`. Each row is a different STEP file
   imported → modeled → re-exported → re-imported. Target: 100/100 cells
   green, or document specific cell failures.

3. **F-DE-01..05 fixture click-through** in a browser with
   `?direct-edit=v1`. Each fixture exercises one E-track op (push-pull /
   fillet / move / rotate / commit). Target: clean UX with no edit
   corruption.

4. **Awareness latency Playwright spec** — single E2E spec that opens
   two browser contexts on the same `?crdt=v2` doc, measures
   peer-cursor sync time. Target: p95 ≤ 200 ms.
   **Spec shipped**: `e2e/collab-awareness-latency.spec.ts` (2026-05-29).
   **Runbook**: `docs/wave-2-phase-3-awareness-latency-runbook.md`
   — manual run procedure with build flags + failure triage.

When all four are clean, draft the flag graduation PR (§6) and ship as
the formal Phase 3 close.

---

## 8. Out-of-scope artifacts pushed to Phase 4+

Per master tracker §12, the items below are explicitly NOT in Phase 3:

- 3D viewport camera-position broadcast (P5)
- Auto-merge UI for branches (Phase 4)
- Sketch CRDT awareness — peer selection within profile (Phase 4)
- Per-feature CRDT opt-in granularity (Phase 4 if R-2 had triggered;
  did not)
- Native B-Rep face-pick for direct edit (Phase 4 if R-4 triggers;
  pending hands-on stress test)
- Custom domain `collab.nexyfab.com` route binding (dashboard work,
  unblocks zero Phase 4 code work)
- Workspace member management UI (`/api/workspaces/[id]/members`)
  — Z8 ships per-doc UI only; workspace-tier is Phase 4

---

## 9. Cross-references

- ADR-010 (Wave 2 = B-Full + collab) — master memory
- ADR-011 (`docs/adr/011-crdt-architecture-and-phase-2-scope.md`)
- ADR-012 (`docs/adr/012-wave-2-phase-3-crdt-integration-and-direct-edit.md`)
- Master tracker (`docs/wave-2-phase-3-master-task-tracker.md`)
- W4 compat evidence (`docs/wave-2-phase-3-compat-evidence.md`)
- W11 burn-in evidence (`docs/wave-2-phase-3-w11-burnin.md`)
- Soak runbook (`docs/wave-2-soak-runbook.md`)
- Phase 2 close (`docs/wave-2-phase-2-master-task-tracker.md`)
- occt-collab-worker (`occt-collab-worker/README.md`)
