# Platform handoff: approved native adapter release binding

- Created: 2026-08-25T03:37:22.000Z
- Branch: `scope/platform`
- Head: `f26562832acb64a7d94a16f45fdc68b2292c24a6`
- Integration target: `integration/nexyfab`

## Summary

Upgraded runtime evidence, live release health, core readiness, and the real
local durability campaign so a signed commercial Precision worker is trusted
only when its native executable and canonical invocation match the approved
worker registry. Runtime evidence v3 and hostile adapter substitution tests now
carry that binding through the release decision.

## Changed paths

- `docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`
- `docs/evidence/release/commercial-precision-runtime-evidence.json`
- `docs/operations/commercial-precision-local-durability-handoff-20260825.md`
- `docs/operations/commercial-precision-worker-v3.md`
- `scripts/build-commercial-precision-runtime-evidence.mjs`
- `scripts/build-commercial-precision-runtime-evidence.test.mjs`
- `scripts/commercial-precision-local-durability-campaign.ts`
- `scripts/package-release-health-evidence.mjs`
- `src/app/api/health/ready/route.test.ts`
- `src/app/api/health/ready/route.ts`
- `src/app/api/health/release/route.test.ts`
- `src/lib/releaseHealthEvidence.ts`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260825T033722Z-approved-native-adapter-release-binding.md`

## Verification

- [x] `npm run lint:ci`
- [x] `npm run typecheck`
- [x] `node --test scripts/build-commercial-precision-runtime-evidence.test.mjs scripts/package-release-health-evidence.test.mjs`
- [x] `npx vitest run src/app/api/health/ready/route.test.ts src/app/api/health/release/route.test.ts --reporter=dot`
- [x] `npm run commercial:precision:local-durability:generate`
- [x] `npm run workspace:check -- platform`

## Remaining work and risks

- The shared receipt type remains transitionally optional until the integrated
  source fixtures are all migrated, although every runtime parser already
  requires both hashes.
- The upgraded core must be redeployed to isolated staging and its packaged v3
  HOLD receipt rebound to that exact build before any worker canary.
- A reviewed adapter image, separately held signing key, positive and recovery
  campaigns, independent CAD review, and manufacturing pilot remain absent.
