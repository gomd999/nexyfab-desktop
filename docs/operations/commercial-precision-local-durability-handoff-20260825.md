# Commercial Precision local durability handoff — 2026-08-25

Status: `LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS / RELEASE_RUNTIME_HOLD`

This handoff records the source/infrastructure closure shared by AI Design,
Precision CAD, and integration. It does not authorize a staging or production
promotion.

## 2026-08-25 cross-store restore v3 addendum

Platform commits `2c79c2da95e0ea32c25f6a3c83e058d50cc7f265`,
`f649678730b18f4a22e3a8ec641ee33a067299be`, and
`c54e6f607e13878b0adfcf7b64f9b8c0d9873975` extend the same disposable
campaign with a real PostgreSQL plus S3-compatible backup/restore drill.
PostgreSQL is dumped and restored into an isolated database, all public table
content is compared, current migrations run, previously unvalidated
constraints are validated, and final foreign-key integrity is required.

Before cleanup, every bounded source object is read and hashed, copied with
no-overwrite semantics to an initially empty backup prefix, read back, copied
to a separate initially empty restore prefix, and read back again. The three
manifests must match exactly. Source DB rows for immutable inputs, committed
outputs, and artifact snapshots must bind to the exact object bytes, and both
source stores are rechecked for changes.

The checked-in cross-store receipt is
`docs/evidence/cad-independent/commercial-precision-cross-store-restore-20260825.json`.
It is schema `nexyfab.backup-isolated-restore-drill.v3`, bound to source HEAD
`c54e6f607e13878b0adfcf7b64f9b8c0d9873975`, and has receipt SHA-256
`575c30ebded3337f0cb9b50e24898bad30ddfd0746b1cb6fffb6c847b85a6b5d`.
It matches 164 restored tables/104 rows and 8 source/backup/restored objects
with 2 immutable-input, 3 committed-output, and 3 artifact-snapshot bindings.
Measured local RPO age is 0 ms and end-to-end RTO is 13,029 ms.

This receipt is explicitly `local-fixture`; release-bound observation, Private
Beta, and GA remain false. Commercialization accepts only a fresh v3
`release-bound` receipt tied to the exact release and rejects this local proof
for promotion.

Release-bound mode now also requires an existing immutable provider database
backup with at-rest KMS key-version and provider-receipt bindings. The object
backup must be in a distinct endpoint or region failure domain with bucket
versioning, Object Lock default retention, and KMS encryption verified after
readback. The local receipt records every one of these protection claims as
false instead of borrowing a label-only PASS.

## Current crash-after-claim and service-restart closure

Precision commit `94ad99b6eae22ab5b69f91992785aab8caa97e88` clears expired
`lease_owner`, `lease_expires_at`, and `capability_hash` in the same PostgreSQL
transaction that quarantines the outbox and journal. Platform commit
`ad437dbf341b6c9d7643bf4d2e742ba077d0acbf` advances the local receipt to
`nexyfab.commercial-precision-local-durability.v3`.

The campaign now creates a second fully approved execution, enqueues and claims
it normally, then models worker disappearance by producing no callback, output,
or persistence record before advancing the logical clock beyond the lease. It
requires outbox and journal `VERIFIED_UNKNOWN`, a valid journal hash chain, the
exact recovery reason, cleared lease authority, idempotent recovery, stale
capability HTTP 403, no re-claim, an unchanged workspace head, and zero output,
callback, worker-artifact, persistence, or workspace-commit side effects.

The campaign also
closes the database, Redis, and object-storage clients; actually restarts all
three disposable services; waits for health; rediscovers their published ports;
and reconnects using fresh clients.

After restart it verifies the PostgreSQL migration checksum, completed outbox
and execution journal, persistence receipt, and workspace CAS head. It reads
the Redis AOF sentinel and every immutable input, output, and snapshot object
from S3-compatible storage, rechecking byte length and SHA-256. Finally, it
replays authoritative persistence through a read-only artifact store that
throws on every attempted write; the only accepted outcome is exact `REPLAY`.

The checked-in receipt is bound to source HEAD
`c54e6f607e13878b0adfcf7b64f9b8c0d9873975`, was generated at
`2026-08-25T13:14:23.925Z`, passes 29/29 checks, and has receipt SHA-256
`67e1bafac0d4d747d0dd2d8ff1aa7b03d90bff64888a22e352cf714c6ad6d35a`.
The claim boundary remains explicit: this is a disposable deterministic
fixture, not release runtime evidence; Private Beta and GA are false. No
staging or production service was deployed, restarted, reconfigured, or
written by this closure.

## Isolated staging HOLD follow-up

The durable core was subsequently deployed to the isolated Railway `staging`
environment at source `7c73263973836bd036f93ef51ae920257ad7c175`, deployment
`356947fe-2b45-453a-aba2-eeb57c33b91e`. Two instances are running. Exact live,
PostgreSQL, Redis, migration `2026082502`, runtime-HOLD packaging, forged claim,
forged lease, and unconfigured callback checks passed 11/11. The redacted
receipt is
`docs/evidence/release/commercial-precision-staging-hold-20260825.json`.

This proves the core deployment and fail-closed boundary only. The commercial
boundary is deliberately disabled, so it does not replace the missing positive
native-worker, recovery, independent CAD, expert, or manufacturing evidence.
The separate operational handoff is
`docs/operations/commercial-precision-staging-hold-handoff-20260825.md`.

