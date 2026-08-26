# No-payment commercial i18n closure

- Created: `2026-08-26T09:35:28.773Z`
- Branch: `scope/platform`
- Head: `6421d1f7d6fbf2843e2e93dc75f4591650c0f9cd`
- Integration target: `integration/nexyfab`

## Summary

Closed the observed platform-language leaks across shared AI navigation,
Japanese landing copy, quote lifecycle email and analysis, and customer/admin
tabular exports. Commercial readiness now supports the explicitly requested
no-payment operating mode while retaining every non-payment production gate,
and all i18n release consumers share the measured `2711` catalog contract.

## Changed paths

- `scripts/i18n/build-commercial-i18n-release-receipt.mjs`
- `scripts/verify-rollback-target.mjs`
- `src/lib/i18n/commercialReleaseContract.json`
- `src/lib/releaseHealthEvidence.ts`
- `src/lib/commercial-readiness.ts`
- `src/lib/startup-validation.ts`
- `src/app/[lang]/homeDict/ja.ts`
- `src/components/nexyfab/NexysysAppSwitcher.tsx`
- `src/components/nexyfab/AiModelSelector.tsx`
- `src/app/api/jobs/quote-expiry-remind/quoteExpiryEmail.ts`
- `src/app/api/nexyfab/quote-accuracy/route.ts`
- `src/app/api/nexyfab/export/i18n.ts`
- `src/app/api/nexyfab/export/contracts/i18n.ts`
- `src/app/api/nexyfab/erp/export/route.ts`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `npm run workspace:check -- platform`
- [x] `node --test scripts/i18n/build-commercial-i18n-release-receipt.test.mjs scripts/verify-rollback-target.test.mjs`
- [x] Focused Vitest: 64/64 platform UI, email, export, quote fallback,
  commercial readiness, and release-health tests passed before commit.
- [x] Commit hooks reran TypeScript, ESLint, and related tests for all four
  source commits without failure.

## Remaining work and risks

- The checked release receipt remains `HOLD` until a fresh build/head-bound
  automated receipt and an independent signed full-product visual, RTL, email,
  PDF, and export review are supplied.
- Payment collection remains deliberately disabled; enabling it later still
  requires an explicitly configured provider and verified webhook secret.
- Staging and production traffic were not changed by this Platform scope unit.
