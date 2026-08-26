# Mechanical commercial signing packets

Timestamp: `2026-08-25T10:35:50Z`

Scope: `platform`

Commits:

- contracts: `0081a9923044d8b769f836d93ba0cc01d4b51223`;
- tool: `934257b06afefd8cb8be73c37aaeba767325180e`;
- tests: `867083df3c6ccf20d73b0c3cc240238678985012`.

## Outcome

The blind-review and manufacturing-inspection signing boundary is now
deterministic and byte-bound. An operator supplies an exact request and real
artifacts under an external evidence root. The tool computes the target hashes,
unsigned receipt templates, canonical signing payloads, payload SHA-256 values,
and a self-hashed packet without creating a signature or release claim.

Tool:
`workspaces/platform/tools/build-mechanical-signing-packet.mjs`.

Public contracts:

- `workspaces/platform/contracts/mechanical-blind-signing-request.schema.json`;
- `workspaces/platform/contracts/mechanical-manufacturing-signing-request.schema.json`;
- `workspaces/platform/contracts/mechanical-commercial-signing-packet.schema.json`.

All object field sets are closed with `additionalProperties=false`. Runtime
semantic checks add identity uniqueness, chronology, role separation, process
and facility diversity, in-tolerance measurements, allowed extensions, and
real-path containment that JSON Schema cannot fully express.

## Blind signing request

The request must contain exactly 20 unique challenge cases and at least five
high-risk cases. Each case binds requirements and release-package bytes, a
unique design revision, a builder, timestamps, and proposed independent
reviewers. Standard cases require at least one reviewer; high-risk cases
require at least two distinct reviewers. A reviewer cannot be the builder.

The generated case template is compatible with
`validateMechanicalBlindChallenge`. Each reviewer packet contains the exact
`nexyfab.mechanical-blind-challenge-review-signoff.v1` canonical payload and
an empty signature field in the receipt template.

## Manufacturing signing request

The request must contain exactly one CNC machining, one sheet-metal, and one
additive-manufacturing case with unique revisions. Across the three cases it
requires at least two real facilities and two inspectors. Each case binds
NFAB, STEP, drawing, BOM, manufacturing receipt, inspection report, and photo
evidence bytes. At least three unique measurements must be inside their stated
tolerances and already have an accepted disposition.

The generated case template is compatible with
`validateMechanicalManufacturingReceipt`. Each inspector packet contains the
exact `nexyfab.mechanical-manufacturing-inspection-signoff.v1` canonical
payload and an empty signature field in the receipt template.

## Operator sequence

Run the non-mutating check first:

```powershell
node workspaces/platform/tools/build-mechanical-signing-packet.mjs `
  --kind=blind `
  --request=<external-root>\blind-signing-request.json `
  --evidence-root=<external-root> `
  --check

node workspaces/platform/tools/build-mechanical-signing-packet.mjs `
  --kind=manufacturing `
  --request=<external-root>\manufacturing-signing-request.json `
  --evidence-root=<external-root> `
  --check
```

After a successful check, write a new packet path:

```powershell
node workspaces/platform/tools/build-mechanical-signing-packet.mjs `
  --kind=blind `
  --request=<external-root>\blind-signing-request.json `
  --evidence-root=<external-root> `
  --output=<external-root>\packets\blind-signing-packet.json
```

The independent role holder must verify the packet SHA-256, target, source
artifacts, identity, and exact canonical payload before signing outside the
tool. The operator then copies only the returned Ed25519 signature into the
matching unsigned receipt template. The resulting complete candidate still
must pass `promote-mechanical-commercial-receipt.mjs --check` with the trusted
public-key registry before any canonical repository path is written.

## Safety and failure behavior

- Evidence roots must be real non-symlink directories outside the repository.
- Requests must be real regular files inside the selected evidence root.
- Artifact traversal, absolute paths, duplicate paths, symlink files, and a
  directory link resolving outside the root are rejected.
- Output uses an exclusive same-directory temporary and hard-link no-replace;
  an existing output is never overwritten.
- Invalid exact requests exit 4 and produce no output. Unsafe configuration or
  paths exit 2.
- `claimBoundary` is fixed to `createsEvidence=false`,
  `createsSignatures=false`, and `grantsCommercialRelease=false`.

## Verification

- Signing-packet contracts: 8/8 PASS.
- Deterministic blind and manufacturing packets: PASS.
- Canonical target/payload parity with final validators: PASS.
- Raw artifact byte mutation changes target and packet hashes: PASS.
- Builder/reviewer collision, insufficient high-risk review, invalid time,
  out-of-tolerance measurement, duplicate process, and insufficient
  facility/inspector diversity: rejected.
- Traversal, outside-root request, and real directory-link escape: rejected.
- Read-only CLI: exit 0; malformed request: exit 4 and zero output.
- Combined signing and candidate-promotion contracts: 13/13 PASS.
- Focused ESLint: PASS with zero warnings.
- Mechanical product scope check: PASS and remains
  `private_beta_evidence_pending` with seven evidence blockers.
- Platform ownership, full source ESLint, and TypeScript: PASS.

## Honest hold and next action

The current external v4 root still contains only the three pending workbooks.
It has no direct-design artifacts, blind challenge packages, manufacturing
measurements, photos, reviewer or inspector signatures, or signed candidate
receipts. Therefore this unit generated no real signing packet and promoted no
receipt.

The next authorized action requires real adapter-produced design artifacts,
named role-separated reviewers and inspectors with registered Ed25519 public
keys, and physical manufacturing/inspection records. Those external inputs
remain a commercial release HOLD; they must not be synthesized.

Staging and production were not deployed, restarted, reconfigured, or written
by this unit.
