# Precision CAD handoff: commercial durable exact closed loop

- Created: `2026-08-25T00:55:00Z`
- Branch: `scope/precision-cad`
- Head: `eb04248d1f3b124cd27b4e39e8df4eee8ccd404f`
- Integration target: `integration/nexyfab`
- Status: `LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS / EXTERNAL_RELEASE_HOLD`

## Summary

Implementation commits `90c707a5`, `5c063e5a`, `fc828fd2`, and `f42aee1c`
close the local commercial v3 durability path from immutable input through
worker execution, signed callback, authoritative parser persistence, and
workspace HEAD CAS. The disposable PostgreSQL, Redis AOF, and S3-compatible
campaign passed all 24 checks. Commit `eb04248d` makes the expiry regression
test date-independent without weakening production expiry enforcement.

The evidence is a local engineering closure only. The native executable is a
deterministic fixture, so it cannot establish external CAD compatibility,
expert qualification, manufacturing suitability, or release readiness.

## Changed paths

- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/HANDOFFS/20260825T005500Z-commercial-durable-exact-closed-loop.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] Local durability campaign: 24/24 checks passed.
- [x] Full Vitest: 2,950 files and 30,188 tests passed.
- [x] Node test runner: 618 passed, 5 environment-gated skips, 0 failed.
- [x] Production build, 301 static pages, and bundle budgets passed.
- [x] Current candidate secret scan completed with zero findings.

## Remaining work and risks

- The exact candidate has not been observed with a reviewed production-class
  native CAD adapter in isolated staging.
- Independent STEP/native-CAD/XCAF/GD&T evidence, role-separated expert
  signatures, and three manufactured/inspected pilots remain absent.
- Restore, rollback, alerting, credential rotation on the real deployment, and
  seven-day operations evidence remain absent.
- Production deployment, manufacturing approval, and commercial mode remain
  disabled and `HOLD`.

