# Commercial Precision worker v3 deployment contract

Status: `SOURCE_READY / EXTERNAL_RUNTIME_NOT_RUN / RELEASE_HOLD`

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
