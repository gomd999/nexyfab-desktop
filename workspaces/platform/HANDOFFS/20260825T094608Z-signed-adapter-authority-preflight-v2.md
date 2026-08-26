# Signed adapter authority and direct-design preflight v2

Timestamp: `2026-08-25T09:46:08Z`

Scope: `platform`

Implementation commit:
`68934b7768a37f3ab1ad7bdc798cd79d824fbbac`

## Outcome

The direct-design campaign now has an executable trust path without weakening
the final evidence boundary.

Preflight schema v2 splits two decisions:

- `readyToExecute`: workbook/root safety, role-separated design verifiers,
  adapter bytes, operator pin, independent release approver, and signed adapter
  approval are valid.
- `readyForFinalVerification`: all execution prerequisites and all 240 case
  artifact files are present and safe.

This removes the v1 circular condition that treated adapter-generated outputs
as a prerequisite for first adapter execution. Missing output files are now an
evidence blocker, while unsafe existing paths remain an execution blocker.

## Independent adapter authority

Actual import requires all of the following before module code is loaded:

1. A non-symlink regular adapter file.
2. Exact match with `--adapter-sha256` or
   `NEXYFAB_MECHANICAL_DESIGN_ADAPTER_SHA256`.
3. A non-symlink regular approval receipt supplied through
   `--adapter-approval`.
4. An Ed25519 public key registered in
   `NEXYFAB_MECHANICAL_ADAPTER_APPROVER_KEYS` with role
   `mechanical-adapter-release-approver`.
5. A valid approval signature over adapter SHA-256, adapter version, release
   channel, exact workbook `evidenceRootId`, approval times, and claim boundary.

The approval window cannot exceed 30 days, must be current, and declares
`importsOnlyApprovedBytes=true` and `grantsCommercialRelease=false`.

Public schema:
`workspaces/platform/contracts/mechanical-design-adapter-approval.schema.json`.

## Fail-closed coverage

The verifier rejects:

- missing, malformed, symlinked, or non-file approval input;
- missing or non-Ed25519 release authority;
- wrong role;
- forged signature;
- future, expired, or over-30-day approval;
- approval transplanted to another campaign `evidenceRootId`;
- adapter path-preserving byte substitution;
- extra or missing signed receipt fields; and
- any approval that claims it grants commercial release.

A CLI contract proves an invalid approval exits before dynamic import and
before campaign state creation.

## Current exact external result

Root:
`C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4`.

- Workbook: 30/30 valid.
- `readyToExecute=false`.
- Execution blockers:
  - `role_separated_trusted_verifiers_missing`
  - `trusted_runtime_adapter_not_supplied`
  - `trusted_runtime_adapter_sha256_not_supplied_or_invalid`
  - `trusted_runtime_adapter_release_approver_missing`
  - `trusted_runtime_adapter_approval_not_supplied`
- `readyForFinalVerification=false`.
- Evidence blocker:
  - `required_artifacts_missing` (0/240 present)
- Preflight exit: intentional `4`.

No adapter, operator pin, approver key, approval, artifact, signature, state, or
release receipt was fabricated.

## Verification

- Direct-design runner/preflight Node contracts: 15/15 PASS.
- Focused runner/test ESLint: PASS.
- Platform workspace ownership: PASS with no shared, foreign, or unclassified
  paths.
- Full source ESLint: PASS.
- TypeScript: PASS.

## Next action

Release authority must review the real native CAD adapter, publish its public
Ed25519 identity, and sign a campaign-bound approval. Separately register the
STEP, drawing, and BOM public verifiers. Once the five execution blockers are
zero, run a bounded selected case batch; only then evaluate the generated files
and advance the separate 240-file evidence condition.

Staging and production were not deployed, restarted, reconfigured, or written
by this unit.
