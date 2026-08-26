# Mechanical direct-design adapter byte binding

Timestamp: `2026-08-25T09:26:44Z`

Scope: `platform`

Implementation commit:
`8347390cd851c0b035f22415f300f499fd0e1b61`

## Outcome

The commercial direct-design runner no longer treats an adapter path alone as
trusted. Both preflight and actual execution bind the adapter's exact bytes to
an independently approved SHA-256 before the module can be imported.

The approved digest is supplied by either:

- CLI: `--adapter-sha256=<approved-sha256>`; or
- environment: `NEXYFAB_MECHANICAL_DESIGN_ADAPTER_SHA256`.

Actual execution now fails before dynamic import when the adapter is absent,
not a non-symlink regular file, has no valid approved digest, or does not match
that digest. A path-preserving byte substitution therefore cannot inherit a
previous adapter approval.

## Preflight boundary

The preflight reports:

- whether an adapter path was configured;
- whether it is a safe regular file;
- the actual file SHA-256 when readable;
- whether a syntactically valid approved SHA-256 was supplied;
- whether the actual and approved digests match; and
- `loadedOrExecuted=false`.

It still never imports or executes adapter code, creates campaign state or
evidence, or grants commercial release.

New fail-closed blockers are:

- `trusted_runtime_adapter_sha256_not_supplied_or_invalid`; and
- `trusted_runtime_adapter_sha256_mismatch`.

## Current result

The external root remains:
`C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4`.

- Workbook: 30/30 valid.
- Required artifacts: 0/240 present.
- Role-separated verifier coverage: 0/3.
- Adapter: absent.
- Approved adapter digest: absent.
- Commercial decision: `HOLD`.

No placeholder adapter, approved digest, key, case artifact, signature, or
release receipt was created to reduce these blockers.

## Verification

- Direct-design runner/preflight contracts: 11/11 PASS.
- Positive case: all 240 safe files, role-separated keys, regular adapter, and
  exact approved digest are required for `readyToExecute=true`.
- Negative case: a readable adapter with a different approved digest is
  rejected while `loadedOrExecuted` remains false.
- Focused script ESLint: PASS.
- Platform ownership: PASS with no shared or foreign violations.
- Full source ESLint: PASS.
- TypeScript: PASS.

## Next action

Obtain a reviewed production-class native CAD adapter and its approval digest
from separate release authority, register three role-separated Ed25519 public
verifiers, then collect real case artifacts. Re-run preflight before importing
or executing the adapter. Start with a selected bounded case batch only after
all preflight blockers are zero.

Staging and production were not deployed, restarted, reconfigured, or written
by this unit.
