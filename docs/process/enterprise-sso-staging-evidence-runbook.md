# Enterprise SSO staging evidence runbook

## Commercial status

The default `docs/evidence/release/enterprise-sso-readiness-receipt.json` is an
honest `NOT_RUN / HOLD` receipt. It does not activate SAML or OIDC. A structurally
valid HOLD passes the contract check but fails the release check.

```powershell
npm run evidence:enterprise-sso:contract-check
npm run evidence:enterprise-sso:release-check
```

The second command must be used by release automation. It exits non-zero until
all externally collected staging evidence is eligible.

## Trust boundary

PASS requires an Ed25519 signature from a collector in the pinned allowlist:

`docs/evidence/release/enterprise-sso-trusted-collectors.json`

An alternate allowlist path is rejected. The release authority, not the test
caller, owns this file and reviews key rotation. Its schema is
`nexyfab.enterprise-sso-trusted-collectors.v1`:

```json
{
  "schema": "nexyfab.enterprise-sso-trusted-collectors.v1",
  "collectors": [{
    "id": "staging-ci-collector-1",
    "status": "ACTIVE",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...",
    "publicKeySha256": "canonical sha256 of publicKeyPem",
    "allowedStagingOrigins": ["https://staging.nexyfab.example"],
    "allowedDeploymentIds": ["exact-staging-deployment-id"]
  }],
  "allowlistSha256": "canonical self-hash excluding allowlistSha256"
}
```

Keep the private key outside the repository and application environment. A
repository writer must not be able to obtain it. The collector signs
`enterpriseSsoCollectorAttestationPayload(manifest)`, which binds the canonical
manifest body, case evidence root, every artifact byte/hash, release, exact
origin, isolation receipt, and run identity. Self-hashes alone are integrity
checks and are never promotion authority.

## Target, release, isolation, and time

- Target must be an exact HTTPS origin with no path, query, or fragment.
- The origin and deployment ID must appear in the pinned collector allowlist.
- Build ID, deployment ID, and full Git commit must equal the commercial release
  baseline and every case/isolation record.
- The isolation receipt uses `nexyfab.enterprise-sso-staging-isolation.v1`, is
  bound into the signed manifest, and requires isolated database, Redis, and
  session stores plus production mutation disabled.
- Evidence is valid for at most 24 hours with five minutes future skew.
- A run may last at most two hours.
- `manifest.capturedAt` must exactly equal `run.completedAt`.
- Receipt generation must occur after completion and within 15 minutes.
- Every case timestamp must be within the signed run and freshness window.

Example isolation receipt:

```json
{
  "schema": "nexyfab.enterprise-sso-staging-isolation.v1",
  "capturedAt": "2026-08-23T00:20:00.000Z",
  "environment": "staging",
  "target": "https://staging.nexyfab.example",
  "deploymentId": "exact-staging-deployment-id",
  "release": { "buildId": "...", "deploymentId": "...", "gitHead": "..." },
  "controls": {
    "databaseIsolated": true,
    "redisIsolated": true,
    "sessionStoreIsolated": true,
    "productionMutationDisabled": true
  },
  "isolationSha256": "canonical self-hash excluding isolationSha256"
}
```

## Required protocol cases

The authoritative 22-case matrix is
`ENTERPRISE_SSO_CASE_SPECS` in
`scripts/build-enterprise-sso-readiness-receipt.mjs`. The collector must import
it rather than duplicate it.

SAML covers signed Response/Assertion acceptance; invalid signature; duplicate
ID/wrapping; issuer, audience, destination, NotBefore, expiry, InResponseTo;
replay; and local session issuance/lookup/cleanup.

OIDC covers the valid authorization-code flow; one-use state; nonce; PKCE S256;
pinned discovery; JWKS signature and algorithm allowlist; issuer, audience and
expiry claims; userinfo subject binding; redirect allowlist; state/code replay;
and local session issuance/lookup/cleanup.

Each raw case uses `nexyfab.enterprise-sso-staging-case.v1` and must include:

- exact case ID, protocol, stimulus, expected error code and HTTP outcome;
- safe request and response SHA-256 values, without tokens, assertions, cookies,
  secrets, or personal claims;
- transaction ID and, for replay cases, the exact predecessor case and
  predecessor transaction ID;
- accepted-session lookup plus confirmed cleanup, or rejected-session
  non-existence;
- SAML certificate, signed reference, and digest fingerprints, signed element,
  and `rsa-sha256` or `ecdsa-sha256`;
- OIDC issuer fingerprint, discovery/JWKS/kid/token/userinfo-subject hashes and
  the case-specific observed algorithm;
- `artifactSha256`, calculated with
  `attachEvidenceSha256(caseRecord, "artifactSha256")`.

Rejected cases use the exact error code exported in the case matrix. A generic
error, an unlinked `attempt: 2`, a claimed session boolean without lookup and
cleanup evidence, or an incomplete cryptographic observation is ineligible.

## Manifest and collector signature

The manifest uses `nexyfab.enterprise-sso-staging-evidence.v1`. Its `cases`
array contains exact local `path`, `bytes`, and `sha256` bindings. Paths must be
repository-relative regular files; traversal, absolute paths, symlinks, and
parent-directory junction escapes are rejected.

Calculate `caseEvidenceRootSha256` with
`enterpriseSsoCaseEvidenceRoot(cases)`. Add the isolation receipt binding and
run/release/target fields. Sign
`enterpriseSsoCollectorAttestationPayload(unsignedManifestBody)` with the
allowlisted Ed25519 private key, then attach:

```json
{
  "attestation": {
    "collectorId": "staging-ci-collector-1",
    "algorithm": "Ed25519",
    "signedAt": "2026-08-23T00:20:00.000Z",
    "signature": "base64-ed25519-signature"
  }
}
```

Finally compute `evidenceSha256` with `attachEvidenceSha256(manifest)`. Do not
edit or reserialize evidence after its binding or signature has been created.

## Build and promotion

The collector performs the real staging calls. The builder performs no network,
IdP, database, or production operation.

```powershell
node scripts/build-enterprise-sso-readiness-receipt.mjs `
  --input artifacts/enterprise-sso/run-id/manifest.json `
  --write

npm run evidence:enterprise-sso:release-check
npm run commercialization:gate
```

All input, baseline, allowlist, output, isolation, and case paths are contained
inside the repository and checked against symlink/realpath escape. A fresh
receipt cannot rewrap stale evidence. A caller-generated key or alternate
allowlist, arbitrary staging-looking domain, unsigned case set, wrong error
code, unlinked replay, or self-rehashed summary remains HOLD.
