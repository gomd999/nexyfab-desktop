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
  `f649678730b18f4a22e3a8ec641ee33a067299be`
- Receipt SHA-256:
  `e3181adce4ddf2e4a3a79b812652ea2a7ab946a18782a3bbdcf8ac324696c292`
- PostgreSQL: 164 tables, 104 rows, 83 final foreign keys, zero orphans
- Object storage: 8/8/8 objects, 8,580 bytes, exact manifests and all DB
  bindings matched
- Companion durable closed loop: 29/29 PASS, SHA-256
  `91e37f5d83193c432bbf983d47888494f913b0aa870ac3959107002ffddcadf3`

## Claim boundary

The run uses disposable local services and an isolated native fixture. It
does not evaluate a live AI provider or independent holdout, and it does not
prove deployed native CAD quality, expert review, or manufacturing pilots.
The receipt is `local-fixture`, `releaseBoundObservation=false`,
`privateBetaEligible=false`, and `commercialGaEligible=false`.

The next valid promotion evidence must come from the exact reviewed release:
real encrypted backup restore with provider/KMS and operator/reviewer records,
authenticated smoke/rollback/alert checks, positive and recovery native-worker
observations, independent CAD/expert evidence, and three manufacturing pilots.
No staging or production service was changed here.
