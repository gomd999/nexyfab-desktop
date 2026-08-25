# Platform handoff: release baseline and security evidence convergence

- Created: 2026-08-25T04:43:42.505Z
- Branch: `scope/platform`
- Head: `5b4dcf8f88c58aa2eb23fa6d0476857a4155fefc`
- Integration target: `integration/nexyfab`

## Summary

Repaired current release-baseline generation for the exact Railway evidence
allowlist and removed the secret-scan/security-receipt hash cycle. All local
security sources are current and pass, while the production-target security
receipt remains HOLD only because no production release identity was supplied.

## Changed paths

- `docs/operations/commercial-security-evidence-convergence-20260825.md`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260825T044342Z-release-baseline-security-evidence-convergence.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `node --test scripts/build-release-baseline.test.mjs scripts/deployment-structure.test.mjs`
- [x] `node --test scripts/scan-secrets.test.mjs scripts/build-commercial-security-evidence-receipt-v2.test.mjs scripts/build-route-security-matrix.test.mjs scripts/build-dependency-audit-evidence.test.mjs scripts/commercialization-readiness-gate.test.mjs`
- [x] `npm run security:matrix:check`
- [x] `npm run api:controls:check`
- [x] `npm run security:dependencies:check`
- [x] `npm run security:secrets:check`

## Remaining work and risks

- The production-bound security receipt cannot pass without an exact approved
  production build, deployment, and Git identity. Staging identity must not be
  substituted.
- Production smoke, authenticated E2E, restore/rollback, distributed quota,
  real native-worker runtime, independent CAD review, and manufacturing pilot
  evidence remain separate release blockers.

