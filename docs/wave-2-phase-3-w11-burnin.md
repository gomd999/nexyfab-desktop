# Wave 2 — Phase 3 W11 (Q1) Burn-in Evidence

**Date:** 2026-05-29
**Branch:** `wave-2/phase-3-w7-z7-activity-stack`
**Status:** automated portion ✅ green / 3-user × 3h soak deferred to follow-up

Per `docs/wave-2-phase-3-master-task-tracker.md` §7 W11, this memo
captures Q1 burn-in evidence for the W12 exit gate.

---

## 1. Automated regression — green

| Suite | File | Cases | Result |
|---|---|---|---|
| Phase 3 compat (legacy ≡ v2) | `__tests__/phase3CompatSuite.test.ts` | 38 | ✅ all green |
| Phase 3 perf (ADR-012 §8 budgets) | `__tests__/phase3PerfBench.test.ts` | 13 | ✅ all green |
| Phase 3 soak (3 peers × 100 ops × 6 seeds) | `__tests__/phase3SoakHarness.test.ts` | 18 | ✅ all green (1 todo, documented) |
| Phase 2 regression (5 specs end-to-end) | `io/__tests__/phase2RegressionSuite.test.ts` | 24 | ✅ all green |
| STEP roundtrip (M1, AP214 B-rep) | `test/m1/stepRoundtrip.guarded.test.ts` | 2 | ✅ all green |
| **Total automated** | | **95** | **94 pass / 1 todo** |

Aggregate runtime: ~7s for the Phase 3 trio, ~1s for phase2regression,
~2.6s for STEP. Acceptable for PR-gate inclusion.

### Perf-budget headroom

From the `phase3PerfBench` output:

| Metric | Budget | Observed (p95) | Headroom |
|---|---|---|---|
| Sketch entity add | 16 ms | well under (set bench) | OK |
| Feature tree reorder | 50 ms | well under | OK |
| Direct-edit push-pull (E1 stack proxy) | 30 ms | 0.011 ms | 2700× |
| RefGeom migrate (50 nodes) | 100 ms | ~15 ms | 6.6× |

The CRDT overhead is well within ADR-012 §8 bands — no per-feature
opt-in pressure (R-10 risk path stays inactive).

### Soak convergence

3-peer × 100-op × 6-seed harness ran across Sketch / FeatureTree /
RefGeom stores. Zero divergence across all 18 combinations. The
A5 W6 CRDT bug pattern (2-level Y.Map LWW loss) did not resurface.

---

## 2. Live worker — health probe

occt-collab-worker deployed (task #31 closure):

| Env | URL | /healthz |
|---|---|---|
| Production | `https://occt-collab-worker.gomd999.workers.dev` | 200 ok |
| Staging | `https://occt-collab-worker-staging.gomd999.workers.dev` | 200 ok |

KV namespaces (`b1bc68a…` prod, `b2a7c500…` staging) + JWT_SECRET
(same HS256 secret as main app's `src/lib/jwt.ts`) configured per env.

Custom domain `collab.nexyfab.com` is still a dashboard-side follow-up;
clients can target the `*.workers.dev` URL via
`NEXT_PUBLIC_OCCT_COLLAB_WS_URL`.

---

## 3. Z8 permissions — green

Phase 3 W8 Track Z8 shipped on this branch:

- DELETE `/api/documents/[id]/permissions/[userId]` — 7-case unit test
  PASS (origin gate / 401 / 404-not-403 / 403 non-owner / owner-row
  protection / idempotent revoke / happy path + audit).
- `PermissionsPanel.tsx` 6-lang UI — 9-case jsdom test PASS.
- Existing GET/POST regression: 36/36 PASS.
- `DocPermissionsButton` wired into `ShapeGeneratorToolbar` next to
  ShareButton via 3 optional props (no host breakage).

---

## 4. What's NOT in this evidence (deferred to hands-on Q1 soak)

The master tracker §3 Track Q calls for:

- **3 users × full pipeline × 3-hour soak** — not run. Requires three
  human peers + a long-form wall-clock soak. Recommended: schedule
  during the W12 exit-gate window.
- **20 × 5 STEP round-trip matrix re-run** — only the smoke (2 cases)
  is in CI. The full 20×5 matrix lives in
  `docs/wave-1-compat-matrix.md` and is a manual hands-on session.
- **Direct-edit end-to-end click-through** — push-pull / fillet /
  move / rotate / subtract / commit-to-history needs UX verification
  against fixtures F-DE-01..05 (the *.test.ts files cover math/data
  but not the full pointer-event chain).
- **Awareness latency p95 ≤ 200ms** end-to-end with live worker — needs
  two real browsers + Playwright timing.

These items should land in the W12 exit memo
(`docs/wave-2-phase-3-exit.md`) as Yellow if not run, Green if run +
clean.

---

## 5. Exit-gate signal

Automated evidence is **Green**. The deferred hands-on items are the
load-bearing call for the W12 Green/Yellow/Red decision per §7 of the
master tracker.

Recommended Yellow → Green path:

1. Schedule a 3-hour 3-peer soak with the now-live worker URL.
2. Re-run `docs/wave-1-compat-matrix.md` 20×5 cell matrix.
3. Click-through F-DE-01..05 fixtures in a browser (≤ 30 min).
4. Capture awareness latency from a Playwright run (single E2E spec).

Without the four hands-on items, Phase 3 ships **Yellow**:
flag-graduation PR holds (`?crdt=v2` and `?direct-edit=v1` remain
default-OFF). The CRDT code stays in tree, runnable by opt-in users
who know to set the flag.

---

## 6. Cross-references

- `docs/wave-2-phase-3-master-task-tracker.md` §7 W11/W12 (gate criteria)
- `docs/wave-2-phase-3-compat-evidence.md` (W4 precursor — same suites)
- `docs/wave-2-phase-3-w4-gate-runbook.md` (W4 gate procedure)
- `occt-collab-worker/README.md` (worker architecture)
- `docs/adr/012-wave-2-phase-3-crdt-integration-and-direct-edit.md` (§8 perf budgets, §9 graduation criteria)
