# Commercial Precision local durability handoff — 2026-08-25

Status: `LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS / RELEASE_RUNTIME_HOLD`

This handoff records the source/infrastructure closure shared by AI Design,
Precision CAD, and integration. It does not authorize a staging or production
promotion.

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
- execution contract: `nexyfab.precision-cad-commercial-execution.v3`;
- immutable input: `nexyfab.precision-cad-commercial-input.v2`;
- runtime receipt: `nexyfab.commercial-precision-runtime-evidence.v2`;
- PostgreSQL migration target: `2026082502`, source SHA-256
  `69c830cb4fa11fb7637f325098d0c0b1a920caeba9802fbbe4a8658f00055f30`.

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
npm run commercial:precision:local-durability:generate
```

The final run started disposable digest-pinned PostgreSQL, Redis AOF, and
S3-compatible containers; applied the real migrations; ran the real internal
claim/artifact/callback/persistence routes; executed a separate native fixture
process without a shell; and removed all containers, networks, and volumes.

Receipt:
`docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`

- source Git head: `f42aee1cf67820d29bcb187cc8a7486cb5bc0776`;
- generated: `2026-08-25T00:18:53.872Z`;
- receipt SHA-256:
  `b56527378bac7377a58b63fc6bb2c008fa11e578824a162a854ea5dfa2e058b4`;
- result: 24/24 `PASS`, including multi-instance exclusion, immutable input and
  three-output readback, isolated native execution, Ed25519/HMAC verification,
  wrong-worker/input/output/conflicting-replay rejection, exact callback retry,
  expired-lease quarantine and no-replay, credential rotation, artifact
  snapshots, signed parser persistence, workspace HEAD CAS, and exact
  persistence replay without recopy or re-execution.

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

The committed runtime receipt is schema v2 and remains `HOLD`, receipt SHA-256
`1c77d674b11cbdb4f94376865d20334e0ea1ad7be89685ecb73eaa0491037677`,
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
