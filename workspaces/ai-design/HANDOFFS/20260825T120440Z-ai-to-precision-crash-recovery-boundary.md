# AI-to-Precision crash-recovery boundary handoff

Generated: `2026-08-25T12:04:40Z`

Status: `AI_CANDIDATE_AUTHORITY_CONNECTED / DOWNSTREAM_CRASH_QUARANTINE_PASS /
LOCAL_DURABILITY_29_OF_29_PASS / AI_MODEL_ACCURACY_UNCHANGED /
PRIVATE_BETA_FALSE / GA_FALSE`

## Connected authority

AI Design remains revision-bound `CONCEPT`/`DESIGN_CANDIDATE` authority. Its
approved immutable handoff can enter the commercial Precision execution v3
path, but the AI surface cannot create or promote any of the following:

- a native-worker or parser signature;
- exact CAD verification PASS;
- authoritative workspace CAS commit;
- independent CAD/expert approval;
- manufacturing inspection acceptance; or
- Private Beta, GA, or commercial release authority.

Precision commit `94ad99b6eae22ab5b69f91992785aab8caa97e88` and Platform
campaign commit `ad437dbf341b6c9d7643bf4d2e742ba077d0acbf` strengthen the
downstream failure boundary without broadening AI authority.

## Downstream evidence

The shared receipt
`docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`
is schema `nexyfab.commercial-precision-local-durability.v3`, passes 29/29
checks, and has receipt SHA-256
`8c27da0ab28c80c0e226feb84fbea5549c3fd27180e55c0a3069a4e1529a4c38`.

For crash recovery, a second independently approved Precision execution is
transactionally enqueued and claimed. No callback, output, artifact,
persistence receipt, or workspace commit is produced. After logical lease
expiry, the exact outbox and journal are quarantined `VERIFIED_UNKNOWN`, lease
authority is cleared, the stale capability is rejected, the job cannot be
reclaimed, and the workspace head remains unchanged.

The same run closes and reconnects every application client around actual
disposable PostgreSQL, Redis AOF, and object-storage restarts, verifies every
authoritative row/object/hash, and requires exact replay through a store that
rejects writes.

## Honest boundary

This local deterministic campaign does not call an external AI model, measure
independent AI accuracy, execute a reviewed production-class CAD adapter, or
observe a real staging/production worker process crash. It supplies no
independent review signature or manufacturing-pilot measurement.

The receipt therefore keeps `fixtureIsCommercialRuntimeEvidence=false`,
`privateBetaEligible=false`, `commercialGaEligible=false`, and
`independentCadOrManufacturingCertified=false`. Staging and production were not
deployed, restarted, reconfigured, or written.

## Next external proof

1. Run independent AI holdout evaluation on the exact candidate authority.
2. Execute and kill the reviewed native Precision worker in isolated staging,
   then capture claim/lease/quarantine/operator-reconciliation evidence bound
   to that deployment.
3. Complete signed blind CAD review and CNC/sheet/additive pilot evidence.
4. Promote only through the existing exact receipt validators after every
   required authority independently passes.
