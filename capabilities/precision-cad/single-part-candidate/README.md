# Single-part candidate slice

This is the first Precision CAD extraction boundary. It validates a reviewed
mechanical source receipt before any expensive STEP/OCCT inspection.

- Current runtime: isolated contract service; `src/lib/cad/mechanicalSinglePartCandidate.ts` is an identity-preserving legacy adapter to this capability-owned contract
- Current executor: `scripts/build-mechanical-single-part-candidates.ts`
- Next extraction: move `MechanicalSinglePartExactInspector` behind an isolated worker
- Release state: NOT_READY; manufacturing release, PMI/GDT, and human approval remain blocked

The slice folder is now a complete Docker build context. It exposes `/health/*`
and `POST /contract/source-runs`. Readiness validates the actual `occt-exact`
and `job-orchestrator` health contracts and sends a side-effect-free invalid-job
canary to prove both dependency tokens are accepted. Build identity must be a
Git SHA or `sha256:` digest and the kernel identity must be a SHA-256 value.

The service still does not claim that the legacy OCCT candidate inspector is
independent. Existing scripts remain valid while the inspector is moved behind
the Exact CAD job contract. Manufacturing release stays fail-closed.
