# Large-upload staging readiness evidence

This runbook defines the external evidence required before `large-upload` can enter a commercial release scope. The checked-in receipt is intentionally `HOLD / NOT_RUN`. The local builder makes no network calls and cannot convert a hand-written summary or caller `PASS` field into release evidence.

## Trust and safety boundary

- Run the collector only against an isolated HTTPS staging deployment and staging-only object-storage bucket.
- Keep the Ed25519 collector private key outside the repository. Commit or otherwise release-control only an allowlist containing collector IDs, public keys, and exact permitted staging origins.
- Bind the run to the candidate build, production deployment, Git commit, and a distinct staging evidence deployment.
- Use a disposable object prefix. Remove successful objects after capture and verify an aborted multipart upload leaves neither an object nor listed parts.
- Never record credentials, bucket names, object keys, upload IDs, presigned URLs, or payload contents. Store SHA-256 fingerprints and provider request IDs.
- Preserve every raw file exactly. Editing any artifact after signing invalidates both the collector signature and receipt source binding.

## Evidence package

The collector exports one `nexyfab.large-upload-staging-observations.v2` manifest plus nine separately bound artifacts:

1. The actual source payload, at least 67,108,864 bytes.
2. The actual roundtrip readback file.
3. The actual resume readback file.
4. `nexyfab.large-upload-roundtrip-response.v1` provider response JSON.
5. `nexyfab.large-upload-resume-response.v1` provider response JSON.
6. `nexyfab.large-upload-abort-response.v1` provider response JSON, including abort, subsequent HEAD, and list-parts request IDs/results.
7. `nexyfab.large-upload-worker-samples.v1` containing at least two timestamped raw RSS/heap samples.
8. `nexyfab.large-upload-runtime-limit.v1`, exported separately from platform runtime configuration.
9. `nexyfab.large-upload-staging-isolation.v1`, binding the exact target origin, production/staging deployment and environment IDs, and isolated database/object-storage result.

The three object-storage operations must use distinct request IDs, upload-ID fingerprints, and object-key fingerprints. Provider byte/SHA fields must match the streamed hashes of the actual source/readback files. The builder rejects hard-linked duplicate artifacts, root escapes, and symlinked inputs.

The manifest contains only run identity, exact artifact paths, release/staging identity, storage fingerprint, and an attestation:

```json
{
  "schema": "nexyfab.large-upload-staging-observations.v2",
  "status": "COMPLETED",
  "captureMode": "external-staging-object-storage-probe",
  "runId": "...",
  "startedAt": "...",
  "completedAt": "...",
  "environment": "staging",
  "target": "https://allowlisted-staging-origin.example",
  "release": {
    "buildId": "...",
    "productionDeploymentId": "...",
    "gitHead": "..."
  },
  "evidenceDeploymentId": "...",
  "storage": {
    "backend": "object-storage",
    "provider": "...",
    "bucketFingerprint": "sha256"
  },
  "artifacts": {
    "sourceFile": "...",
    "roundtripReadbackFile": "...",
    "resumeReadbackFile": "...",
    "roundtripResponse": "...",
    "resumeResponse": "...",
    "abortResponse": "...",
    "workerSamples": "...",
    "runtimeLimit": "...",
    "stagingIsolation": "..."
  },
  "attestation": {
    "collectorId": "...",
    "signedAt": "...",
    "signatureBase64": "..."
  }
}
```

The Ed25519 signature covers the manifest except `signatureBase64` plus the streamed byte count/SHA-256 binding of every measurement artifact. The allowlist is also bound into the final receipt. Generate the signing payload with the exported `largeUploadCollectorAttestationPayload` helper; do not reproduce canonicalization independently.

## Build and gate

Prepare a release JSON with `buildId`, production `deploymentId`, and `head` (Git SHA). Keep every input below the repository root. Then run:

```powershell
npm run evidence:large-upload:staging -- --observation docs/evidence/release/large-upload/observation.json --trusted-collectors docs/evidence/release/large-upload/trusted-collectors.json --release docs/evidence/release/release-identity.json
```

Exit code `0` means the derived receipt is eligible; `1` means truthful `HOLD`; `2` means an invalid or unsafe command/input contract. `--release` and `--out` reject absolute paths, root escapes, and symlinks.

Before the commercialization gate:

```powershell
$env:NEXYFAB_PRODUCT_RELEASE_SCOPE = 'large-upload'
$env:LARGE_UPLOAD_STAGING_READINESS_RECEIPT = 'docs/evidence/release/large-upload-staging-readiness-receipt.json'
npm run commercialization:gate
```

The receipt is valid for at most 24 hours. The gate reopens every bound source, streams its hash, verifies the receipt self-hash, re-verifies the trusted collector signature and exact staging origin/isolation evidence, independently re-derives all decisions, and matches the candidate release.

## Current state

`docs/evidence/release/large-upload-staging-observations-NOT_RUN.json` and the default readiness receipt record that no external staging run has occurred. They are blockers and must never be relabeled or edited into PASS evidence.
