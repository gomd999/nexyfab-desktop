# Platform current session

## 2026-08-25 commercial Precision receipt determinism

- Status: `RUNTIME_DERIVATION_DETERMINISTIC / REAL_OBSERVATION_NOT_RUN /
  COMMERCIAL_RELEASE_HOLD`.
- The commercial Precision v3 receipt now uses the shared
  `utf8-crlf-to-lf` contract for migration SQL, the signed runtime observation,
  and all five supporting JSON evidence bindings.
- Valid signed evidence remains stable across Windows worktrees, while missing
  canonicalization, semantic changes, unsafe paths, forged signatures, and
  release transplant still fail closed.
- The checked-in no-observation receipt can now be re-derived cross-worktree;
  without the separately held HMAC authority it remains HOLD with only
  `receipt_attestation_invalid`, not a false derivation mismatch.
- Handoff:
  `HANDOFFS/20260825T051832Z-commercial-precision-receipt-determinism.md`.

## 2026-08-25 release baseline and security evidence convergence

- Status: `CURRENT_SOURCE_EVIDENCE_PASS / PRODUCTION_RELEASE_IDENTITY_MISSING /
  COMMERCIAL_SECURITY_HOLD`.
- Commit `c99aeab4881ae73236f190ae0d6f16f261faec16` repairs release-baseline
  generation after the runtime evidence packaging fix. It validates the exact,
  ordered deny-by-default `docs/**` Railway policy and rejects missing,
  reordered, or broadened evidence exceptions such as `!docs`.
- Commit `54599352` removes a real evidence hash cycle: secret scanning now
  excludes exactly four derived mutable current receipts, declares that scope
  in machine evidence, and does not execute or set an exit code when imported
  by tests. The commercial security verifier rejects any changed exclusion set.
- Commit `742db35a977d5504772ab743ace1fea07683c5a2` canonicalizes scanned
  text from UTF-8 CRLF to LF before coverage accounting. The policy is embedded
  in the scan and rejected if absent or changed, so the same clean HEAD can be
  verified across Windows worktrees with different checkout line endings.
- The same canonical text-binding contract now covers route source hashes, CAD
  API source hashes, the package-lock binding, stored evidence comparisons, and
  every source binding in the commercial security v2 receipt. Dependency audit
  checks also retain a nonzero exit after reporting stale evidence instead of
  overwriting the failure with the vulnerability result.
- Current source evidence passes: route security `625 routes / 860 handlers /
  0 gaps`, CAD API controls `84 routes / 86 handlers / 0 issues`, secret scan
  of more than 10,000 Git candidates with `0 findings`, and dependency audit
  with `0 vulnerabilities`. Exact scan counts remain authoritative only in the
  machine receipt so documentation cannot create another self-reference.
- The v2 commercial security receipt has valid source bindings, derivation,
  freshness, package-lock binding, and declared source integrity. It remains
  honest `HOLD` only for missing production build, deployment, and Git
  identities; staging evidence is not relabeled as production evidence.
- No deployment or production configuration was changed by this unit.
- Handoff:
  `HANDOFFS/20260825T044342Z-release-baseline-security-evidence-convergence.md`.
- Cross-worktree determinism addendum:
  `HANDOFFS/20260825T045114Z-cross-worktree-secret-scan-determinism.md`.
- Complete security binding addendum:
  `HANDOFFS/20260825T050229Z-cross-worktree-security-binding-convergence.md`.

## 2026-08-25 adapter-bound exact staging HOLD deployment

- Status: `RUNTIME_EVIDENCE_V3_DEPLOYED / STAGING_HOLD_11_OF_11_PASS /
  REAL_NATIVE_WORKER_NOT_RUN / PRIVATE_BETA_FALSE / GA_FALSE`.
- Exact integration source/build/Git
  `d0ae60b6102e90bc0fcef1fa50c425d4d768a989` is running in isolated Railway
  `staging` as deployment `1839657a-a2ac-4671-aea9-cea408a3811a`.
- The verified deployment path passed workspace audit, platform architecture,
  a clean production build, exact live build identity, and readiness. The
  redacted collector then passed all 11 release, PostgreSQL, Redis, migration,
  packaged v3 HOLD, forged claim/lease, and callback fail-closed checks.
- The deployed runtime receipt now carries the native executable and canonical
  invocation trust contract. It intentionally contains no positive runtime
  observation and keeps Private Beta and GA false.
- Production was not deployed, restarted, reconfigured, or written. A reviewed
  real adapter, separately held key, positive canary/recovery campaign,
  independent CAD review, and manufacturing pilots remain required.
