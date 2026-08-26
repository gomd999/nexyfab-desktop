# Precision CAD handoff: shape-generator-bom-export-slice

- Created: `2026-08-26T16:12:48Z`
- Branch: `scope/precision-cad`
- Head: `a7d9b98adf4c2b9a9e2123aab7ec99000f0e46d9`
- Integration target: `integration/nexyfab`

## Summary

Established the first safe decomposition boundary in the oversized Precision
CAD workspace host. BOM work-object assembly and CSV/Excel export actions now
live in a typed hook with a pure, focused-testable builder while preserving the
existing host handler contract.

## Changed paths

- `src/app/[lang]/shape-generator/ShapeGeneratorInner.tsx`
- `src/app/[lang]/shape-generator/hooks/useBomExportActions.ts`
- `src/app/[lang]/shape-generator/hooks/useBomExportActions.test.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260826T161248Z-shape-generator-bom-export-slice.md`

## Verification

- [x] BOM work-object builder: 1 file / 3 tests PASS.
- [x] Assembly and cart inputs retain ordering, dimensions, density-based
  weight, and stable row numbering.
- [x] Active sketch fallback occurs only when no assembly or cart row exists.
- [x] Empty inputs produce no downloadable placeholder row.
- [x] `npm run typecheck` — project TypeScript PASS (35.8s).
- [x] `npm run platform:architecture:check` — PASS.
- [x] `npm run workspace:check -- precision-cad`: ownership and classification
  clean with zero violations.

## Cleanup audit

No file was deleted. The tracked-name candidates were active OCCT copy tooling,
robot coverage endpoints, and offline-font build source/tests. Treating their
names as generated artifacts would have removed production or test behavior.

## Remaining work and risks

- `ShapeGeneratorInner.tsx` remains 655,715 bytes and above Babel's 500KB
  formatting threshold. Continue with similarly bounded state/action clusters;
  do not attempt a single large untyped extraction.
- Browser BOM CSV/Excel download smoke remains part of the final integrated
  release verification.
