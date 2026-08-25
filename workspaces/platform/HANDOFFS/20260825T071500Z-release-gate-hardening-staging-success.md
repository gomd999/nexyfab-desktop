# Release-gate hardening staging success handoff

Timestamp: `2026-08-25T07:15:00Z`

Status: `EXACT_SOURCE_DEPLOYED / 11_OF_11_PASS / STAGING_RECEIPT_VERIFIED /
PRIVATE_BETA_FALSE / GA_FALSE / PRODUCTION_UNCHANGED`

## Exact deployed identity

- environment/service: isolated Railway `staging` / `nexyfab.com`;
- source, build, and Git head:
  `3797ad6d75f02ad750e746199eb8c041e5d52d9f`;
- deployment: `d4718236-06ca-4b56-81c8-5c271b2e8976`;
- image:
  `sha256:bd1364d1121916016d91a19919486d39a053a9ce38db008a05c197f9a20ce2bf`;
- Railway status: `SUCCESS`, 2 configured instances, 2 `RUNNING`;
- schema migration: `2026082502`.

The verified deployment path passed the replicated production build, exact
live identity, readiness, and the redacted 11-check staging-HOLD collector.
Commercial mode remained disabled and release health correctly remained HTTP
503 `HOLD`.

## Immutable evidence and gate binding

The checked-in receipt is
`docs/evidence/release/commercial-precision-staging-hold-20260825.json`:

- collector-output raw-byte SHA-256 at collection time:
  `da737dc2e97d23d54b6afff48adadf1fd32117140f4221cfe363bf9fe9dbcb16`;
- canonical receipt self-hash:
  `59485c350d6aeaa45881ef7e06032836bec330ce2be49c46331fcac9ca03731e`;
- exact checks: 11/11 PASS;
- packaged Precision runtime receipt SHA-256:
  `bd12ecba3301f192b2e070acf553001ed2595c4b4bfcff1530ab759430da66a6`.

The commercialization gate independently verified the receipt against the
exact current application source and deployment. It no longer reports
`core_staging_hold_not_verified`. A staging HOLD receipt is only a prerequisite
and cannot authorize promotion. The canonical self-hash is the portable
authority across Windows checkout line endings; the raw-byte hash is only the
collection-time snapshot.

The evidence/documentation commit created after deployment is intentionally
newer than application source `3797ad6d`. For an exact promotion evaluation,
the external release pipeline must provide the receipt that binds the selected
application build; an evidence commit must never be substituted for deployed
application identity.

## Remaining release boundary

Private Beta and GA remain false. No production-class native adapter or
separately held worker keys were supplied, no positive same-release exact loop
or multi-instance recovery campaign ran, no independent STEP/native-CAD/XCAF/
GD&T review or expert approval exists, and no manufacturing pilots or
production migration/restore/smoke evidence exists.

Production was not deployed, restarted, reconfigured, or written.
