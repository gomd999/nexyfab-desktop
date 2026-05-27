# 009 — Wave 1 GA gate criteria

**Status:** proposed
**Date:** 2026-05-27
**Author:** dev
**Risk tier:** P0

## Context

W1-W17 shipped the OCCT-on-server architecture across worker, main-app
wrappers, feature integration, and UI handlers (22 PRs, stacked). The
code paths exist end-to-end from React button down to replicad WASM
in Railway. What's still missing is the *evidence* that the system
holds up under real load and real CAD files — the difference between
"compiles" and "ship-able".

We need a written gate so the W17 → Wave-2 transition isn't a vibe
check. ADR-001's commitment was "after Wave 1, verify and decide
Wave 2 entry"; this ADR makes "verify" concrete.

## Decision

Wave 1 GA = all of the following pass:

1. **Infra live.** `nexyfab-occt-worker` deployed to Railway, /health
   reports `occt: ready` with `pool.size ≥ 2`, `pool.ready === size`
   on a cold start within 30s.
2. **4-hour soak passes.** `npm run soak -- --duration=14400`
   completes with: ratio(heap Q4/Q1) ≤ 2.0, total recycles ≥ 5
   (rotation policy is firing), zero unhandled crashes (worker_threads
   exit codes 0 only).
3. **External CAD compat ≥ 70%.** 20-fixture × 5-viewer STEP
   roundtrip matrix (Task #29) reports ≥ 70% open-correctly across
   Onshape, Fusion 360, SolidWorks, FreeCAD, OnShape Mobile. ≥ 50%
   is "minimum viable"; below that we don't claim CAD-grade.
4. **External engineer signoff.** ≥ 1 SW/Fusion power-user has run
   their own files through and reported no kernel crashes (Task #28).
5. **Sentry burn-in.** 7 calendar days of dogfood traffic with
   `server_*_unavailable` rate < 5% and `server_*_path_ok` rate > 90%.

Failure of any criterion → defer Wave 2 decision until fixed. Don't
ship with "5 of 6"; the gate is conjunctive on purpose.

## Consequences

### Positive

- Wave 2 entry decision becomes a yes/no on quantitative data, not
  on momentum or sunk cost.
- The 20-fixture matrix doubles as a regression suite for any Wave 2
  kernel change.
- Sentry alert thresholds set during this gate become the on-call
  baselines.

### Negative

- 4-hour soak + 7-day burn-in adds ~10 days of calendar time before
  any user-visible Wave 1 GA announcement.
- 70% compat threshold may be optimistic for replicad on the
  hairier SW assemblies; expect a sub-gate to land at 60% with a
  documented improvement plan if that happens.

### Neutral

- This ADR doesn't decide whether to license a paid kernel (Parasolid
  etc.) — that's a separate ADR if criterion #3 fails badly.

## Alternatives considered

- **Ship at "compiles + tests pass".** Rejected — Wave 1 is the
  product's first CAD claim; a kernel crash in a customer demo
  costs more than 10 days of soak.
- **Defer the matrix to post-GA.** Rejected — without it we have no
  signal on real-file behaviour and would be flying blind on the
  Wave 2 kernel-maturity decision (covered in ADR-009-followup).

## Rollout

Order matters — each step blocks the next.

- [ ] **Step 1 — Railway provision** (user, Task #31): Create
      nexyfab-occt-worker service, set env (JWT_SECRET, R2_*, PORT),
      `railway up` from `occt-worker/`. Verify /health.
- [ ] **Step 2 — PR stack merge** (user): #2 → #3 → #4 → #5 → #6 → ...
      → #22 in dependency order via `gh pr merge $N --squash --admin`.
      Validate main builds clean after each.
- [ ] **Step 3 — Main-app redeploy**: `cd nexyfab.com/new && railway up`.
      Set `NEXT_PUBLIC_OCCT_WORKER_URL` to the worker's URL.
- [ ] **Step 4 — Soak gate**: `cd occt-worker && npm run soak --
      --duration=14400 --ops-per-sec=1`. Capture summary JSON to
      `docs/wave-1-soak-N.json` (date-suffixed).
- [ ] **Step 5 — External validation kickoff** (user, Task #28/#29):
      Send the 20-fixture matrix + ≥ 1 SW/Fusion engineer outreach.
      Collect results in `docs/wave-1-compat-matrix.md`.
- [ ] **Step 6 — Burn-in window**: Open Wave 1 to internal dogfood.
      Sentry watches `server_*` event rates for 7 calendar days.
- [ ] **Decision review — 2026-09-24** (W17 end): Tally gates 1-5.
      Three outcomes:
        - All pass → Wave 2 entry approved, ADR-010 starts.
        - 1-2 fail → Wave 1.1 patch cycle (P1 fixes only).
        - 3+ fail → re-evaluate kernel strategy (paid license ADR).

## Reversal

Reversal cost: low. If the gate fails after partial deploy, roll
worker Railway service back to last green tag (`railway rollback`),
flip `NEXT_PUBLIC_OCCT_WORKER_URL` to empty so the main app's server
path skips back to local-only. ~30 min revert. The wave-1 PRs stay
in main since the local-only fallback is intact.

## References

- Code: `occt-worker/`, `src/lib/occt-server-client.ts`,
  `src/app/[lang]/shape-generator/features/{boolean,fillet,chamfer,shell}.ts`
- Docs: `docs/wave-1-ga-checklist.md` (operational runbook)
- ADRs: [ADR-001 marketplace freeze](./001-marketplace-freeze.md),
  [ADR-007 OCCT worker](./007-occt-worker-on-railway.md)
- PRs: #2 (Wave 1 W3+W6) … #22 (FCS UI wire)
