# AI Design downstream cross-store recovery boundary

Generated: `2026-08-25T21:43:38+09:00`

Status: `AI_TO_PRECISION_RECOVERY_CONNECTED / AI_ACCURACY_UNCHANGED /
PRIVATE_BETA_FALSE / GA_FALSE`

## V9/V10 connection

This handoff extends, but does not rewrite, the immutable integration records:

- `20260824T153232+0900-ai-design-chat-first-v9.md`
- `20260824T170157+0900-ai-design-v9-v10-integration-addendum.md`

Their contracts remain authoritative: chat is the orchestration spine, apply
is explicit and revision-bound, previews are non-authoritative, and a
`precision-cad-handoff` is only a request. AI Design owns concept and design-
candidate authority; Precision and signed external evidence own exact CAD and
manufacturing decisions.

## New downstream guarantee

The shared v3 restore drill starts from a completed durable commercial
Precision campaign. It proves that the PostgreSQL execution/journal/outbox/
workspace state and its immutable S3-compatible artifacts can be restored
together:

- two immutable commercial inputs;
- three committed output objects; and
- three signed artifact snapshots.

All eight objects are fully read and hashed, copied without overwrite to a
distinct empty backup prefix, read back, restored to another empty prefix, and
read back again. Every DB key/hash/byte binding must match, all three public
manifests must be identical, and the source database and object store must stay
unchanged.

## Evidence

- Restore receipt:
  `docs/evidence/cad-independent/commercial-precision-cross-store-restore-20260825.json`
- Schema/source: `nexyfab.backup-isolated-restore-drill.v3`,
  `c54e6f607e13878b0adfcf7b64f9b8c0d9873975`
- Receipt SHA-256:
  `575c30ebded3337f0cb9b50e24898bad30ddfd0746b1cb6fffb6c847b85a6b5d`
- PostgreSQL: 164 tables, 104 rows, 83 final foreign keys, zero orphans
- Object storage: 8/8/8 objects, 8,580 bytes, exact manifests and all DB
  bindings matched
- Companion durable closed loop: 29/29 PASS, SHA-256
  `67e1bafac0d4d747d0dd2d8ff1aa7b03d90bff64888a22e352cf714c6ad6d35a`

## Claim boundary

The run uses disposable local services and an isolated native fixture. It
does not evaluate a live AI provider or independent holdout, and it does not
prove deployed native CAD quality, expert review, or manufacturing pilots.
The receipt is `local-fixture`, `releaseBoundObservation=false`,
`privateBetaEligible=false`, and `commercialGaEligible=false`.

Release-bound restore cannot be obtained by changing that label. It requires
an existing immutable provider database backup bound to KMS key-version and
provider receipt hashes, plus an object backup in a distinct endpoint/region
failure domain with versioning, Object Lock retention, and KMS-encrypted
readback.

The next valid promotion evidence must come from the exact reviewed release:
real encrypted backup restore with provider/KMS and operator/reviewer records,
authenticated smoke/rollback/alert checks, positive and recovery native-worker
observations, independent CAD/expert evidence, and three manufacturing pilots.
No staging or production service was changed here.
