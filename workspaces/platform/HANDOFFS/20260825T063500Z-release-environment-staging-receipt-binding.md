# Platform handoff: production identity and immutable staging receipt gate

- Created: `2026-08-25T06:35:00Z`
- Branch: `scope/platform`
- Head before this unit: `d34a8a35789e94cee97263410d1b8a7fb0429e15`
- Integration target: `integration/nexyfab`
- Commercial release state: `HOLD`

## Summary

The release baseline and commercial security receipt now require an exact
production environment and `nexyfab.com` service binding in addition to build,
deployment, Git, rollback, and image identity. This closes a path where a
well-formed staging or foreign-service deployment ID could be mislabeled as a
production security receipt.

The exact-core staging collector now emits an immutable canonical self-hash.
Its verifier independently rechecks freshness, isolated HTTPS staging origin,
same-build identity, the complete 11-check set, response status/hash bindings,
and the explicit non-promoting HOLD boundary. The commercialization gate
consumes this receipt and fails closed with `core_staging_hold_not_verified`.

## Changed paths

- `scripts/build-release-baseline.mjs`
- `scripts/build-commercial-security-evidence-receipt-v2.mjs`
- `scripts/build-commercial-security-evidence-receipt-v2.test.mjs`
- `scripts/build-commercial-precision-staging-hold-evidence.mjs`
- `scripts/build-commercial-precision-staging-hold-evidence.test.mjs`
- `scripts/commercialization-readiness-gate.mjs`
- `scripts/commercialization-readiness-gate.test.mjs`
- `docs/evidence/release/commercial-precision-staging-hold-20260825.json`
- `docs/operations/commercial-precision-staging-hold-handoff-20260825.md`
- `docs/operations/commercial-precision-worker-v3.md`
- `docs/operations/commercial-security-evidence-convergence-20260825.md`
- `workspaces/platform/CURRENT.md`
- `workspaces/platform/HANDOFFS/20260825T063500Z-release-environment-staging-receipt-binding.md`

## Verification

- [x] Live staging recollection: 11/11 PASS.
- [x] Staging receipt self-hash:
  `b6cba9a6b285eb0f42564e0471470d942745b0609ce83d39c57e496de607392c`.
- [x] Staging receipt tamper, release transplant, stale evidence, production
  origin, and non-HTTPS origin fail closed.
- [x] Commercial security receipt rejects staging and `nexyflow-api` metadata.
- [x] Commercialization gate rejects missing/tampered/different-build staging
  receipts while complete fixtures still pass both tiers.
- [x] Focused Node suite: 53/53 PASS.
- [x] `npm run workspace:check -- platform`: lint, typecheck, structure, and
  ownership PASS with zero violations.

## Remaining work and risks

- merge this unit and redeploy the resulting exact integration HEAD to isolated
  staging, then replace the historical `32ff05ba` receipt with a same-build
  receipt;
- supply a real registered native CAD worker and separately held signing keys;
- run release-bound positive, recovery, independent review, pilot, and
  production operations evidence before Private Beta or GA.

No Production service, variable, database, or deployment was changed.