## Bound implementation

- immutable-input and journal lease fix: `90c707a5`;
- disposable infrastructure and CI campaign: `5c063e5a`;
- worker trust and evidence-provenance gate: `fc828fd2`;
- live-gate missing-worker-trust regression: `f42aee1c`;
- date-stable spatial receipt regression: `eb04248d`;
- actual service-restart durability: `9819aa13`;
- expired-lease authority clearing: `94ad99b6`;
- actual crash-after-claim campaign: `ad437dbf`;
- cross-store restore drill v3: `2c79c2da`;
- restore receipt path redaction: `f6496787`;
- release-bound protected backup gate: `c54e6f60`;
- execution contract: `nexyfab.precision-cad-commercial-execution.v3`;
- immutable input: `nexyfab.precision-cad-commercial-input.v2`;
- runtime receipt: `nexyfab.commercial-precision-runtime-evidence.v3`;
- PostgreSQL migration target: `2026082502`, current source SHA-256
  `07451ebcc671a837bb51c6fed94e6874068814a51c4da674aa0b89b7595f3ec9`.

Input v2 binds the immutable job, workspace, command, target, and arguments.
It intentionally excludes mutable `attempt` and `leaseGeneration`; those values
advance only when the server claims a job and remain exactly bound by the HMAC
transport, lease capability, callback, and signed worker receipt.

Worker claim now advances the outbox and execution journal from `APPROVED` to
`CLAIMED`/`EXECUTING` in one PostgreSQL transaction and appends the exact lease
event. Expired claim recovery likewise moves both records to
`VERIFIED_UNKNOWN` atomically. A result can therefore satisfy the authoritative
persistence coordinator without weakening its journal precondition.

## Executed local evidence

Command:

```text
npm run commercial:precision:local-durability -- --write
```

The final run started disposable digest-pinned PostgreSQL, Redis AOF, and
S3-compatible containers; applied the real migrations; ran the real internal
claim/artifact/callback/persistence routes; executed a separate native fixture
process without a shell; restarted all three persistence services; verified
fresh-client recovery; and removed all containers, networks, and volumes.

Receipt:
`docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`

- source Git head: `c54e6f607e13878b0adfcf7b64f9b8c0d9873975`;
- generated: `2026-08-25T13:14:23.925Z`;
- receipt SHA-256:
  `67e1bafac0d4d747d0dd2d8ff1aa7b03d90bff64888a22e352cf714c6ad6d35a`;
- result: 29/29 `PASS`, including multi-instance exclusion, immutable input and
  three-output readback, isolated native execution, Ed25519/HMAC verification,
  wrong-worker/input/output/conflicting-replay rejection, exact callback retry,
  a separate real claim followed by worker-disappearance quarantine, expired-
  lease authority clearing and no-replay, credential rotation, approved native
  executable/invocation substitution rejection, artifact
  snapshots, signed parser persistence, workspace HEAD CAS, actual PostgreSQL,
  Redis AOF, and object-storage restart persistence, and exact persistence
  replay after restart without recopy or re-execution.

The path-filtered and weekly GitHub Actions workflow
`.github/workflows/commercial-precision-durability.yml` reruns the same campaign
without writing a repository receipt.

## Integrated verification

The integration worktree was verified after the implementation and receipt
changes, without deploying or mutating production:

- full Vitest: 2,950 files and 30,188 tests passed; 10 files/89 tests were
  explicitly skipped and one test remains an existing todo;
- Node test runner: 618 passed, 5 environment-dependent symlink tests skipped,
  0 failed;
- `npm run lint:ci`: passed;
- production `npm run build`: passed, including TypeScript, 301 static pages,
  standalone pruning, and bundle budgets;
- secret scan: current Git-versioned candidate set, zero findings and zero
  oversized-file omissions.

The first full Vitest run exposed two tests whose fixed receipt expired on
2026-08-25. Commit `eb04248d` injects an explicit evaluation clock; the focused
test passed 4/4 and the complete rerun passed 30,188/30,188. This changes only
test determinism, not expiry enforcement in production.

## Release authority

The committed runtime receipt is schema v3 and remains `HOLD`, receipt SHA-256
`bd12ecba3301f192b2e070acf553001ed2595c4b4bfcff1530ab759430da66a6`,
because no release-bound runtime observation was supplied. V2 verifies the
actual Ed25519 worker signature against the current public-key registry and
requires the exact machine assertion mapped to every `PASS`; a shaped signature
or free-form claim cannot promote a check.

The local campaign uses ephemeral credentials and a deterministic native
fixture. It is not a production-class CAD adapter qualification, a staging or
production observation, independent STEP/native-CAD/XCAF/GD&T evidence, expert
approval, manufacturing-pilot evidence, or a seven-day operations receipt.
AI Design remains concept/candidate authority only; manufacturing release and
commercial mode remain disabled.

## Next controlled sequence

1. Deploy the exact candidate commit to isolated non-commercial staging with a
   reviewed native CAD adapter and worker key held outside the web service.
2. Capture the database, object-storage, worker, negative, and recovery evidence
   documents from that same deployment and derive a fresh Private Beta receipt
   v2.
3. Complete independent CAD/expert and three manufacturing-pilot evidence plus
   security/legal, restore/rollback, alerting, and seven-day operations evidence.
4. Run the GA recovery matrix again on the exact production deployment only
   after explicit promotion approval.
