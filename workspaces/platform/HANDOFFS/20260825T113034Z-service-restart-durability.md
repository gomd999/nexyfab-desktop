# Service-restart durability handoff

Generated: `2026-08-25T11:30:34Z`

Status: `LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS / ACTUAL_SERVICE_RESTART_PASS /
PRIVATE_BETA_FALSE / GA_FALSE / RELEASE_HOLD`

## Closure

Platform commit `9819aa13dd4dc9759416b1ac23406cd2b877564e` upgrades the
disposable AI-to-Precision durability campaign from live-process readback to an
actual persistence-service restart boundary.

The campaign now:

1. writes the exact migration, transactional outbox/journal, immutable input,
   three worker outputs, signed worker/parser receipts, persistence receipt,
   artifact snapshots, and workspace CAS head;
2. writes a Redis AOF sentinel, closes all PostgreSQL, Redis, and S3 clients,
   and resets the application database adapter;
3. restarts the uniquely named disposable PostgreSQL, Redis, and object-storage
   services, waits for health, and rediscovers Docker-published ports;
4. reconnects with fresh clients and verifies every authoritative row, Redis
   sentinel, object byte length, and SHA-256 binding; and
5. requires exact persistence `REPLAY` through an artifact store that throws if
   any post-restart write is attempted.

The compose project name is constrained to
`nexyfab-precision-durability-<digits>`. The runner removed its exact
containers, network, and three volumes after the passing run.

## Evidence

- Receipt:
  `docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`
- Schema: `nexyfab.commercial-precision-local-durability.v2`
- Source HEAD: `9819aa13dd4dc9759416b1ac23406cd2b877564e`
- Generated: `2026-08-25T11:29:54.200Z`
- Result: 28/28 `PASS`
- Receipt SHA-256:
  `6946c7c70124bfce1dd9b99c00617e55176684cfeca817c60b315387ab948c23`
- Platform workspace: ownership/structure PASS, full source ESLint PASS,
  TypeScript PASS
- CI: `.github/workflows/commercial-precision-durability.yml` runs the same
  campaign for affected pushes/pull requests and weekly.

## Claim boundary

This evidence uses digest-pinned disposable services, ephemeral credentials,
and a deterministic isolated native fixture. The receipt explicitly sets:

- `fixtureIsCommercialRuntimeEvidence=false`;
- `privateBetaEligible=false`;
- `commercialGaEligible=false`; and
- `independentCadOrManufacturingCertified=false`.

It proves source/infrastructure durability and fail-closed replay behavior. It
does not prove a reviewed production-class CAD adapter, release-held worker
keys, an exact staging/production deployment, independent CAD review, expert
approval, manufacturing pilots, restore/rollback operations, or a seven-day
observation window. No staging or production state was changed.

## Next controlled evidence

1. Run the same exact candidate with a reviewed native CAD adapter and
   separately held signing key in isolated non-commercial staging.
2. Capture positive execution, kill/restart recovery, restore, rollback,
   alerting, and credential-rotation evidence bound to that deployment.
3. Obtain independent blind CAD review and three real manufacturing-pilot
   records through the existing signed-packet and verified-promotion path.
4. Re-evaluate Private Beta only after all required receipts validate together;
   retain GA HOLD until production-bound security and operations evidence also
   passes.
