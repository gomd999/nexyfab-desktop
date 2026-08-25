# Exact blind challenge and manufacturing receipt gates

Timestamp: `2026-08-25T10:01:04Z`

Scope: `platform`

Implementation commit:
`2d5acdee34374ace78628b681947747bebad18f1`

## Outcome

The blind challenge and manufacturing pilot release validators now enforce the
same exact-field boundary published by their JSON schemas. A valid signed core
can no longer be accompanied by ignored release claims or malformed extra
reviews and still satisfy the mechanical product scope gate.

## Blind challenge hardening

The validator now requires exact keys for:

- the receipt and summary;
- every challenge case;
- the two artifact bindings; and
- every review signoff.

Every review entry must be valid; the validator no longer counts a minimum
valid subset while ignoring additional forged or malformed reviews. Review IDs
must be unique, high-risk cases still require at least two reviewers, builder
and reviewer remain distinct, and every accepted key must be Ed25519 with a
64-byte signature and `mechanical-blind-reviewer` role.

The summary high-risk count must exactly match the cases. Receipt generation
must occur after case completion and every included review.

## Manufacturing pilot hardening

The validator now requires exact keys for:

- the receipt and summary;
- every pilot case;
- all seven artifact bindings;
- manufacturer metadata;
- every measurement; and
- inspector signoff.

Extra certificate, calibration-assumption, release-authority, or commercial
release claims fail closed. Inspector keys must be Ed25519 and signatures must
decode to 64 bytes. Receipt generation must occur after both manufacture and
inspection. Existing requirements remain: three distinct process/revision
cases, at least two facilities and inspectors, byte-bound artifacts, at least
three unique in-tolerance measurements per case, and a target-bound signature.

## Negative coverage

Contracts explicitly reject:

- receipt-level `commercialRelease=true`;
- case-level release approval claims;
- an invalid extra blind review beside otherwise sufficient valid reviews;
- impossible blind high-risk summary counts;
- receipts generated before review or inspection;
- extra manufacturing artifact roles;
- unbound measurement/calibration fields;
- extra inspector release-authority claims;
- artifact byte drift; and
- measurement values outside tolerance.

## Verification

- Blind/manufacturing/product-scope Node contracts: 12/12 PASS.
- Focused validator/test ESLint: PASS.
- Mechanical product scope check: PASS with status
  `private_beta_evidence_pending`.
- Platform ownership: PASS with no shared, foreign, or unclassified paths.
- Full source ESLint: PASS.
- TypeScript: PASS.

## Claim boundary

This unit hardens acceptance of future real evidence. It does not create blind
review signoffs, inspector keys, manufacturing files, measurements, or pilot
receipts. The current 20 blind challenges and three physical pilots remain
`NOT_RUN/HOLD` until external human and facility evidence exists.

Staging and production were not deployed, restarted, reconfigured, or written
by this unit.
