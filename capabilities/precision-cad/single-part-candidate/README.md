# Single-part candidate slice

This is the first Precision CAD extraction boundary. It validates a reviewed
mechanical source receipt before any expensive STEP/OCCT inspection.

- Current runtime: compatibility adapter over `src/lib/cad/mechanicalSinglePartCandidate.ts`
- Current executor: `scripts/build-mechanical-single-part-candidates.ts`
- Next extraction: move `MechanicalSinglePartExactInspector` behind an isolated worker
- Release state: NOT_READY; manufacturing release, PMI/GDT, and human approval remain blocked

The adapter is intentionally small and stable. Existing scripts and tests remain
valid while the OCCT dependency is moved out of the Next runtime.
