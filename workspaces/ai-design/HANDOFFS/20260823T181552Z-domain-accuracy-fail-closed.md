# AI Design handoff: fail-closed domain accuracy

- Branch: `scope/ai-design`
- Head: `4b38f98c47dff86dd9cc866e4f4f981d5a1389e2`
- Integration target: `integration/nexyfab`
- Created: `2026-08-23T18:15:52.279Z`

## Summary

Domain-accuracy evaluation now rejects malformed runtime evidence and invalid policy values instead of allowing incomplete scalar data to pass. The slice HTTP boundary returns stable client errors for invalid media types, malformed or oversized JSON, and contract validation failures. Slice types no longer depend on the legacy implementation. Deterministic SCAD model-output parsing was extracted from the route into a focused, tested AI-owned module.

## Changed paths

- `capabilities/ai-design/domain-accuracy/index.ts`
- `capabilities/ai-design/domain-accuracy/src/contract.mjs`
- `capabilities/ai-design/domain-accuracy/src/server.mjs`
- `capabilities/ai-design/domain-accuracy/test/server.test.mjs`
- `src/app/api/nexyfab/scad-intent-from-nl/intentParsing.test.ts`
- `src/app/api/nexyfab/scad-intent-from-nl/intentParsing.ts`
- `src/app/api/nexyfab/scad-intent-from-nl/route.ts`
- `src/lib/ai/domainAccuracyProgram.test.ts`
- `src/lib/ai/domainAccuracyProgram.ts`
- `src/lib/ai/domainAccuracySliceParity.test.ts`
- `workspaces/ai-design/CURRENT.md`
- `workspaces/ai-design/HANDOFFS/20260823T181552Z-domain-accuracy-fail-closed.md`

## Verification

- [x] `npm run typecheck`
- [x] `npm run test:accuracy:common` — 11 Vitest files / 62 tests and 7 Node tests passed.
- [x] `npm run test:slices` — 27 tests passed.
- [x] Targeted Vitest regression suite — 3 files / 20 tests passed.
- [x] Changed-file ESLint check passed.
- [x] `npm run build` — production build and 292-page generation passed; shared bundle 723.5 KB and worst first paint 1764 KB remained within configured budgets.

## Remaining work and risks

- Rebuild the AI domain-accuracy deployment image from the integrated commit and recapture source-fingerprint evidence; current deployment evidence predates these changes.
- Execute and capture rollback validation again. The existing staging digest mismatch must be resolved by integration or platform ownership.
- Regenerate route-security and secret-scan evidence after integration so generated artifacts match the final source tree.
- Keep live model execution disabled and preserve the Analysis `MODEL_NOT_RUN` state while binding this deterministic contract.
- Shared follow-ups remain integration/platform-owned: restore a bounded full Vitest lane with coverage thresholds, align the supported Node and Next lint toolchain versions, make production Redis configuration fail closed while deduplicating warnings, and clean the root README, environment template, and tracked audit artifacts.
- Precision CAD owns decomposition of the oversized `ShapeGeneratorInner` module; no CAD-kernel or exact-geometry code was changed here.

- Validation is fail closed, so previously accepted incomplete callers will now receive explicit contract errors and must submit complete scalar evidence.
- Deployment, rollback, route-security, and secret-scan evidence remain stale until the integration-owned rebuild and recapture steps are completed.
- The full repository Vitest suite is still disabled upstream because of the previously observed hang; this handoff verifies all AI accuracy suites, slice tests, type checking, linting, and the production build instead.
