# SCAD interface and joint evidence — 2026-08-06

## Implemented

- Requirement-linked fixed, revolute, and contact interface nodes with measured residuals.
- Exact module/tooth/center-distance gear mesh check. Missing shaft-support joints remain `not_run`.
- T-pipe endpoint coincidence from local cylinder length and occurrence transforms. Native flow openness remains `not_run`.
- Toy-car wheel cylinder-axis extraction from the canonical feature tree and comparison with the requested Y axis.
- Duplicate occurrence detection for identical window transforms.
- Explicit joint-free policy for the static bracket grid.
- Product assembly certificate cross-check using the same part certificates and occurrence transforms.

Actual baseline: `docs/evidence/scad-interface-evidence-260806/run-2.json`

| Scenario | Interface status | Product assembly gate | Finding |
|---|---:|---:|---|
| sc7 gear train | not_run | pass | Mesh residual passes; shaft/support revolute joints are absent. |
| sc8 T pipe | not_run | pass | Three endpoints coincide; native Boolean flow-path openness is not yet proven. |
| sc9 toy car | fail | fail | Wheel cylinder axis is X instead of required Y; duplicate window occurrence exists. |
| sc10 bracket grid | pass | pass | Static array correctly declares no joints. |

## Next execution order

1. Deterministically repair the car wheel definition to a Y-axis cylinder and remove the duplicate window occurrence, then regenerate B-rep and AP242 evidence.
2. Add explicit shaft/support definitions and revolute joints to the gear train while preserving the measured gear contact relation.
3. Add native void/solid Boolean connectivity evidence for the T flow path and reject blocked or wall-capped junctions.
4. Bind interface datums to stable native face/axis references rather than descriptive strings.
5. Run precise collision, clearance, and motion certificates only after steps 1–4 pass.

## Repair and native re-verification result

Completed after the initial baseline:

- Added a fail-closed deterministic repair registry with explicit mutation boundaries.
- Corrected the toy-car wheel cylinder from X-axis to the requested Y-axis and removed one duplicate window occurrence.
- Added independent `gear_base`, `shaft20`, and `shaft30` definitions. The assembly now contains fixed base/shaft and revolute shaft/gear interfaces in addition to measured gear contact.
- Detected that the original T pipe was actually blocked: native Boolean subtraction produced two flow components.
- Rejected the first repair because face/tangent-only contact produced three components.
- Applied a second fitting repair with finite overlap area while preserving the -50 mm to +50 mm main-pipe envelope.
- Native Boolean flow verification now measures one connected component and zero blocked junctions.

Latest evidence:

- Deterministically repaired source: `validation-reports/scad-agent-2026-08-06T09-10-47-repaired-3.json`
- Canonical definitions: `docs/evidence/scad-canonical-features-260806/run-6.json`
- Native B-rep: `docs/evidence/scad-analytic-brep-260806/run-11.json`
- Native AP242 assembly: `docs/evidence/scad-native-step-assembly-260806/run-4.json`
- Native flow Boolean: `docs/evidence/scad-native-flow-260806/run-3.json`
- Final interface campaign: `docs/evidence/scad-interface-evidence-260806/run-5.json`

Final structural/interface result: 4 scenarios pass, 0 fail, 0 not_run; 12 definitions and 30 occurrences survive native AP242 export/re-import.

Remaining release caveats:

- The host OpenSCAD executable is currently unavailable on `PATH`; therefore the repaired definitions' STL cross-check is recorded as missing even though all 12 analytic B-reps, native topology checks, part certificates, and STEP roundtrips pass.
- Material and process assignments remain unresolved by policy, so manufacturing release readiness is still false.
