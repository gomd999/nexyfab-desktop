# Platform current session

## 2026-08-24 migration 2403 recovery and release evidence

- Status: `LOCAL_EVIDENCE_CONTRACT_CURRENT / STAGING_MIGRATION_PENDING / RELEASE_HOLD`
- Source head: `b4c47109`.
- Production migration receipts, isolated restore receipts, commercialization
  eligibility, rollback verification, and `/api/health/release` now require
  the complete commercial migration set through `2026082403`.
- Restore evidence derives its target version and checksum from the actual
  versioned runner result instead of reporting the obsolete `2026082208`.
- A shared compatibility helper accepts only known applied migration versions
  at or above a feature's required version; this is the integration contract
  for Precision routes that depend on the 2208 generation schema.
- Verification: Node deployment/migration/restore/commercialization/rollback
  contracts `64/64`, Vitest readiness/release contracts `27/27`, focused and
  full source ESLint, TypeScript, and platform workspace check passed.
- Handoff: `HANDOFFS/20260824T154321Z-migration-2403-evidence-alignment.md`.
- Next action: integrate, update Precision route guards to the shared helper,
  then perform isolated staging restore and migration before any web deploy.

## 2026-08-24 commercial PostgreSQL readiness contract

- Status: `LOCAL_GATE_HARDENED / STAGING_DEPLOYMENT_STALE / RELEASE_HOLD`
- Source head: `91decae6170cac62ec971728bee013d979658d77`.
- Deploy preflight and live readiness now consume one PostgreSQL authority
  contract through migration `2026082403`, including Canonical CAD V2, AI
  Design V10 authority, and AI-to-Precision bridge tables, constraints, and
  immutability triggers.
- Read-only Railway isolation audit passed `30/30`; current staging live,
  readiness, and anonymous-session probes returned HTTP `200`.
- The current staging web deployment predates this source unit (created
  `2026-08-21T21:42:58.476Z`) and has one replica, so it is not evidence for
  the new bridge, restore, restart, or multi-instance behavior.
- Verification: contract/readiness `18/18`, deployment structure `12/12`,
  focused ESLint, full source ESLint, TypeScript, and platform workspace check
  passed.
- Handoff:
  `HANDOFFS/20260824T152728Z-commercial-postgres-readiness-contract.md`.
- Next action: integrate this unit, then apply/reapply migrations and deploy
  the exact integrated HEAD to isolated staging before collecting signed
  restore, multi-instance, worker-restart, alarm, tenant, and rollback proof.

## 2026-08-24 AI Precision bridge operations

- Status: `LOCAL_RUNTIME_WIRED / STAGING_EVIDENCE_HOLD`
- Integrated implementation base: `920e660d` on both `scope/platform` and
  `integration/nexyfab` before this documentation handoff.
- PostgreSQL migration `2026082403`, SQLite schema `91`, commercial readiness
  checks, private immutable object writes, authenticated exact-worker cron, and
  Railway scheduling now support the AI-to-Precision exact bridge.
- Crash policy is fail-closed: uncertain sent jobs become `VERIFIED_UNKNOWN`
  instead of being re-executed, and recover only from persisted signed evidence.
- Verification: production build, migration/deploy contract tests, workspace
  audit, platform architecture, full source ESLint, TypeScript, and all scope
  checks passed at the integrated source baseline.
- Handoff: `HANDOFFS/20260824T134514Z-ai-precision-worker-scheduling.md`.
- Next action: apply the migration and exercise PostgreSQL/S3/Redis/Railway in
  staging with restore, multi-instance, tenant isolation, alarm, restart, and
  rollback evidence. Production release remains `HOLD`.

- Status: `LEGACY_PHP_SECURITY_CLEANUP_READY_FOR_INTEGRATION`
- Branch: `scope/platform`
- Baseline: `baseline/pre-scope-20260823`
- Current task: Permanently remove the three legacy PHP surfaces and route inquiry administration through the authenticated Next.js `/admin/inquiries` page.
- Verification: Node `22.23.2` / npm `10.9.8`; `npm run workspace:check -- platform` passed ownership, lint, and TypeScript checks.
- Next action: Commit this Platform-owned source unit, create a UTC source-freeze handoff, merge it into `integration/nexyfab`, then add the integration-owned proxy deny rule and regression coverage for `/adminlink/index.php`.
- External blocker: the historical credential must still be rotated at its provider; source deletion does not revoke an already copied secret. Release promotion and Git history rewrite remain `HOLD`.
