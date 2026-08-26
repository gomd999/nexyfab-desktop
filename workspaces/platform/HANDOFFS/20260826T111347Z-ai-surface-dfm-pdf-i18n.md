# Backend + Frontend Platform handoff: AI surface DFM PDF i18n

- Created: `2026-08-26T11:13:47Z`
- Branch: `scope/platform`
- Head: `a5c82ab912e6cd7a8f3661cdf28cefdda9e7942e`
- Integration target: `integration/nexyfab`

## Summary

Platform consumers now render the complete six-language AI Design V10
contract and localized model descriptions instead of fixed English or Korean
copy. The DFM PDF route now has a bounded request contract, locale negotiation,
localized report labels and numeric/date formatting, and stable error codes.
This closes the source-level copy and input-validation gap; it does not claim
that authenticated PDF artifacts or all script glyphs have been visually
reviewed.

## Changed paths

- `src/app/[lang]/nexyfab/ai/AiDesignWorkspaceLauncher.test.ts`
- `src/app/[lang]/nexyfab/ai/AiDesignWorkspaceLauncher.tsx`
- `src/app/[lang]/nexyfab/ai/AiDesignWorkspaceSurface.test.tsx`
- `src/app/[lang]/nexyfab/ai/AiDesignWorkspaceSurface.tsx`
- `src/app/api/nexyfab/shape-generator/dfm-pdf/dfmPdfContract.test.ts`
- `src/app/api/nexyfab/shape-generator/dfm-pdf/dfmPdfContract.ts`
- `src/app/api/nexyfab/shape-generator/dfm-pdf/dfmPdfI18n.test.ts`
- `src/app/api/nexyfab/shape-generator/dfm-pdf/dfmPdfI18n.ts`
- `src/app/api/nexyfab/shape-generator/dfm-pdf/route.ts`
- `src/components/nexyfab/AiModelSelector.test.tsx`
- `src/components/nexyfab/AiModelSelector.tsx`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260826T111347Z-ai-surface-dfm-pdf-i18n.md`

## Verification

- [x] `npm run lint:ci` — pass.
- [x] `npm run typecheck` — pass.
- [x] `npm run workspace:check -- platform` — pass with 2 commits / 11
  changed source paths and zero ownership violations.
- [x] AI launcher, workspace, model selector, and locale contract — 5 files /
  34 tests pass; staged related regression — 7 files / 66 tests pass.
- [x] DFM PDF input contract and six-language formatting — 2 files / 15
  tests pass.

## Remaining work and risks

- Precision CAD's DFM panel must send its resolved locale explicitly after
  this Platform handoff is integrated; the endpoint already supports both the
  explicit field and `Accept-Language` fallback.
- Authenticated PDFs for all six languages still need artifact generation and
  visual glyph/layout review. Nanum alone is not accepted as proof of complete
  Japanese, Simplified Chinese, or Arabic glyph coverage.
- Live provider calls and production deployment were not executed by this
  handoff. Commercial i18n promotion remains fail-closed until its signed,
  release-bound artifact receipt exists.
