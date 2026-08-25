# Commercial Precision worker v3 deployment contract

Status: `LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS / CORE_STAGING_HOLD_VERIFIED / REAL_WORKER_RUNTIME_NOT_RUN / RELEASE_HOLD`

This runbook covers the isolated worker for
`nexyfab.precision-cad-commercial-execution.v3`. It does not authorize
production deployment, generate keys, or qualify a CAD engine.

## Approved adapter identity boundary (2026-08-25)

The worker trust registry now binds each Ed25519 identity to an approved
`nativeExecutableSha256` and `nativeInvocationSha256`. The latter is SHA-256
over canonical schema `nexyfab.precision-cad-native-invocation.v1`, the
executable hash, and the exact ordered native argument array. A valid worker
signature with a different executable or invocation remains untrusted.

`containers/occt-commercial-worker/` provides the deployment wrapper. Its
build plan requires a private adapter image by exact OCI digest, verifies the
adapter executable and worker source bytes by SHA-256, runs as numeric non-root
user `65532`, and carries no runtime secret. `/live` is process liveness;
`/health` is HTTP 503 `NOT_READY` until a signed canary completes. This closes
the source/deployment identity boundary but does not supply or qualify the real
adapter image.

## Local durable exact campaign (2026-08-25)

`npm run commercial:precision:local-durability` now runs the complete source
path against disposable, loopback-only PostgreSQL, Redis AOF, and S3-compatible
containers pinned by image digest. It applies the real versioned migrations,
stages immutable input v2, performs two-instance claim exclusion, executes a
separate native fixture process without a shell, commits and reads back exactly
three immutable outputs, verifies Ed25519/HMAC receipts, snapshots the artifacts,
persists the signed native-parser receipt, and advances the authoritative CAD
workspace HEAD with compare-and-swap.

The same campaign proves wrong-worker, input/output substitution, conflicting
callback replay, lease expiry, `VERIFIED_UNKNOWN` no-replay, key rotation trust
boundary, exact callback retry, exact persistence replay without recopy, and
atomic outbox/journal/workspace completion. Worker claim and expired-lease
recovery now advance the execution journal in the same PostgreSQL transaction;
an `APPROVED` journal can no longer become a claimed job while remaining
ineligible for authoritative persistence.

The checked-in receipt is
`docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`.
All 24 checks are `PASS`, including `nativeAdapterBinding`,
`authoritativePersistence`, and `workspaceCasCommit`. The dedicated
`.github/workflows/commercial-precision-durability.yml` gate reruns the campaign
for affected changes and weekly.

This remains a source/infrastructure regression campaign. Its native executable
is an isolated deterministic fixture, its credentials are ephemeral, and its
objects and database are deleted after the run. It is explicitly not a
release-bound staging/production observation, a production-class CAD engine
qualification, independent CAD interoperability, expert approval, or
manufacturing evidence; Private Beta and GA therefore remain false.

## Runtime split

The web/core service owns approval, PostgreSQL state, immutable object identity,
lease authorization, output commit verification, receipt acceptance, and final
persistence. The isolated worker owns only claim consumption, immutable input
readback, one native process execution, three output uploads, and its Ed25519
receipt.

Do not place a private worker signing key in the web service. Do not place the
server trust registry or database credentials in the worker. Staging and
production must use different secrets, worker identities, storage namespaces,
and signing keys.

## Current staging evidence (2026-08-25)

- Core source `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7` is deployed to the
  isolated Railway `staging` environment as deployment
  `c1e03352-5f95-47eb-a031-80847b22391c`. Railway reports two configured and
  two running instances, zero crashed instances, and no attached web-service
  volume.
- The production and staging environment variables were compared only in
  memory by the redacting isolation auditor: 30/30 checks passed for distinct
  environment identity, PostgreSQL, Redis, S3 bucket/credentials, application
  secrets, site origin, and disabled staging payments. Production was read for
  comparison only and was not mutated.
- PostgreSQL migration `2026082502` is applied with source checksum
  `69c830cb4fa11fb7637f325098d0c0b1a920caeba9802fbbe4a8658f00055f30`.
- Liveness and non-commercial readiness return HTTP 200 with the exact build
  ID; authoritative PostgreSQL and required Redis are `ok`. A forged worker
  claim and forged artifact lease are rejected with HTTP 403 `FORBIDDEN` and
  `LEASE_CAPABILITY_INVALID`. The unconfigured callback remains HTTP 503
  `CALLBACK_NOT_CONFIGURED`.
