# Precision CAD handoff: isolated-single-part-contract

- Created: 2026-08-23T14:45:13.607Z
- Branch: `scope/precision-cad`
- Head: `851a7ac8ab7769f043f23a9b420e3cd0f1381d00`
- Integration target: `integration/nexyfab`

## Summary

Added a folder-local Docker build context for the single-part candidate source
contract. The service runs the seven-axis fail-closed eligibility check and
publishes live, ready, and release health contracts.

## Changed paths

- `capabilities/precision-cad/single-part-candidate/.dockerignore`
- `capabilities/precision-cad/single-part-candidate/Dockerfile`
- `capabilities/precision-cad/single-part-candidate/README.md`
- `capabilities/precision-cad/single-part-candidate/index.ts`
- `capabilities/precision-cad/single-part-candidate/package.json`
- `capabilities/precision-cad/single-part-candidate/service.json`
- `capabilities/precision-cad/single-part-candidate/src/contract.d.mts`
- `capabilities/precision-cad/single-part-candidate/src/contract.mjs`
- `capabilities/precision-cad/single-part-candidate/src/health.mjs`
- `capabilities/precision-cad/single-part-candidate/src/server.mjs`
- `capabilities/precision-cad/single-part-candidate/test/server.test.mjs`
- `src/lib/cad/singlePartCandidateSliceParity.test.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260823T144513Z-isolated-single-part-contract.md`

## Verification

- [x] isolated server tests (3 passed)
- [x] legacy parity tests (2 passed)
- [x] `npm run workspace:check -- precision-cad`
- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [ ] `npm run mechanical:contracts:check` (expected evidence HOLD; feature/interoperability receipts are missing or stale)
- [ ] `npm run mechanical:scope:check` (expected evidence HOLD; private-beta evidence remains pending)

## Remaining work and risks

- Exact CAD, Job Control, and kernel identity bindings are required for readiness.
- The OCCT inspector remains in the legacy runtime and must be extracted next.
- Manufacturing release, PMI/GDT, and human approval remain blocked.
