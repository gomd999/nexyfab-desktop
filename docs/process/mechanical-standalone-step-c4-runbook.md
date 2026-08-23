# Standalone STEP AP242 C4 verification

This gate does not require SolidWorks, Fusion, Onshape, or another vendor CAD connection. It does require the same immutable AP242 assembly to be processed by two distinct implementation families:

1. NexyFab's authoring/roundtrip path.
2. A separately implemented STEP parser/writer that is not OpenCascade, OCCT, or replicad.

An OCCT export followed by `occt-import-js` is useful regression coverage, but it is the same kernel family and therefore cannot satisfy the independent-parser target.

## Input workbook

Place the workbook and every referenced artifact under one dedicated evidence root. Paths must be relative, cannot escape that root, and are bound by SHA-256.

```json
{
  "schema": "nexyfab.mechanical-standalone-step-c4-workbook.v1",
  "releaseChannel": "mechanical-core",
  "designRevisionSha256": "<64 lowercase hex>",
  "source": {
    "path": "artifacts/source-assembly.step",
    "sha256": "<64 lowercase hex>"
  }
}
```

The adapter module must export `executeIndependentStepParser(input)`. It must write its opened representation, returned STEP, and JSON report inside the evidence root and return byte bindings for those files. The report must contain exactly one passing result for all C0-C4 checks used by `src/lib/ai/mechanicalStepInteroperability.ts`. It must also report source/returned body count, unit, six-value bounding box, volume, surface area, occurrence count, component names, part numbers, and attributes. The runner independently compares those measurements and rejects a self-reported PASS when the measured values exceed its fixed tolerances.

## Execute

```powershell
npm run mechanical:step:c4 -- --workbook=C:\evidence\step-c4\workbook.json --adapter=C:\tools\independent-step-adapter.mjs --output=C:\evidence\step-c4\candidate.json
```

The output is deliberately an unsigned candidate with:

- `eligibleForSignedReceipt: true`
- `commerciallyVerified: false`
- `nextAction: sign_and_bind_with_nexyfab_receipt`

It does not open the commercial gate. A trusted operator must sign the candidate, bind it to the NexyFab receipt for the exact same design revision and source artifact, then place the bundle at the configured external evidence path. Missing adapters, identities, bytes, checks, hashes, signatures, or revision consistency remain `NOT_RUN`/`BLOCKED`; they are never auto-promoted.

## Current state

The repository contains the fail-closed runner and tests. No separately implemented parser adapter or signed production evidence is currently configured, so the independent-parser commercial receipt remains `NOT_RUN`.
