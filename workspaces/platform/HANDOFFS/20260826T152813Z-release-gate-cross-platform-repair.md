# Backend + Frontend Platform handoff: release-gate-cross-platform-repair

- Created: `2026-08-26T15:28:13Z`
- Branch: `scope/platform`
- Head: `ba741d9067192b142f9e5a97fa28bda737345a15`
- Integration target: `integration/nexyfab`

## Summary

Repaired two stale cross-platform release-gate contracts. The verified Railway
deploy launcher now resolves a Windows npm CLI path with Windows path semantics
even when its contract is tested on Linux, and release-health evidence tests
now match the hardened symlink-specific rejection from the implementation.

No release claim was broadened. Runtime placement remains `HOLD` where live
evidence is absent, while local and staging slice readiness remains
`PASS_WITH_HOLDS` and rollback remains `READY_NOT_EXECUTED`.

## Changed paths

- `scripts/deploy-railway-verified.mjs`
- `scripts/package-release-health-evidence.test.mjs`
- `docs/evidence/security/secret-scan-260810.json`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260826T152813Z-release-gate-cross-platform-repair.md`

## Verification

- [x] Focused Node policy regression: 15/15 tests PASS.
- [x] `npm run test:platform`: Node service/policy 72/72 PASS; Platform Vitest
  19 files / 75 tests PASS; architecture PASS.
- [x] `npm run lint:ci` — full source PASS (208.7s).
- [x] `npm run typecheck` — project TypeScript PASS (23.4s).
- [x] `npm run workspace:check -- platform`: ownership and classification
  clean with zero violations.
- [x] Current secret scan: 10,316 candidates / 325,455,377 bytes / zero
  findings.

## Remaining work and risks

- The shared GitHub Actions restore drill still needs to identify its locally
  generated backup honestly as `local-fixture`; that workflow change belongs
  on `integration/nexyfab`, not this scope branch.
- Production and staging release claims still require fresh live deployment
  evidence at the final integrated head.
