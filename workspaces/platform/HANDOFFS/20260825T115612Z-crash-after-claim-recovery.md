# Crash-after-claim recovery handoff

Generated: `2026-08-25T11:56:12Z`

Status: `ACTUAL_SEPARATE_CLAIM / WORKER_DISAPPEARANCE_QUARANTINED /
LEASE_AUTHORITY_CLEARED / STALE_CAPABILITY_REJECTED /
LOCAL_DURABLE_29_OF_29_PASS / PRIVATE_BETA_FALSE / GA_FALSE`

## Implementation

Precision CAD commit `94ad99b6eae22ab5b69f91992785aab8caa97e88` changes
expired-claim recovery so the outbox transition to `VERIFIED_UNKNOWN` clears
`lease_owner`, `lease_expires_at`, and `capability_hash` in the same PostgreSQL
transaction as the execution-journal quarantine and recovery event.

Platform commit `ad437dbf341b6c9d7643bf4d2e742ba077d0acbf` replaces the
previous completed-job state rewind with a separate approved crash execution:

1. seed a distinct project/workspace/generation authority;
2. stage its immutable input and transactionally enqueue its journal, tool
   claim, approval consumption, input binding, and outbox row;
3. claim it with a registered worker but intentionally create no callback,
   output intent, worker artifact, persistence receipt, or workspace commit;
4. advance the logical clock one millisecond beyond the 30-second lease and run
   recovery twice; and
5. require one quarantine followed by an idempotent zero-change recovery.

The verifier additionally requires:

- outbox and journal lifecycle `VERIFIED_UNKNOWN` with the exact
  `lease_expired_authoritative_receipt_required` reason;
- a valid journal receipt hash chain and matching terminal recovery event;
- cleared outbox and journal lease material;
- the expired capability to receive HTTP 403 `LEASE_CAPABILITY_INVALID`;
- no re-claim by another registered worker;
- zero output-intent, callback, worker-artifact, persistence-receipt, and
  workspace-commit rows; and
- an unchanged authoritative workspace revision and content hash.

## Evidence

- Receipt:
  `docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`
- Schema: `nexyfab.commercial-precision-local-durability.v3`
- Source HEAD: `ad437dbf341b6c9d7643bf4d2e742ba077d0acbf`
- Generated: `2026-08-25T11:55:43.740Z`
- Result: 29/29 `PASS`
- Receipt SHA-256:
  `8c27da0ab28c80c0e226feb84fbea5549c3fd27180e55c0a3069a4e1529a4c38`
- `crashAfterClaimRecovery=PASS`
- `actualCrashAfterClaimRecoveryExercised=true`
- The same run also passes actual PostgreSQL, Redis AOF, and object-storage
  restart persistence plus exact replay after restart.

Verification completed before handoff:

- outbox and journal focused contracts: 23/23 PASS;
- strict focused ESLint: PASS with zero warnings;
- Precision CAD ownership, TypeScript, and architecture: PASS;
- Platform ownership, full source ESLint, and TypeScript: PASS;
- unique disposable containers, network, and volumes: removed.

## Claim boundary

This is a local deterministic fixture using digest-pinned disposable services
and ephemeral credentials. It materially strengthens the fail-closed source and
infrastructure recovery contract, but it is not evidence that a deployed native
CAD worker actually crashed and recovered in staging or production.

The v3 receipt explicitly keeps
`fixtureIsCommercialRuntimeEvidence=false`, `privateBetaEligible=false`,
`commercialGaEligible=false`, and
`independentCadOrManufacturingCertified=false`. No staging or production
service was deployed, restarted, reconfigured, or written.

## Remaining release evidence

1. Repeat claim, native execution, process kill, lease expiry, quarantine, and
   operator reconciliation on the exact reviewed-adapter staging deployment.
2. Capture release-bound recovery, restore, rollback, alert, and credential-
   rotation receipts from that deployment.
3. Complete independent CAD review, expert signatures, and CNC/sheet/additive
   manufacturing pilots through the existing signed evidence pipeline.
4. Re-evaluate Private Beta only after all required sources validate together;
   retain GA HOLD until production-bound operations and security evidence pass.
