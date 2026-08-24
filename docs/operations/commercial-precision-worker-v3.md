# Commercial Precision worker v3 deployment contract

Status: `CORE_STAGING_DEPLOYED / WORKER_RUNTIME_NOT_RUN / RELEASE_HOLD`

This runbook covers the isolated worker for
`nexyfab.precision-cad-commercial-execution.v3`. It does not authorize
production deployment, generate keys, or qualify a CAD engine.

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

- Core source `674c54f59ec908891962591314366afe0c8eea30` is deployed to the
  isolated Railway staging web service as deployment
  `e9286b9d-7d9b-4f45-8404-e4ec838fdbd2`.
- Railway reports two running deployment instances, no attached service volume,
  and runtime image digest
  `sha256:64f2f0f1ee84bc2dd42e6e16993c4b9f12be3ac1b90f455b084799094fd94569`.
- PostgreSQL migration `2026082502` is applied with source checksum
  `69c830cb4fa11fb7637f325098d0c0b1a920caeba9802fbbe4a8658f00055f30`.
- Liveness and non-commercial readiness return HTTP 200; PostgreSQL and Redis
  are `ok`. A forged lease against the v3 artifact gateway is rejected with
  HTTP 403 `LEASE_CAPABILITY_INVALID`.
- Commercial mode remains disabled and the channel remains `staging-hold`.
  Release health returns HTTP 503 `HOLD`; its migration evidence is `PASS`,
  while runtime, i18n, seven-day operations, and external registry evidence do
  not qualify the release.
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

The registry contains public keys only. Its fingerprint must equal SHA-256 over
the Ed25519 SPKI DER bytes, and it must be disjoint from external-verifier
fingerprints.

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
  adapter executable.

Optional variables are `NEXYFAB_COMMERCIAL_NATIVE_ARGS_JSON`,
`NEXYFAB_COMMERCIAL_NATIVE_TIMEOUT_MS`,
`NEXYFAB_COMMERCIAL_WORKER_POLL_MS`,
`NEXYFAB_COMMERCIAL_SELF_TEST_JOB_PREFIX`, and `PORT`.

The adapter is invoked without a shell as:

```text
<executable> <configured args> --input <canonical-input.json> --output-dir <empty-dir>
```

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
5. Keep commercial mode disabled and verify `/health` reports `NOT_READY` and
   `NOT_RUN` checks before a canary.
6. Enqueue a server-owned canary whose job ID uses the configured self-test
   prefix. Confirm claim, input readback, native execution, three immutable
   commits, signed callback, and core receipt acceptance.
7. Confirm worker health reports schema
   `nexyfab.precision-cad-commercial-worker-health.v1`, execution contract v3,
   the registered identity, all four PASS checks, a receipt SHA-256, and a fresh
   self-test timestamp.
8. Exercise forged lease, wrong worker, input substitution, output substitution,
   callback replay, expired lease, process crash, and restart recovery.

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

Set `RELEASE_BUILD_ID`, `RELEASE_GIT_HEAD`, and `RELEASE_DEPLOYMENT_ID` to the
exact candidate, then run:

```text
npm run commercial:precision:runtime-evidence
```

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
