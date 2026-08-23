# AI Design handoff: isolated-domain-accuracy-contract

- Created: 2026-08-23T14:45:13.607Z
- Branch: `scope/ai-design`
- Head: `851a7ac8ab7769f043f23a9b420e3cd0f1381d00`
- Integration target: `integration/nexyfab`

## Summary

Added a folder-local Docker build context for deterministic domain-accuracy
assessment. The service evaluates submitted evidence, exposes live, ready, and
release health contracts, and cannot invoke a live model.

## Changed paths

- `capabilities/ai-design/domain-accuracy/.dockerignore`
- `capabilities/ai-design/domain-accuracy/Dockerfile`
- `capabilities/ai-design/domain-accuracy/README.md`
- `capabilities/ai-design/domain-accuracy/index.ts`
- `capabilities/ai-design/domain-accuracy/package.json`
- `capabilities/ai-design/domain-accuracy/service.json`
- `capabilities/ai-design/domain-accuracy/src/contract.d.mts`
- `capabilities/ai-design/domain-accuracy/src/contract.mjs`
- `capabilities/ai-design/domain-accuracy/src/health.mjs`
- `capabilities/ai-design/domain-accuracy/src/server.mjs`
- `capabilities/ai-design/domain-accuracy/test/server.test.mjs`
- `src/lib/ai/domainAccuracySliceParity.test.ts`
- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/HANDOFFS/20260823T144513Z-isolated-domain-accuracy-contract.md`

## Verification

- [x] isolated server tests (2 passed)
- [x] legacy parity tests (2 passed)
- [x] `npm run workspace:check -- ai-design`
- [x] `npm run typecheck`
- [x] `npm run test:accuracy:common` (11 files/60 tests plus 7 candidate checks passed)

## Remaining work and risks

- Analysis URL and API revision bindings are required for readiness.
- Live model execution remains disabled and causes readiness to fail if enabled.
- External accuracy evidence and rollback rehearsal are still required for release.
