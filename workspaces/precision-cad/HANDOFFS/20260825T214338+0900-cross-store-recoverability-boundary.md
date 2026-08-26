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
- Source HEAD: `c54e6f607e13878b0adfcf7b64f9b8c0d9873975`
- Receipt SHA-256:
  `575c30ebded3337f0cb9b50e24898bad30ddfd0746b1cb6fffb6c847b85a6b5d`
- PostgreSQL: 164 tables, 104 rows, current migration `2026082502`, four
  constraints validated, 83 final foreign keys, zero orphans
- Object storage: 8/8/8 objects, 8,580 bytes, exact manifests and all eight DB
  bindings matched
- Local objectives: RPO age 0 ms, full RTO 13,029 ms
- Companion durability receipt: 29/29 PASS, SHA-256
  `67e1bafac0d4d747d0dd2d8ff1aa7b03d90bff64888a22e352cf714c6ad6d35a`

## Authority boundary

The drill proves recoverability of the bounded local commercial execution and
artifact model. It does not execute an independently qualified production CAD
adapter, independently reopen the STEP/XCAF result, establish GD&T correctness,
or certify CNC/sheet/additive manufacturing output.

The receipt says `target=local-fixture`, `releaseBoundObservation=false`,
`privateBetaEligible=false`, and `commercialGaEligible=false`. The
commercialization gate refuses it for promotion. A real encrypted protected
backup restore must reuse an immutable provider DB backup with KMS/receipt
bindings and use a distinct object-backup failure domain with versioning,
Object Lock retention, and KMS readback. Exact-release operator/reviewer evidence, authenticated smoke,
rollback/alert evidence, deployed worker recovery, independent CAD review, and
manufacturing pilots remain required.

No staging or production service was changed.
