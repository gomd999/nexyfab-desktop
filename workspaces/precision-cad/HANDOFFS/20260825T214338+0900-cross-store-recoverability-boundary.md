# Precision CAD cross-store recoverability boundary

Generated: `2026-08-25T21:43:38+09:00`

Status: `LOCAL_DB_AND_OBJECT_RESTORE_PASS / NATIVE_CAD_QUALITY_UNCHANGED /
PRIVATE_BETA_FALSE / GA_FALSE`

## Precision state now covered

The shared Platform v3 restore drill uses the completed commercial Precision
durability campaign before its disposable stores are destroyed. It restores
the full PostgreSQL database and requires the following object rows to match
the exact source bytes:

- two immutable commercial execution inputs;
- three committed output intents (`model`, `report`, and `verification`); and
- three signed artifact snapshots used by authoritative persistence.

Each source object is fully read and hashed, copied without overwrite to a
distinct empty backup prefix, read back, restored without overwrite to another
empty prefix, and read back again. All three public manifests contain only key
hashes, byte lengths, and content hashes and must be exactly equal. Source DB
and object state must remain unchanged.

## Evidence

- Restore receipt:
  `docs/evidence/cad-independent/commercial-precision-cross-store-restore-20260825.json`
- Schema: `nexyfab.backup-isolated-restore-drill.v3`
- Source HEAD: `f649678730b18f4a22e3a8ec641ee33a067299be`
- Receipt SHA-256:
  `e3181adce4ddf2e4a3a79b812652ea2a7ab946a18782a3bbdcf8ac324696c292`
- PostgreSQL: 164 tables, 104 rows, current migration `2026082502`, four
  constraints validated, 83 final foreign keys, zero orphans
- Object storage: 8/8/8 objects, 8,580 bytes, exact manifests and all eight DB
  bindings matched
- Local objectives: RPO age 0 ms, full RTO 12,712 ms
- Companion durability receipt: 29/29 PASS, SHA-256
  `91e37f5d83193c432bbf983d47888494f913b0aa870ac3959107002ffddcadf3`

## Authority boundary

The drill proves recoverability of the bounded local commercial execution and
artifact model. It does not execute an independently qualified production CAD
adapter, independently reopen the STEP/XCAF result, establish GD&T correctness,
or certify CNC/sheet/additive manufacturing output.

The receipt says `target=local-fixture`, `releaseBoundObservation=false`,
`privateBetaEligible=false`, and `commercialGaEligible=false`. The
commercialization gate refuses it for promotion. A real encrypted protected
backup restore, exact-release operator/reviewer evidence, authenticated smoke,
rollback/alert evidence, deployed worker recovery, independent CAD review, and
manufacturing pilots remain required.

No staging or production service was changed.
