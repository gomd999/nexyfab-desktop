# Verified signature response to candidate assembly

Timestamp: `2026-08-25T10:57:26Z`

Scope: `platform`

Commits:

- implementation: `b00bfb63f4f00c5c2dc95c46e2b4a50d45d9db1f`;
- tests: `af03a5cd4434e82d075b6d30c437a648ac713c3f`.

## Outcome

The manual step between an externally signed packet and a verified candidate
receipt has been removed. The candidate assembler rebuilds the packet from the
current source request and current artifact bytes, verifies every returned
Ed25519 signature against the exact packet slot, constructs the final receipt,
and invokes the same canonical validator used by product scope and receipt
promotion before it can write a candidate.

Tool:
`workspaces/platform/tools/assemble-mechanical-commercial-candidate.mjs`.

Public response contract:
`workspaces/platform/contracts/mechanical-commercial-signature-response.schema.json`.

## Signature response contract

The response is closed with `additionalProperties=false` and binds:

- `kind` to `blind` or `manufacturing`;
- the exact signing packet `packetSha256`;
- a response generation timestamp after the packet timestamp;
- one exact signature entry for every packet signing slot;
- the challenge/case ID and reviewer/inspector ID;
- the exact target hash and canonical payload SHA-256; and
- one canonical 64-byte Ed25519 signature.

Blind keys require the `mechanical-blind-reviewer` role. Manufacturing keys
require the `manufacturing-inspector` role. A complete response cannot omit a
slot, duplicate a slot, add an unrequested signer, transplant a valid signature
to another target, or carry an extra release claim.

## Revalidation and assembly

The packet is not trusted merely because it contains a self-hash. The assembler
resolves its source request inside the selected external evidence root and calls
the signing-packet builder again. Current request bytes, artifact bytes, target
hashes, payloads, source binding, packet hash, field sets, and ordering-neutral
canonical content must reproduce the supplied packet exactly.

Only after all response signatures verify does the tool populate the unsigned
templates. It derives exact summaries and receipt timestamps, then calls
`validateMechanicalBlindChallenge` or
`validateMechanicalManufacturingReceipt`. Failure at any stage creates no
output.

Run a read-only check first:

```powershell
node workspaces/platform/tools/assemble-mechanical-commercial-candidate.mjs `
  --kind=blind `
  --packet=<external-root>\packets\blind-signing-packet.json `
  --response=<external-root>\responses\blind-signature-response.json `
  --evidence-root=<external-root> `
  --check

node workspaces/platform/tools/assemble-mechanical-commercial-candidate.mjs `
  --kind=manufacturing `
  --packet=<external-root>\packets\manufacturing-signing-packet.json `
  --response=<external-root>\responses\manufacturing-signature-response.json `
  --evidence-root=<external-root> `
  --check
```

The process environment must contain the corresponding role-scoped public key
registry: `NEXYFAB_BLIND_REVIEWER_KEYS` or
`NEXYFAB_MANUFACTURING_REVIEWER_KEYS`.

After a successful check, create a new candidate inside the same evidence root:

```powershell
node workspaces/platform/tools/assemble-mechanical-commercial-candidate.mjs `
  --kind=blind `
  --packet=<external-root>\packets\blind-signing-packet.json `
  --response=<external-root>\responses\blind-signature-response.json `
  --evidence-root=<external-root> `
  --output=<external-root>\candidates\blind-candidate.json
```

The candidate must then pass the separate
`promote-mechanical-commercial-receipt.mjs --check` command before any clean
integration checkout considers a canonical gate-path promotion.

## Failure and write semantics

- Evidence root, packet, response, source request, and artifact real paths are
  constrained to the same external non-symlink root.
- Output must be a new path under a real non-symlink directory inside that root.
- Existing output is never replaced. Writes use an exclusive temporary and
  hard-link no-replace.
- Cryptographic, response, rebuilt-packet, or final-candidate invalidity exits 4
  and writes zero files. Unsafe configuration or paths exit 2.
- The machine result reports the in-memory candidate SHA-256 and, when written,
  the output SHA-256.
- Claim boundary: `assemblesCandidateReceipt=true`,
  `createsUnderlyingEvidence=false`, `createsSignatures=false`, and
  `grantsCommercialRelease=false`.

## Verification

- Candidate assembler contracts: 7/7 PASS.
- Exact blind response produces a candidate accepted by the blind validator and
  verified promotion check.
- Exact manufacturing response produces a candidate accepted by the
  manufacturing validator and verified promotion check.
- Forged, missing, duplicate, transplanted, and extra-claim response entries:
  rejected with zero output.
- Packet extra claim or target mutation, request drift, and artifact byte drift:
  rejected with zero output.
- Outside-root response and outside-root output: rejected.
- Exact response-schema field sets and base64 pattern: PASS.
- Read-only CLI: exit 0; forged-signature CLI: exit 4 and zero output.
- Focused tool/test ESLint: PASS with zero warnings.
- Mechanical scope: PASS and remains `private_beta_evidence_pending`.
- Platform ownership, full source ESLint, and TypeScript: PASS.

## Honest hold

All key pairs, artifacts, packets, responses, and candidates used by the tests
were isolated temporary fixtures and are not commercial evidence. The current
external v4 evidence root remains unchanged with only three pending workbooks.
No real response or candidate exists and nothing was promoted.

Real adapter-produced artifacts, named independent role holders, externally
held Ed25519 private keys, physical manufacturing records, and inspection
measurements remain required. Staging and production were not deployed,
restarted, reconfigured, or written by this unit.