- Commercial mode remains disabled and the channel remains `staging-hold`.
  Release health returns HTTP 503 `HOLD`; migration is `PASS` and the packaged
  precision runtime receipt is explicit `HOLD` with receipt SHA-256
  `bd12ecba3301f192b2e070acf553001ed2595c4b4bfcff1530ab759430da66a6`.
  Commits `34b167fc` and `7c732639` closed the standalone and Railway-context
  omissions that previously reduced this signal to `NOT_RUN` or failed the
  remote build.
- `npm run commercial:precision:staging-hold-evidence` repeats the exact
  release and negative probes while refusing a production/non-HTTPS origin.
  The checked-in receipt
  `docs/evidence/release/commercial-precision-staging-hold-20260825.json` is
  `STAGING_HOLD_VERIFIED`, 11/11 checks passed, and has canonical self-hash
  `b6cba9a6b285eb0f42564e0471470d942745b0609ce83d39c57e496de607392c`.
  The commercialization gate now verifies this receipt directly and rejects a
  stale, edited, or different-build staging observation. Both Private Beta and
  GA remain false.
- No real native adapter, isolated worker, signing key, registry, or canary was
  created. This section is core deployment evidence, not worker or CAD-engine
  qualification evidence. Production was not modified.

## Core service configuration

Required when commercial mode is enabled:

- `NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON`: public Ed25519 worker registry;
- `NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET`: claim endpoint bearer secret;
- `NEXYFAB_COMMERCIAL_TRANSPORT_SECRET`: v3 envelope HMAC secret;
- `NEXYFAB_COMMERCIAL_CALLBACK_SECRET`: callback HMAC secret;
- `NEXYFAB_COMMERCIAL_CALLBACK_URL`: HTTPS, server-owned callback endpoint;
- `NEXYFAB_COMMERCIAL_WORKER_LEASE_MS`: optional, 30 seconds through 30 minutes,
  default 15 minutes;
- PostgreSQL migration and checksum through `2026082502`;
- private object storage with immutable upload, download, and SHA-256 readback.

The registry contains public trust material only: worker identity, Ed25519
public key and SPKI fingerprint, approved executable SHA-256, and approved
invocation SHA-256. It contains no private key. The worker fingerprint must
equal SHA-256 over the Ed25519 SPKI DER bytes and be disjoint from
external-verifier fingerprints.

## Worker service configuration

Start the client with:

```text
npm run start:commercial-precision-worker
```

Required variables:

- `NEXYFAB_COMMERCIAL_CORE_URL`: public HTTPS origin of the core service;
- `NEXYFAB_COMMERCIAL_WORKER_IDENTITY`: exact registered identity;
- `NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET`;
- `NEXYFAB_COMMERCIAL_TRANSPORT_SECRET`;
- `NEXYFAB_COMMERCIAL_CALLBACK_SECRET`;
- `NEXYFAB_COMMERCIAL_WORKER_PRIVATE_KEY_PEM`: Ed25519 private PEM available
  only to this worker;
- `NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE`: absolute path to the pinned native
  adapter executable;
- `NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE_SHA256`: approved executable bytes;
- `NEXYFAB_COMMERCIAL_NATIVE_INVOCATION_SHA256`: approved canonical binding of
  that executable hash and `NEXYFAB_COMMERCIAL_NATIVE_ARGS_JSON`.

Optional variables are `NEXYFAB_COMMERCIAL_NATIVE_ARGS_JSON`,
`NEXYFAB_COMMERCIAL_NATIVE_TIMEOUT_MS`,
`NEXYFAB_COMMERCIAL_WORKER_POLL_MS`,
`NEXYFAB_COMMERCIAL_SELF_TEST_JOB_PREFIX`, and `PORT`.

The adapter is invoked without a shell as:

```text
<executable> <configured args> --input <canonical-input.json> --output-dir <empty-dir>
```

The downloaded canonical input uses
`nexyfab.precision-cad-commercial-input.v2`. It binds the immutable job,
workspace, command, target, and argument identities, but deliberately excludes
`attempt` and `leaseGeneration`: those two values are server-owned claim state
that advances after the input object is written. The signed transport and worker
receipt still bind their exact claimed values. Input v1 is rejected; changing
any non-lease job field or the arguments still fails before native execution.

It must exit zero and create regular, non-symlink files named `model.step` and
`report.json`. The STEP file must contain the ISO-10303-21 envelope. The JSON
report must contain `"status":"PASS"`. The worker creates the third
`verification` output itself and binds the executable, input, model, and report
SHA-256 values. A JavaScript geometry fallback is not permitted.

## Staging activation order

1. Build an isolated worker image containing a reviewed, checksum-pinned native
   adapter and no web/database secrets.
2. Apply migration `2026082502` to staging and register its source checksum.
3. Configure the public worker key and core transport secrets in staging core.
4. Configure the matching private key and transport secrets in the isolated
   staging worker.
