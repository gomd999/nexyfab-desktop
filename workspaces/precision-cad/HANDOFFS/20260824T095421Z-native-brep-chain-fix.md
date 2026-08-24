# Precision CAD handoff: native-brep-chain-fix

- Created: 2026-08-24T09:54:21.743Z
- Branch: `scope/precision-cad`
- Head: `f457a3ddb6871d5d66c77363220939e5579c39d7`
- Integration target: `integration/nexyfab`

## Summary

- Extends the native OCCT sketch-extrude chain to centred global XZ and YZ planes, including exact circle tools, so a non-XY add/cut no longer discards the upstream B-rep handle.
- Restricts whole-body OCCT Draft face selection to planar side walls perpendicular to the Y pull direction. Cylindrical bores and other analytic faces remain unchanged instead of crashing `BRepOffsetAPI_DraftAngle`.
- Closes the three blocking reference-part findings reproduced on the pre-Precision baseline: the P2 post-fillet YZ cut handle loss, the P4 native Draft crash, and the downstream P4 Boss/Delete Face chain break.

## Changed paths

- `src/app/[lang]/shape-generator/features/occtEngine.ts`
- `src/app/[lang]/shape-generator/features/pipelineManager.ts`

## Verification

- [x] P2 L-bracket and P4 gearbox reference parts: 2 files, 10 tests passed; no critical/major finding emitted.
- [x] Related OCCT extrude, Draft, and phase-3 soak suites: 3 files, 67 tests passed.
- [x] `npm run typecheck`.
- [x] `npm run platform:architecture:check`.
- [x] `npm run workspace:check -- precision-cad`: 2 changed paths; zero shared, foreign, or unclassified-path violations; TypeScript and platform architecture PASS.
- [x] `git diff --cached --check` before the implementation commit.

## Remaining work and risks

- Merge `scope/precision-cad` once into `integration/nexyfab` with `--no-ff`, then rerun the P2/P4 reference tests at the merged head.
- Revert `f457a3ddb6871d5d66c77363220939e5579c39d7` to restore the previous mesh-fallback behavior if an integration-only regression is found.
- This is a geometry-correctness fix only. It does not change `authoritativeCommit: false`, `commercialReleaseReady: false`, or any external-evidence and deployment hold.
