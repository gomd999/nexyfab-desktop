# OpenSCAD AI Calibration — 2026-08-06

## Verified results

- OpenSCAD Nightly 2025.09.07 CLI was exercised through the real DeepSeek → SCAD agent → OpenSCAD path.
- `sc1_cube` passed 1/1. This proves the primitive smoke path only.
- The first `sc6_motor_mount_assy` run falsely ended `done` with zero SCAD bytes and no successful render. Evidence: `validation-reports/scad-agent-2026-08-06T07-02-59.json`.
- A fail-closed completion option now prevents generation/certification runs from completing until non-empty SCAD renders successfully. Interactive narration-only chat remains compatible because the option is opt-in.
- The next run correctly stopped at `awaiting_user`; the benchmark prompt lacked the dimensions needed for autonomous generation. Evidence: `validation-reports/scad-agent-2026-08-06T07-06-39.json`.
- After pinning NEMA17 reference dimensions and an explicit default-assumption policy, the real run passed in 4 turns and 8 tool calls with a 601-byte modular SCAD artifact and successful OpenSCAD render. Evidence: `validation-reports/scad-agent-2026-08-06T07-07-40.json`.
- The complex scenario now requires at least four distinct structural markers instead of passing on a single keyword.

## Interpretation

This is a smoke/capability result, not evidence of 95% manufacturing CAD accuracy. It does not yet certify native multi-part occurrences, mates, tolerances, collision clearance, or manufacturing semantics.

## Next calibration sequence

1. Run the remaining assembly scenarios through the real provider and renderer.
2. Replace keyword checks with dimensional, part-count, occurrence, and transform assertions.
3. Route failure classes into the deterministic repair registry.
4. Repeat each approved holdout and report accuracy and coverage separately.

## Assembly calibration increment

- Initial real sweep of `sc7`–`sc10`: 0/4. Failures were separated into malformed nested includes, missing dimensions, diagonal-array misuse, and token exhaustion.
- `compose_assembly` now normalizes include syntax, adds the required `BOSL2/std.scad` prerequisite for `gears.scad`, supports explicit 2D/3D grids, and rejects ambiguous multi-axis linear arrays unless explicitly opted in.
- Validation prompts now pin pipe lengths/orientation, toy-car wheel coordinates, and bracket-grid coordinates.
- Validation scoring now supports auditable regex assertions for gear tooth counts and center distance, pipe section count and diameters, wheel occurrence coordinates, and grid occurrence count/extent.
- Certification runs stop after the first successful render, avoiding post-render token burn. Failed render diagnostics now retain fallback error messages.
- BOSL2 was installed in the local OpenSCAD user library and the validation CLI auto-detects that path when `OPENSCADPATH` is unset.
- Direct two-gear OpenSCAD render produced a 1,357,279-byte STL. The final real `sc7_gear_train` AI run passed in 4 turns and 5 tool calls: `validation-reports/scad-agent-2026-08-06T08-41-46.json`.
- In the latest individual reruns, `sc7` and `sc9` passed; the immediately preceding full sweep had `sc8` and `sc10` passing. This is not yet a single-run 4/4 repeatability result, so the next gate is three consecutive complete sweeps with the strengthened assertions.
- After adding deterministic render-on-handoff for prepared certification artifacts, the strengthened full assembly sweep passed 4/4 in one run (18.9 seconds): `validation-reports/scad-agent-2026-08-06T08-45-55.json`. This is the first complete sweep, not yet the required three consecutive sweeps.
- A later repeat exposed two additional false-certification paths: rendering the automatic module preview after composition failure, and assertion coupling to exact module names. Both were fixed; stalled no-artifact recovery now compacts history, multi-module certification requires a real composition, assertions use structural patterns, and reports persist full SCAD source.
- Final strengthened repeatability gate passed three consecutive complete sweeps, 12/12 scenarios total:
  - run 1: 4/4 in 25.7s — `validation-reports/scad-agent-2026-08-06T09-09-56.json`
  - run 2: 4/4 in 22.1s — `validation-reports/scad-agent-2026-08-06T09-10-21.json`
  - run 3: 4/4 in 24.1s — `validation-reports/scad-agent-2026-08-06T09-10-47.json`
- This closes the OpenSCAD assembly smoke/capability repeatability gate for these four calibrated scenarios. It does not close the 120-case native manufacturing CAD holdout or establish general 95% accuracy across product families.

## SCAD definition/occurrence bridge

- Added a fail-closed bridge from persisted SCAD module/composition source to `nexyfab.complex-product-architecture.v1` and assembly-solver transform evidence.
- Reused module names become reusable part definitions; each static callsite becomes an independent occurrence with a per-definition quantity index and a row-major 4×4 rigid transform.
- Missing composition, unknown modules, procedural/unparsed placements, non-finite transforms, and fewer than two physical occurrences fail explicitly.
- A single reusable definition with many occurrences is accepted; the 16-bracket grid is therefore represented as one bracket definition and 16 occurrences rather than 16 duplicated definitions.
- The three consecutive validation reports were converted into persistent bridge evidence. All 12/12 scenario conversions passed:
  - run 1: 13 definitions, 31 occurrences/transforms — `docs/evidence/scad-assembly-bridge-260806/run-1.json`
  - run 2: 13 definitions, 32 occurrences/transforms — `docs/evidence/scad-assembly-bridge-260806/run-2.json`
  - run 3: 13 definitions, 32 occurrences/transforms — `docs/evidence/scad-assembly-bridge-260806/run-3.json`
- This bridge certifies structural identity and static placement only. Per-definition independent mesh/B-rep topology, native STEP occurrence round-trip, mate/joint semantics, motion, collision, and clearance remain separate fail-closed gates.

## Per-definition local STL evidence

- Each module is now rendered independently in definition-local coordinates. The whole-assembly STL is never reused as part evidence.
- Each successful definition records SHA-256, byte length, triangle count, watertight topology, volume, and local bounding box. Occurrences reference the definition hash while retaining their independent 4×4 placement transform.
- The real third consecutive validation run produced `docs/evidence/scad-definition-geometry-260806/run-3.json`:
  - assemblies: 4/4 pass
  - definitions: 9/9 independently rendered and watertight
  - occurrences with definition hash + transform: 28
  - total definition-local STL bytes: 1,624,982
  - unique geometry hashes: 8; the two semantically distinct main-pipe definitions share identical geometry and were deliberately not auto-merged
- The evidence bundle remains `releaseReady:false`. STL proves local mesh topology but does not provide native B-rep, editable feature history, authoritative PMI/tolerances, native STEP occurrence round-trip, or mate/joint semantics.
