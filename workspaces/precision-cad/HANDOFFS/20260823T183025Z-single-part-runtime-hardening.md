# Precision CAD handoff: single-part-runtime-hardening

- Created: 2026-08-23T18:30:25.150Z
- Branch: `scope/precision-cad`
- Head: `4b38f98c47dff86dd9cc866e4f4f981d5a1389e2`
- Integration target: `integration/nexyfab`

## Summary

Hardened the isolated single-part candidate without promoting it to release.
Readiness now validates the shipping `occt-exact` and `job-orchestrator`
contracts and proves both dependency tokens using side-effect-free invalid-job
canaries. The capability contract is the single runtime implementation and the
legacy CAD path is an identity-preserving adapter.

The source-run HTTP boundary now rejects invalid content type, malformed JSON,
oversized bodies, and invalid contracts with explicit statuses. Placeholder
build IDs and non-SHA kernel identities cannot pass readiness. Reference-part
`critical`/`major` findings now fail their tests by default, and a bounded
Precision verification runner prevents another unbounded whole-suite run.

As the first safe Shape Generator split, configuration state/effects/CRUD moved
to `useConfigurationsRuntime`; route parsing and mesh-to-STL serialization are
also isolated and directly tested. The 50-entry `next/dynamic` UI registry now
lives behind a dedicated `_shell` Client boundary instead of the 13k-line host.

## Changed paths

- `capabilities/precision-cad/single-part-candidate/Dockerfile`
- `capabilities/precision-cad/single-part-candidate/README.md`
- `capabilities/precision-cad/single-part-candidate/index.ts`
- `capabilities/precision-cad/single-part-candidate/service.json`
- `capabilities/precision-cad/single-part-candidate/src/health.mjs`
- `capabilities/precision-cad/single-part-candidate/src/server.mjs`
- `capabilities/precision-cad/single-part-candidate/test/server.test.mjs`
- `containers/occt-exact/src/singlePartReadiness.integration.test.ts`
- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx`
- `src/app/[lang]/shape-generator/__tests__/referenceParts/refPartsFindingGate.test.ts`
- `src/app/[lang]/shape-generator/__tests__/referenceParts/refPartsHarness.ts`
- `src/app/[lang]/shape-generator/_shell/shapeGeneratorRouteSegment.test.ts`
- `src/app/[lang]/shape-generator/_shell/shapeGeneratorRouteSegment.ts`
- `src/app/[lang]/shape-generator/_shell/lazyShapeGeneratorComponents.tsx`
- `src/app/[lang]/shape-generator/hooks/useConfigurationsRuntime.test.ts`
- `src/app/[lang]/shape-generator/hooks/useConfigurationsRuntime.ts`
- `src/app/[lang]/shape-generator/io/geometryToStlBase64.test.ts`
- `src/app/[lang]/shape-generator/io/geometryToStlBase64.ts`
- `src/lib/cad/mechanicalSinglePartCandidate.ts`
- `src/lib/cad/singlePartCandidateSliceParity.test.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/DECISIONS.md`
- `workspaces/precision-cad/INTEGRATION_ACTIONS.md`
- `workspaces/precision-cad/VERIFY.md`
- `workspaces/precision-cad/verify.mjs`

## Verification

- [x] `npm run workspace:check -- precision-cad`
- [x] `npm run typecheck`
- [x] `npm run platform:architecture:check`
- [x] `npm run lint:ci`
- [x] `npm run build` (292 static pages; bundle budget PASS)
- [x] isolated single-part server tests (8 passed)
- [x] `node workspaces/precision-cad/verify.mjs` (8 isolated + 18 focused tests passed)
- [x] Configuration hook/table/store regression (92 passed)
- [x] route/configuration/STL/reference finding focused regression (11 passed)
- [x] TypeScript no-emit verification with incremental cache disabled (8 GB heap)
- [x] P4 blocking-gate audit (2 product `major` findings correctly failed)
- [ ] `npm run mechanical:single-part-candidates:check` (`SINGLE_PART_OUTPUT_STALE`)
- [ ] `npm run mechanical:contracts:check` (0/30 feature receipts and C4 STEP targets missing/stale)
- [ ] `npm run mechanical:scope:check` (external private-beta evidence pending)

## Remaining work and risks

- Integration-owned P0 credential rotation/removal, full tracked-file secret
  scan, security-evidence exit-code repair, CI path filters, toolchain pinning,
  and root onboarding changes are enumerated in `INTEGRATION_ACTIONS.md`.
- `public/send-mail.php` still contains the legacy credential in the integration
  tree. It was not edited from this Scope branch; the credential must be revoked
  externally before the code deletion can be considered complete.
- P4 gearbox draft still falls back to a mesh shear approximation and Delete
  Face still fails after that downgrade. Both now block tests rather than hiding
  inside a passing run.
- `ShapeGeneratorInner.tsx` is reduced by roughly 280 net lines and has moved
  its 50 lazy component declarations out of the host, but it remains above
  Babel's 500 KB optimization threshold; continue extracting one tested domain
  hook at a time.
- Manufacturing release remains HOLD. Missing reviewed STEP, blind-challenge,
  direct-design, and manufactured-pilot evidence must not be fabricated.