5. Keep commercial mode disabled and verify `/live` returns HTTP 200 while
   `/health` returns HTTP 503 `NOT_READY` with `NOT_RUN` checks before a canary.
6. Enqueue a server-owned canary whose job ID uses the configured self-test
   prefix. Confirm claim, input readback, native execution, three immutable
   commits, signed callback, and core receipt acceptance.
7. Confirm worker health reports schema
   `nexyfab.precision-cad-commercial-worker-health.v1`, execution contract v3,
   the registered identity, all four PASS checks, a receipt SHA-256, and a fresh
   self-test timestamp.
8. Exercise forged lease, wrong worker, input substitution, output substitution,
   conflicting callback replay, exact callback retry, expired lease, process
   crash, and restart recovery.

## Evidence receipt and promotion commands

Collect evidence outside the source tree and expose it read-only to the gate.
Set `NEXYFAB_COMMERCIAL_PRECISION_EVIDENCE_ROOT` to that directory and
`COMMERCIAL_PRECISION_RUNTIME_OBSERVATION` to a contained relative JSON path.
The observation must use schema
`nexyfab.commercial-precision-runtime-observation.v1` and be signed with
`GENERATION_EVIDENCE_SIGNING_SECRET`; the secret must be at least 32 bytes and
must not be stored in the receipt or repository.

The observation references five distinct, contained JSON documents:

- `nexyfab.commercial-precision-database-snapshot.v1`;
- `nexyfab.commercial-precision-object-storage-manifest.v1`;
- `nexyfab.precision-cad-commercial-execution.v3` worker receipt;
- `nexyfab.commercial-precision-negative-campaign.v1`;
- `nexyfab.commercial-precision-recovery-campaign.v1`.

Receipt schema `nexyfab.commercial-precision-runtime-evidence.v3` also requires
the current `NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON` registry. The evidence builder
parses the registered Ed25519 public key, recomputes its SPKI fingerprint, and
cryptographically verifies the worker receipt signature and exact executable
and invocation hashes. A base64-shaped value, a fingerprint-only receipt, an
adapter mismatch, an absent registry, or a receipt signed by a key outside the
current registry remains `HOLD`. The derived receipt records only public worker
identity, fingerprint, adapter hashes, registry SHA-256, and verification
result; it never copies a private key.

The v2 derivation also refuses free-form check promotion. Every `PASS` in the
20-check matrix must have its exact machine assertion in the bound source:
PostgreSQL/Redis/outbox/lease/callback/persistence/CAS in the database snapshot,
immutable input and three-output hash readback in the object manifest, native
execution and Ed25519 verification in the worker receipt, substitution/replay
denials in the negative campaign, and exclusion/lease/crash/unknown/rotation in
the recovery campaign. A missing or merely similar assertion produces
`check_evidence_missing:<check>` and keeps both tiers `HOLD`.

Set `RELEASE_BUILD_ID`, `RELEASE_GIT_HEAD`, and `RELEASE_DEPLOYMENT_ID` to the
exact candidate, then run:

```text
npm run commercial:precision:runtime-evidence
```

The product release baseline must additionally set
`RELEASE_ENVIRONMENT=production` and `RELEASE_SERVICE=nexyfab.com`. The
commercialization gate rejects a staging deployment ID or another Railway
service even when its build, Git, and deployment identifiers are otherwise
well formed. Staging runtime evidence may qualify the Precision Private Beta
sub-gate, but it cannot impersonate the production product release identity.

That command may qualify only the Private Beta tier from staging. Production GA
requires the same-deployment production observation and all five GA recovery
checks:

```text
npm run commercial:precision:runtime-gate
npm run commercial:release-gate
```

The derived receipt defaults to
`docs/evidence/release/commercial-precision-runtime-evidence.json`. The live
release endpoint loads that path, or the contained relative path configured by
`COMMERCIAL_PRECISION_RUNTIME_RECEIPT_PATH`, and independently verifies its
fresh HMAC, current release identity, migration `2026082502` checksum,
execution contract, five evidence bindings, and all 20 checks. A copied,
resigned-for-another-release, stale, incomplete, or unsigned receipt stays
`HOLD`.

## Fail-closed release rules

- `NOT_READY`, missing migration/checksum, missing immutable storage capability,
  a stale self-test, or any identity/hash mismatch keeps release `HOLD`.
- A local fixture process is test evidence only. It is not evidence that a real
  production-class CAD adapter is deployed.
- A worker PASS advances the outbox only to `VERIFIED_UNKNOWN`; authoritative
  parser, persistence, workspace CAS, and independent verification still have
  to close before product release.
- Production remains prohibited until independent STEP/native-CAD exchange,
  topology/XCAF/GD&T review, multi-instance recovery, credential rotation,
  expert approval, manufacturing pilots, and the platform launch gates pass.
