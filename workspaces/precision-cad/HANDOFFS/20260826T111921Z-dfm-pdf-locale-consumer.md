# Precision CAD handoff: DFM PDF locale consumer

- Created: `2026-08-26T11:19:21Z`
- Branch: `scope/precision-cad`
- Head: `3ff7b989e2a2b7da45280aaae5efd0a20539b596`
- Integration target: `integration/nexyfab`

## Summary

The DFM panel now binds every PDF request to the active product locale and
maps the Platform endpoint's stable error codes to actionable six-language
copy. The unknown-error fallback does not expose internal server details. This
keeps the Platform producer and Precision CAD consumer revision-consistent;
it does not claim that authenticated multilingual PDF artifacts have passed
visual glyph and layout review.

## Changed paths

- `src/app/[lang]/shape-generator/analysis/DFMPanel.tsx`
- `src/app/[lang]/shape-generator/analysis/dfmPdfClientI18n.test.ts`
- `src/app/[lang]/shape-generator/analysis/dfmPdfClientI18n.ts`
- `workspaces/precision-cad/CURRENT.md`
- `workspaces/precision-cad/HANDOFFS/20260826T111921Z-dfm-pdf-locale-consumer.md`

## Verification

- [x] `npm run typecheck` — pass.
- [x] `npm run platform:architecture:check` — pass.
- [x] `npm run workspace:check -- precision-cad` — pass with 1 commit / 3
  changed source paths and zero ownership violations.
- [x] Precision client error copy plus Platform PDF request/i18n contract —
  3 files / 22 tests pass.

## Remaining work and risks

- Generate authenticated PDFs for all six languages and visually inspect text,
  RTL flow, wrapping, pagination, and glyph coverage before i18n promotion.
- The embedded Nanum font is not evidence of full Japanese, Chinese, or Arabic
  glyph coverage; a verified multi-script font strategy is still required.
- External precision qualification, expert review, manufactured pilots, and
  production deployment remain pending/HOLD.
