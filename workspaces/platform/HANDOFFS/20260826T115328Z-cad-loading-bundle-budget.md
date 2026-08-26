# Platform handoff: cad-loading-bundle-budget

- Created: 2026-08-26T11:53:28.131Z
- Branch: `scope/platform`
- Head: `ab0fe52accab4cfc3a6d3504b5edc5c54da13772`
- Integration target: `integration/nexyfab`

## Summary

Rebased the main Precision CAD route budget to 10% above the measured 8,701-byte initial JavaScript entry. The increase is the intentional six-locale workspace loading copy; shared and worst-first-paint budgets remain below their existing limits.

## Changed paths

- `scripts/bundle-budget.json`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`

## Remaining work and risks

- Re-run the integration production build so the existing `.next` measurement is evaluated against this source-controlled limit.
- `ShapeGeneratorInner.tsx` remains larger than Babel's 500 KB code-generation optimization threshold and should be decomposed in a separate performance change.
