# Precision CAD handoff: approved native adapter identity

- Created: 2026-08-25T03:25:21.000Z
- Branch: `scope/precision-cad`
- Head: `7e01ba140bda3daa9f48aa79af76eb59e3dce8a9`
- Integration target: `integration/nexyfab`

## Summary

Closed the source-level gap that allowed a correctly signed worker receipt to
omit the identity of the native CAD executable and its configured invocation.
The worker, server trust registry, receipt verifier, OCI build plan, health
contract, and hostile tests now fail closed on executable or argument drift.

## Changed paths

- `containers/occt-commercial-worker/Dockerfile`
- `containers/occt-commercial-worker/README.md`
- `containers/occt-commercial-worker/railway.toml`
- `scripts/drawing-to-3d/build-commercial-precision-worker-image.mjs`
- `scripts/drawing-to-3d/build-commercial-precision-worker-image.test.mjs`
- `scripts/drawing-to-3d/commercial-precision-worker.mjs`
- `scripts/drawing-to-3d/commercial-precision-worker.test.ts`
- `src/lib/precision-cad-agent/commercialWorkerArtifactSnapshot.test.ts`
- `src/lib/precision-cad-agent/commercialWorkerPersistenceCoordinator.testFixture.ts`
- `src/lib/precision-cad-agent/commercialWorkerReceipt.test.ts`
- `src/lib/precision-cad-agent/commercialWorkerReceipt.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260825T032521Z-approved-native-adapter-identity.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npx vitest run scripts/drawing-to-3d/commercial-precision-worker.test.ts src/lib/precision-cad-agent/commercialWorkerReceipt.test.ts src/lib/precision-cad-agent/commercialWorkerArtifactSnapshot.test.ts src/lib/precision-cad-agent/commercialWorkerPersistenceCoordinator.test.ts src/lib/precision-cad-agent/commercialWorkerPersistenceCoordinator.postgres.test.ts --reporter=dot`
- [x] `node --test scripts/drawing-to-3d/build-commercial-precision-worker-image.test.mjs`
- [x] `npm run workspace:check -- precision-cad`

## Remaining work and risks

- Platform-owned runtime evidence, release health, readiness, and local durable
  campaign fixtures must consume and enforce both new adapter bindings.
- The transitional TypeScript fields remain optional only until those
  cross-scope fixtures are migrated; runtime parsing already requires them.
- A reviewed production-class adapter image, separately held worker key, real
  staging canary, recovery campaign, independent review, and manufacturing
  pilot remain external release blockers.
