# Precision CAD handoff: commercial-worker-v3-immutable-io

- Created: 2026-08-24T20:29:26.689Z
- Branch: `scope/precision-cad`
- Head: `8673bd450a194cc77d36aea419730f44c01fc8e5`
- Integration target: `integration/nexyfab`

## Summary

Closed the source-level commercial worker I/O gap without asserting external
runtime readiness. Commercial Precision execution now has a versioned v3
contract, an immutable canonical input artifact bound transactionally to the
job, lease-authorized input/output transport, exactly three fixed-role output
commits, and a deployable native-process worker that signs its callback receipt
with Ed25519.

The claim path verifies both PostgreSQL metadata and authoritative object-store
SHA-256 before releasing transport. The callback path refuses `PASS` until the
signed `model`, `report`, and `verification` identities all match committed
output rows. Invalid input readback, generation binding, transport endpoints,
lease credentials, output bytes, and incomplete output commits remain explicit
`HOLD`/reject outcomes.

## Changed paths

- `scripts/drawing-to-3d/commercial-precision-worker.mjs`
- `scripts/drawing-to-3d/commercial-precision-worker.test.ts`
- `src/app/api/internal/precision-cad-commercial/artifacts/route.test.ts`
- `src/app/api/internal/precision-cad-commercial/artifacts/route.ts`
- `src/app/api/internal/precision-cad-commercial/callback/route.test.ts`
- `src/app/api/internal/precision-cad-commercial/callback/route.ts`
- `src/app/api/internal/precision-cad-commercial/claim/route.test.ts`
- `src/app/api/internal/precision-cad-commercial/claim/route.ts`
- `src/app/api/nexyfab/projects/[id]/precision-cad-agent/call/route.commercial-boundary.test.ts`
- `src/app/api/nexyfab/projects/[id]/precision-cad-agent/call/route.ts`
- `src/lib/precision-cad-agent/commercialExecutionOutboxStore.postgres.test.ts`
- `src/lib/precision-cad-agent/commercialExecutionOutboxStore.test.ts`
- `src/lib/precision-cad-agent/commercialExecutionOutboxStore.testFixture.ts`
- `src/lib/precision-cad-agent/commercialExecutionOutboxStore.ts`
- `src/lib/precision-cad-agent/commercialWorkerIo.test.ts`
- `src/lib/precision-cad-agent/commercialWorkerIo.ts`

## Verification

- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] Precision/commercial focused regression: `34` files and `216` tests PASS
- [x] Worker client native-process fixture: claim transport consumption,
  canonical input readback, exactly three immutable output uploads, callback
  HMAC, and independent Ed25519 signature verification PASS

## Remaining work and risks

- This is source and local-test closure, not a commercial release receipt.
- Deploy a real production-class native CAD executable and this worker client
  as an isolated service with separately managed claim, transport, callback,
  and Ed25519 credentials. No real key material is present in source.
- Run a fresh registered self-test job through staging. Readiness must stay
  `NOT_READY` until input readback, native execution, all three artifact commits,
  signed callback, and receipt hash are evidenced by that real job.
- Complete independent STEP/native-CAD interoperability, topology and XCAF
  persistence, GD&T/drawing review, crash/recovery and multi-instance campaigns,
  expert approval, and manufacturing pilots before release authority can move
  from `HOLD`.
- Production deployment and production data changes are not authorized by this
  handoff.
