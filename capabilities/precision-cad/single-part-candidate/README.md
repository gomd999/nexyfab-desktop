# Single-part candidate slice

This is the first Precision CAD extraction boundary. It validates a reviewed
mechanical source receipt before any expensive STEP/OCCT inspection.

- Current runtime: isolated contract service with parity coverage against `src/lib/cad/mechanicalSinglePartCandidate.ts`
- Current executor: `scripts/build-mechanical-single-part-candidates.ts`
- Next extraction: move `MechanicalSinglePartExactInspector` behind an isolated worker
- Release state: NOT_READY; manufacturing release, PMI/GDT, and human approval remain blocked

The slice folder is now a complete Docker build context. It exposes `/health/*`
and `POST /contract/source-runs`, but it does not claim that the OCCT executor is
independent yet. Existing scripts and tests remain valid while that dependency
is moved out of the Next runtime.
