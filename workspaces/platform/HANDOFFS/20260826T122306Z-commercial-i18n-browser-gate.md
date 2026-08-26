# Platform handoff: commercial-i18n-browser-gate

- Created: 2026-08-26T12:23:06.501Z
- Branch: `scope/platform`
- Head: `95ceef60d0987550d81168894b757bb0856a8508`
- Integration target: `integration/nexyfab`

## Summary

Aligned the AI Design V10 browser contract with the six-locale human-readable trust copy and removed five repaid locale-hardcoding entries from the ratchet baseline. The stricter baseline now passes both official and expanded i18n regression suites.

## Changed paths

- `e2e/ai-design-v10-workspace.spec.ts`
- `scripts/i18n/locale-hardcode-baseline.json`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npx vitest run scripts/i18n/commercial-catalog.test.ts scripts/i18n/lang-coverage.test.ts scripts/i18n/locale-hardcode.test.ts src/lib/i18n/adminTranslations.test.ts src/lib/i18n/manufacturingTerms.test.ts src/lib/i18n/normalize.test.ts src/lib/i18n/serverLocale.test.ts --reporter=dot` (7 files, 40 tests)
- [x] `npx vitest run i18n --reporter=dot` (51 files, 330 tests)

## Remaining work and risks

- Re-run the browser matrix from an HTTP E2E build created with `CSP_OMIT_UPGRADE_INSECURE=1`; a normal HTTPS production build correctly blocks HTTP static chunks in WebKit.
- Full-product signed visual, RTL, email, PDF, and export review evidence remains an external release artifact rather than an automated test result.
