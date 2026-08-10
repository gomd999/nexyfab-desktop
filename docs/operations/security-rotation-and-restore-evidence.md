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
3. Verify schema/table count, representative account/project/artifact metadata,
   foreign-key consistency, and object-key reachability without downloading or
   rewriting all customer artifacts.
4. Run login, project open, authorized download, quote, and CAD revision smoke
   against the isolated environment.
5. Record backup hash/bytes, encryption/KMS key version, start/end timestamps,
   measured RPO/RTO, restored table count, smoke result, operator, and a second
   reviewer. Store the receipt in the protected deployment evidence system.
6. Destroy the isolated restore environment under the approved retention rule;
   do not point application production traffic at it.

## Release decision

Local unit tests only prove the restore command's target guard. A release must
remain `external_evidence_pending` until a real encrypted backup restore and
secret-rotation receipt exist. Repository-generated JSON, screenshots without
provider identifiers, and manually written `pass` text are not substitutes.
