# Security rotation and restore evidence

This checklist is an operational release gate. It does not alter Closed Beta
accounts, password hashes, database rows, object keys, or customer artifacts.
Never paste a secret value into this document or repository.

## Secret rotation inventory

Rotate immediately after suspected exposure or staff/vendor offboarding, and
otherwise at least every 90 days. Record only provider receipt IDs, timestamps,
key-version fingerprints, and the operator/reviewer identities.

| Credential class | Required action | Acceptance evidence |
|---|---|---|
| Historical reCAPTCHA secret | Revoke the value formerly present in legacy PHP; issue deployment-secret replacement | provider rotation timestamp, old-key-disabled check, hostname-bound challenge smoke |
| `SCAD_AGENT_SESSION_SECRET` | Generate independently from JWT; deploy current+previous overlap only for an approved transition | new key version/fingerprint, cross-user and old-signature rejection tests |
| JWT/admin/session secrets | Rotate through staged dual-key verification where supported; revoke old key after session window | login/refresh/admin elevation smoke, old-key revocation timestamp |
| Webhook/SNS/inbound-email secrets | Rotate with provider and verify signed positive plus unsigned/tampered negative requests | provider endpoint receipt and test event IDs |
| Database/object storage/Redis credentials | Rotate per environment with least privilege | IAM/role change receipt, application health check, old credential denied |
| AI/provider API keys | Rotate and confirm per-user cost breaker/telemetry | provider key ID, budget rejection smoke, old credential denied |

## Backup and restore drill

1. Create an encrypted production-like backup without changing the source DB.
2. Restore only into an isolated database whose name contains
   `_restore_drill`; `scripts/verify-backup-restore.mjs` rejects other targets.
3. Provide three distinct object-storage roles and safe prefixes: read-only
   source, initially empty immutable backup, and initially empty restore drill.
   `scripts/verify-object-storage-restore.mjs` performs bounded full-byte reads,
   no-overwrite copies, and exact key-hash/byte/content-hash comparisons.
4. Require every commercial immutable-input, committed-output, and artifact-
   snapshot database binding to match the source object bytes. Verify exact
   database rows, zero foreign-key orphans, current migrations, validated
   constraints, and unchanged database and object-storage sources.
5. Run login, project open, authorized download, quote, and CAD revision smoke
   against the isolated environment.
6. Record backup hash/bytes, encryption/KMS key version, start/end timestamps,
   measured RPO/RTO, restored table count, smoke result, operator, and a second
   reviewer. Store the receipt in the protected deployment evidence system.
7. Destroy the isolated restore environment under the approved retention rule;
   do not point application production traffic at it.

The machine receipt schema is `nexyfab.backup-isolated-restore-drill.v3`.
Release evaluation accepts only a fresh exact-release `release-bound` receipt;
the disposable local campaign emits `local-fixture`, which is always rejected
for promotion even when every restore check passes.

## Release decision

The local Docker campaign proves executable database/object restore mechanics,
source immutability, and fail-closed receipt validation. A release must remain
`external_evidence_pending` until the same contract is observed against a real
encrypted protected backup and is accompanied by provider/KMS, operator,
reviewer, smoke, retention-destruction, and secret-rotation evidence.
Repository-generated JSON, screenshots without provider identifiers, and
manually written `pass` text are not substitutes.
