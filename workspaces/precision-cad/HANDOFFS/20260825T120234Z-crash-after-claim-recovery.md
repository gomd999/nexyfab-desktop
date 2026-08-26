# Precision CAD crash-after-claim recovery handoff

Generated: `2026-08-25T12:02:34Z`

Status: `EXPIRED_LEASE_AUTHORITY_CLEARED / VERIFIED_UNKNOWN_QUARANTINE_PASS /
LOCAL_DURABILITY_29_OF_29_PASS / REAL_NATIVE_RUNTIME_NOT_RUN /
PRIVATE_BETA_FALSE / GA_FALSE`

## Precision-owned change

Commit `94ad99b6eae22ab5b69f91992785aab8caa97e88` changes
`CommercialExecutionOutboxStore.recoverExpiredClaims` so an expired claimed
execution loses all remaining outbox lease authority in its recovery
transaction:

- `lease_owner = NULL`;
- `lease_expires_at = NULL`; and
- `capability_hash = NULL`.

That update remains in the same PostgreSQL transaction as the journal
`VERIFIED_UNKNOWN` transition, exact recovery event append, and outbox
quarantine. A concurrent recovery still wins through the existing CAS
conditions; a second recovery performs zero mutations.

The enqueue test fixture now accepts a bounded safe suffix so the shared
durability campaign can create a genuinely distinct approved project,
workspace, run, job, input object, idempotency key, and execution. The empty
suffix preserves every existing test value.

## Shared execution evidence

Platform commit `ad437dbf341b6c9d7643bf4d2e742ba077d0acbf` uses the
separate fixture to model a worker that disappears immediately after claim. It
does not rewrite a completed job to `CLAIMED`.

The checked-in receipt
`docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`
is schema `nexyfab.commercial-precision-local-durability.v3`, is bound to that
source commit, passes 29/29 checks, and has receipt SHA-256
`8c27da0ab28c80c0e226feb84fbea5549c3fd27180e55c0a3069a4e1529a4c38`.

The crash path proves:

- exact outbox and journal quarantine with a valid receipt/event hash chain;
- cleared outbox and journal lease state;
- stale capability rejection as HTTP 403 `LEASE_CAPABILITY_INVALID`;
- no callback, output intent, worker artifact, persistence receipt, workspace
  commit, or workspace-head mutation; and
- no re-claim after quarantine.

The same run proves actual disposable PostgreSQL, Redis AOF, and object-storage
restart persistence plus exact replay through a write-rejecting artifact store.

Verification: focused outbox/journal contracts 23/23 PASS; strict focused
ESLint PASS; Precision ownership, TypeScript, and architecture PASS; Platform
ownership, full source ESLint, and TypeScript PASS.

## Release boundary

The campaign uses a deterministic native fixture, ephemeral credentials, and
disposable digest-pinned stores. It does not execute or kill a reviewed
production-class CAD adapter in an exact staging/production deployment. The
receipt therefore keeps release runtime evidence, Private Beta, GA, independent
CAD certification, and manufacturing certification false.

The next external step is an authorized isolated staging run with the reviewed
adapter and separately held key: claim, start native execution, kill the worker,
wait for lease expiry, verify quarantine, reconcile operator state, and capture
the exact release-bound recovery receipt. Independent CAD review and CNC,
sheet-metal, and additive manufacturing pilots remain separately required.
