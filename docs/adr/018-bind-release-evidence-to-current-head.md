# 018 — Bind release evidence to the current Git HEAD

**Status:** accepted
**Date:** 2026-08-10
**Author:** Codex
**Risk tier:** P0 (see `docs/process/risk-policy.md`)

## Context

The commercialization readiness gate trusted the `committed` flag recorded in
the release baseline but did not prove that the baseline described the Git
revision currently under evaluation. During the WP21 release re-audit, the
baseline identified commit `07d83a8f1904827322beb5125c66d238b84bf793` while
the release branch was at `ae6c3194199f641db46f4ba51f0ffa44eaa4efa6`.
Consequently, deployment receipts for an older revision could make a newer
revision appear eligible for Private Beta.

## Decision

The commercialization readiness gate will read the current branch and full
commit SHA from Git metadata and compare both values with the release baseline.
An unavailable identity, branch mismatch, or full-SHA mismatch fails closed for
Private Beta and Commercial GA. Deployment, smoke, migration, backup, rollback,
and canary evidence is valid only when it is bound to that exact revision.

## Consequences

### Positive

- Readiness evidence cannot silently authorize code added after the recorded
  deployment.
- Detached, missing, or inconsistent Git identity becomes an explicit blocker.
- Regression tests preserve the fail-closed behavior.

### Negative

- Every candidate commit requires a newly generated release baseline and new
  environment receipts before promotion.
- Source archives without resolvable Git metadata cannot pass the gate.

### Neutral

- Local development and validation remain available while promotion is blocked.
- The previously recorded Private Beta pass is corrected to a blocked result;
  Commercial GA remains blocked by additional external evidence requirements.

## Alternatives considered

- **Trust the baseline `committed` flag** — rejected because it proves only what
  the document claims, not what revision is currently being evaluated.
- **Compare abbreviated commit hashes** — rejected because full SHA comparison
  is unambiguous and already available in the baseline.
- **Use timestamps to infer freshness** — rejected because clocks and artifact
  generation order do not establish source identity.

## Rollout

- [x] Add current branch/full-SHA resolution and fail-closed blockers.
- [x] Add a regression test for a stale committed baseline.
- [x] Regenerate the current commercialization readiness result.
- [ ] Bind new staging, deployment, rollback, and canary receipts to the new
  candidate SHA before any release promotion.
- [ ] Decision review — after the next candidate promotion: confirm that all
  receipts resolve to the promoted full SHA.

## Reversal

Revert the implementation and this ADR. Until an equivalent revision-binding
control is restored, keep Private Beta and Commercial GA promotion disabled;
do not restore the former fail-open evaluation in production.

## References

- Code: `scripts/commercialization-readiness-gate.mjs`
- Tests: `scripts/commercialization-readiness-gate.test.mjs`
- Evidence: `docs/evidence/release/commercialization-readiness-current.json`
- Process: `docs/process/risk-policy.md`
- Audit record: `docs/ACTIVE_EXECUTION_MASTER.md`
