# Precision CAD handoff: required native adapter trust fields

- Created: 2026-08-25T03:43:51.000Z
- Branch: `scope/precision-cad`
- Head: `58a93bc7f820842a8a2edf4a82c539581ebf2add`
- Integration target: `integration/nexyfab`

## Summary

Removed the temporary cross-scope migration allowance after Platform fixtures
and runtime evidence adopted native adapter identity. The trusted-worker type
now requires executable and invocation SHA-256 values exactly as the runtime
parser, shared receipt contract, readiness, and release gate already do.

## Changed paths

- `src/lib/precision-cad-agent/commercialWorkerReceipt.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260825T034351Z-required-native-adapter-trust-fields.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npx vitest run src/lib/precision-cad-agent/commercialWorkerReceipt.test.ts src/lib/precision-cad-agent/commercialWorkerArtifactSnapshot.test.ts src/lib/precision-cad-agent/commercialWorkerPersistenceCoordinator.postgres.test.ts --reporter=dot`
- [x] `npm run workspace:check -- precision-cad`

## Remaining work and risks

- A real reviewed adapter image and release-specific worker key are still
  absent, so the source trust boundary cannot itself authorize Private Beta.
- The integrated core still requires a fresh isolated staging deployment and
  exact release-bound HOLD receipt before a positive worker canary.