- Handoff:
  `HANDOFFS/20260825T041106Z-adapter-bound-staging-hold.md`.

## 2026-08-25 approved native adapter release binding

- Status: `RUNTIME_EVIDENCE_V3_PASS / LOCAL_DURABLE_24_OF_24_PASS /
  REAL_ADAPTER_AND_STAGING_CANARY_NOT_RUN / COMMERCIAL_RELEASE_HOLD`.
- Commit `f26562832acb64a7d94a16f45fdc68b2292c24a6` upgrades commercial
  Precision runtime evidence to v3 and binds readiness and live release health
  to the registered native executable and canonical invocation SHA-256 values.
  A valid worker signature with substituted adapter bytes or arguments remains
  `HOLD`.
- The real-container local campaign passed 24/24 checks after adding
  `nativeAdapterBinding`; it still identifies the native process as a local
  deterministic fixture and keeps Private Beta and GA false.
- Worker liveness and commercial readiness are now distinct: `/live` proves
  only the process is running, while `/health` stays HTTP 503 until a signed
  canary self-test passes with matching adapter identity.
- No production-class adapter image, release worker key, live canary, external
  CAD review, or manufacturing pilot was supplied. Production was not changed.

## 2026-08-25 commercial Precision runtime release authority

- Status: `LOCAL_GATE_CURRENT / 30x7_LOCAL_CANDIDATE / COMMERCIAL_RUNTIME_HOLD`.
- The commercialization gate and live `/api/health/release` no longer accept a
  commercial-mode flag as evidence that the AI-to-Precision exact path is
  commercially durable.
- A new HMAC-attested, immutable receipt derives separate Private Beta and GA
  decisions from release-bound PostgreSQL, Redis, private object storage,
  transactional outbox, lease, native worker, exactly-three-output, signed
  callback, authoritative persistence, negative-attack, recovery, and
  credential-rotation observations.
- The live GA endpoint additionally binds that receipt to the exact build,
  commit, production deployment, migration `2026082502` checksum, execution
  contract v3, all 20 required checks, and the same-deployment production
  observation. Missing, tampered, stale, or transplanted receipts fail closed.
- The local mechanical campaign was rerun against current source: 30/30
  features and all 210 create/edit/regenerate/save-reopen/undo/export/drawing
  axes pass, producing `LOCAL_CANDIDATE`. This is local closed-loop evidence,
  not independent commercial CAD or manufacturing certification.
- Current repository receipt intentionally remains `HOLD`: no externally
  supplied commercial runtime observation, native deployed worker evidence,
  credential-rotation campaign, or production same-deployment campaign was
  provided.
- Verification so far: commercial runtime and commercialization Node contracts
  `40/40` PASS; release-health Vitest `10/10` PASS; TypeScript PASS; local
  mechanical 30x7 gate PASS; Platform ownership, full source ESLint, and
  TypeScript workspace check PASS.
- Handoff:
  `HANDOFFS/20260824T214459Z-commercial-precision-runtime-release-authority.md`.

## 2026-08-25 commercial payment authority migration 2501

- Status: `LOCAL_PAYMENT_AUTHORITY_CURRENT / STAGING_2501_PENDING / RELEASE_HOLD`.
- Shared migration prerequisite: integration commit `50dca38b` adds checksum-
  bound PostgreSQL migration `2026082501` for `nf_orders.payment_status`,
  `toss_order_id`, and `updated_at`, with payment recovery and Toss identity
  indexes. The SQL passed an actual transaction on the isolated staging restore
  database after the first attempt correctly exposed the missing `updated_at`
  dependency and rolled back.
- Platform implementation commits: `b87a1ac3` advances runner, preflight, live
  readiness, and checksum contracts; `d8b98f4f` advances deploy, migration
  receipt, isolated restore, rollback, release-health, and commercialization
  evidence to latest migration `2026082501`.
- Live readiness now derives required checksum keys from the shared ordered
  registry instead of maintaining a second hard-coded migration list.
- Verification: Node migration/deploy/restore/rollback/commercialization
  contracts `75/75` PASS; Vitest readiness/release/Precision compatibility
  `34/34` PASS; commit-hook related suites `57/57` PASS; full Platform ESLint,
  TypeScript, ownership, and classification checks PASS.
- Boundary: staging currently has verified migrations through `2026082403` and
  hardening blocker count zero, but `2026082501` must be proven through a fresh
  isolated restore target and then applied to the staging source DB. External
  SMTP, observability, payment credentials, trust registries, worker topology,
  and final deployed release evidence remain `HOLD`.
- Handoff: `HANDOFFS/20260824T162808Z-commercial-payment-authority-2501.md`.

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
