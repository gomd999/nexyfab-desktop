# Verified mechanical commercial receipt promotion

Timestamp: `2026-08-25T10:15:49Z`

Scope: `platform`

Implementation commit:
`b67d5347280e788b35a11b81ba75098054287f9d`

## Outcome

Blind challenge and manufacturing pilot receipts no longer need to be copied or
edited manually into canonical gate paths. A Platform-owned tool revalidates
the complete external candidate and only then performs a no-replace promotion.

Tool:
`workspaces/platform/tools/promote-mechanical-commercial-receipt.mjs`.

## Read-only validation

Use `--check` with `--kind=blind|manufacturing`, `--candidate`, and
`--evidence-root` before any repository write.

The tool requires:

- an evidence root outside the repository;
- a non-symlink real directory;
- a candidate regular file inside that root;
- the existing exact receipt schema and summary/case boundaries;
- all referenced artifact bytes under the same external root;
- `NEXYFAB_BLIND_REVIEWER_KEYS` for blind receipts; or
- `NEXYFAB_MANUFACTURING_REVIEWER_KEYS` for manufacturing receipts.

The same validators consumed by mechanical product scope are used, including
Ed25519 signatures, target hashes, timestamps, role separation, measurements,
process/facility diversity, and exact artifact bindings.

## Promotion semantics

When `--output` is supplied and validation passes, the parsed receipt is
rendered as canonical pretty JSON with a trailing newline. Promotion writes a
same-directory exclusive temporary file, creates the final path using a hard
link, and removes the temporary name. An existing output is never replaced.

The machine result binds candidate bytes/SHA-256 and promoted output SHA-256.
Its claim boundary is explicit:

- `createsEvidence=false`;
- `createsSignatures=false`;
- `grantsCommercialRelease=false`.

Invalid candidates return exit 4 and
`blockers=["candidate_receipt_invalid"]`; no output is created. Unsafe root,
outside-root candidate, symlink, invalid kind, unsafe output parent, or existing
output fail before promotion.

## Verification

- Promotion contracts: 5/5 PASS.
- Exact signed blind receipt: promoted without changing source evidence.
- Exact signed manufacturing receipt: read-only check and promotion PASS.
- Receipt with an extra commercial claim: rejected, zero output.
- Artifact byte drift: rejected, zero output.
- Outside-root and symlink candidates: rejected.
- Existing output: rejected without replacement.
- CLI check: exit 0; invalid CLI promotion: exit 4 and zero output.
- Focused tool/test ESLint: PASS with zero warnings.
- Mechanical product scope check: PASS and remains
  `private_beta_evidence_pending`.
- Platform ownership, full source ESLint, and TypeScript: PASS.

## Claim boundary and next action

No real candidate, signature, measurement, or manufacturing evidence exists in
the current external root, so no canonical gate receipt was promoted. The next
local unit is deterministic reviewer/inspector signing-target packet generation;
the signatures themselves remain external authority.

Staging and production were not deployed, restarted, reconfigured, or written
by this unit.
