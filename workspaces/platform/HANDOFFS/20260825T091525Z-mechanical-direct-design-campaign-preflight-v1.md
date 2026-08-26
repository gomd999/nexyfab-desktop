# Mechanical direct-design campaign preflight v1

Timestamp: `2026-08-25T09:15:25Z`

Scope: `platform`

Implementation commit:
`0564bc7a5f681dc40ff1699ac6e9c66a5d1934ba`

## Outcome

The current commercial mechanical campaign has a schema-current, pending-only
external work area and a non-mutating preflight. It is ready for real evidence
collection but is not ready to execute and is not commercial evidence.

Current external root:
`C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4`

- Direct-design workbook: 30 cases and eight required artifact paths per case.
- Blind-challenge workbook: 20 pending cases.
- Manufacturing-pilot workbook: three pending cases covering CNC, sheet metal,
  and additive manufacturing.
- Physical contents: exactly the three workbook JSON files. No case artifact,
  state, receipt, signature, measurement, inspection, or release claim exists.

The preserved `nexyfab-commercial-evidence-260812` root remains historical. Its
direct-design workbook is rejected by the current runner at
`design-01-hole` because it predates the required revision-bound
`verificationReceipt` path. It was not modified or deleted.

## Preflight contract

Run:

```powershell
node scripts/run-mechanical-direct-design-campaign.mjs --preflight `
  --workbook=C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4\direct-design\mechanical-direct-design-workbook.json `
  --adapter=<trusted-runtime-adapter.mjs>
```

Machine schema:
`nexyfab.mechanical-direct-design-campaign-preflight.v1`.

The preflight checks:

1. The exact current 30-case workbook contract.
2. Eight safe regular artifact files under the evidence root for every case,
   for 240 required files in total.
3. Valid Ed25519 public keys with a distinct assignment for
   `mechanical-step-verifier`, `mechanical-drawing-verifier`, and
   `mechanical-bom-verifier`.
4. An explicitly supplied, non-symlink regular adapter file.

It does not import or execute the adapter, create or mutate campaign state,
create evidence, or grant release authority. A non-ready result is emitted as
JSON and exits fail-closed.

## Exact current result

- Workbook: 30/30 valid.
- Required artifact files: 0/240 present, 240 missing, 0 invalid.
- Trusted Ed25519 verifier keys: 0 configured; required role coverage 0/3.
- Trusted runtime adapter: not supplied.
- `readyToExecute`: `false`.
- Blockers:
  - `required_artifacts_missing`
  - `role_separated_trusted_verifiers_missing`
  - `trusted_runtime_adapter_not_supplied`

This is an expected commercial HOLD, not a deployment or application-runtime
failure.

## Verification

- Direct-design runner/preflight Node contracts: 10/10 PASS.
- Focused ESLint for the runner and tests: PASS.
- Platform workspace ownership: PASS with no shared or foreign violations.
- Full source ESLint: PASS.
- TypeScript: PASS.
- Positive preflight contract: all 240 regular files plus three distinct role
  assignments and a regular adapter produce `readyToExecute=true`, while the
  adapter remains unloaded and unexecuted.
- Negative preflight contract: the stale workbook and pending-only current
  root remain fail-closed.

## Required next inputs

1. A reviewed production-class module exporting
   `executeMechanicalDesignCase`, bound to the real NexyFab native CAD runtime.
2. Three separately controlled Ed25519 verifier identities. Only public keys
   and roles belong in `NEXYFAB_MECHANICAL_DESIGN_VERIFIER_KEYS`; private keys
   remain outside the repository and campaign host.
3. For each case, real requirements, NFAB, STEP, drawing, BOM, intent
   evaluation, manifest, and signed revision-bound verification receipt bytes.
4. Human Precision CAD edits and drawing release; these cannot be replaced by
   fixtures or synthetic output.
5. After preflight is ready, execute a small selected batch, inspect the
   checkpoint and receipt, then resume toward 10/30 candidate and 30/30
   commercial design evidence.
6. Complete the separate 20 blind reviews and three physical manufacturing
   pilots before any manufacturing or GA claim.

Production and staging were not deployed, restarted, reconfigured, or written
by this unit.
