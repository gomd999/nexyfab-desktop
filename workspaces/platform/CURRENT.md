# Platform current session

## 2026-08-25 signed adapter authority and preflight v2

- Status: `PREFLIGHT_V2_EXECUTION_EVIDENCE_SPLIT /
  ED25519_ADAPTER_APPROVAL_REQUIRED / EXECUTION_BLOCKERS_5 /
  EVIDENCE_BLOCKERS_1 / COMMERCIAL_CAMPAIGN_HOLD`.
- Implementation commit:
  `68934b7768a37f3ab1ad7bdc798cd79d824fbbac`.
- Preflight v2 separates `readyToExecute` from
  `readyForFinalVerification`. Missing output artifacts no longer create a
  circular prerequisite before the approved adapter can generate them; unsafe
  existing paths still block execution.
- Adapter import now requires both an operator-pinned SHA-256 and a valid
  Ed25519 approval from a separately registered
  `mechanical-adapter-release-approver`. The approval binds adapter bytes and
  version to the exact workbook `evidenceRootId`, expires within at most 30
  days, and explicitly grants no commercial release.
- Current external root result: workbook 30/30 valid; execution blockers are
  missing three design-verifier roles, adapter, operator pin, release approver,
  and signed approval; the separate evidence blocker is 240 missing case
  files. `readyToExecute=false`, `readyForFinalVerification=false`.
- Verification: direct-design runner/preflight contracts 15/15 PASS, including
  forged/expired/transplanted approval rejection and proof that invalid
  approval prevents adapter import and state creation. Focused script ESLint,
  full Platform ownership, source ESLint, and TypeScript PASS.
- Public contract:
  `contracts/mechanical-design-adapter-approval.schema.json`.
- Handoff:
  `HANDOFFS/20260825T094608Z-signed-adapter-authority-preflight-v2.md`.

## 2026-08-25 mechanical direct-design adapter byte binding

- Status: `ADAPTER_IMPORT_SHA256_BOUND / BYTE_SUBSTITUTION_REJECTED /
  APPROVED_ADAPTER_NOT_SUPPLIED / COMMERCIAL_CAMPAIGN_HOLD`.
- Implementation commit:
  `8347390cd851c0b035f22415f300f499fd0e1b61`.
- Preflight and actual campaign execution now require the regular adapter file
  to match an explicitly approved SHA-256 supplied through
  `--adapter-sha256` or
  `NEXYFAB_MECHANICAL_DESIGN_ADAPTER_SHA256`. The runner verifies the bytes
  before dynamic import, so a path-preserving replacement fails closed.
- Preflight remains non-mutating and does not import the adapter. Its machine
  result now reports actual digest presence, approved-digest configuration,
  and exact match without disclosing verifier private material.
- Current root remains honest HOLD: artifacts 0/240, verifier roles 0/3,
  adapter absent, and approved adapter digest absent. Nothing was synthesized
  to satisfy the new blocker.
- Verification: runner/preflight contracts 11/11 PASS including adapter-byte
  substitution rejection; focused script ESLint PASS; full Platform ownership,
  source ESLint, and TypeScript PASS.
- Handoff:
  `HANDOFFS/20260825T092644Z-mechanical-direct-design-adapter-byte-binding.md`.

## 2026-08-25 mechanical direct-design campaign preflight v1

- Status: `CURRENT_WORKBOOK_30_VALID / REQUIRED_ARTIFACTS_0_OF_240 /
  ROLE_SEPARATED_VERIFIERS_0_OF_3 / TRUSTED_ADAPTER_NOT_SUPPLIED /
  COMMERCIAL_CAMPAIGN_HOLD`.
- Implementation commit:
  `0564bc7a5f681dc40ff1699ac6e9c66a5d1934ba`.
- A fresh pending-only external evidence root now exists at
  `C:\Users\gomd9\Downloads\nexysys_1\nexyfab-commercial-evidence-260825-v4`.
  It contains exactly three workbooks: 30 direct designs, 20 blind challenges,
  and three manufacturing pilots. No STEP, NFAB, drawing, BOM, measurement,
  inspection, signature, state, or release receipt was fabricated.
- `nexyfab.mechanical-direct-design-campaign-preflight.v1` validates the
  current 30-case workbook, all eight artifact roles per case, safe regular
  files under the evidence root, three distinct Ed25519 verifier roles, and an
  explicitly supplied regular adapter file. It never imports or executes the
  adapter and never creates campaign state, evidence, or release authority.
- Current preflight is an intentional fail-closed HOLD: workbook 30/30 valid,
  artifacts 0/240 present, trusted verifier roles 0/3, and adapter absent. The
  preserved `260812` workbook fails current validation because it has no
  `verificationReceipt` artifact path and must not be resumed.
- Verification: direct-design contracts 10/10 PASS, focused script ESLint
  PASS, Platform ownership PASS, full source ESLint PASS, and TypeScript PASS.
  A positive contract also proves `readyToExecute` appears only with all 240
  regular files, distinct role coverage, and an adapter file, without loading
  that adapter.
- Production and staging deployments were not changed.
- Handoff:
  `HANDOFFS/20260825T091525Z-mechanical-direct-design-campaign-preflight-v1.md`.

## 2026-08-25 mechanical intent evidence hierarchy v4

- Status: `INTERNAL_MECHANICAL_CHAIN_BOUND / LOCAL_INTENT_STAGES_PASS /
  COMMERCIAL_DIRECT_DESIGN_NOT_RUN / PRIVATE_BETA_FALSE / GA_FALSE`.
- Implementation/evidence commits:
  `077e20c6f3399fa135dba2086ae69d94dd2fccc0` and final scope-file
  canonical comparison fix `7e91fc08c078d4780ec0ad2a85ac6873fe7f9d20`.
- Every text binding in the 150-case qualification, 10-design/70-axis exact
  runtime, and assembly drawing handoff receipts now uses
  `utf8-crlf-to-lf`. Dedicated CRLF replay tests prove cross-worktree
  portability while semantic or byte-content tampering still fails closed.
- The internal mechanical receipt now binds 171 code, binary, and checked
  evidence files. Product-scope verification rehashes them, requires all six
  commands and all nine internal checks, and invalidates every internal stage
  if one checked evidence byte drifts.
- `mechanical-product-scope-assessment.v4` separates local stages from
  commercial authority. Current PASS: internal regression, 150-input
  qualification, representative 10-design/70-axis exact runtime, local
  assembly handoff, and artifact revision consistency. Current HOLD: signed
  commercial 30-feature closed loop, 10/30 direct design packages, 150-intent
  commercial campaign, standard STEP conformance, 20 blind product challenges,
  and three manufactured pilots.
- Canonical hashes: qualification
  `cb00232c065b50b92a4e82bec220e5395ec86a585151cf07c4dee786f141fee8`;
  current representative runtime
  `d0d70305f6e7575dfa09d4187c7f5f23733619a5df9a889794d95d632937e950`;
  assembly handoff
  `b4d42c43218de614952354cb45b7fa7c69103e827afc4771d3a55e394827633c`;
  internal receipt
  `b179f7f761fd5ee73399ee51550c81152fff443e4fcea63173650b678d5edb6b`;
  v4 scope receipt
  `95d449dd39c5c2d002c2c3681726ba015a447dd949cd69255683040e434d226f`.
- Verification: full internal CAD 137/137, accuracy 49/49, assembly handoff
  11/11, v4/gate/tamper contracts 46/46, commit-related Vitest 38/38,
  final scope portability contracts 8/8, Platform full ESLint and TypeScript
  PASS.
- Deployment note: NexyFab's current staging deployment remains green. The
  historical NexyFab failure was a postbuild failure caused by a missing
  packaged commercial Precision evidence file; release-health HTTP 503 remains
  an intentional commercial HOLD, not a deployment crash. Production was not
  changed.
- Handoff:
  `HANDOFFS/20260825T084100Z-mechanical-intent-evidence-hierarchy-v4.md`.

## 2026-08-25 synthetic receipt cross-worktree closure

- Status: `V3_RAW_CAMPAIGN_VERIFIED / LF_CRLF_DETERMINISTIC /
  COMMERCIAL_CERTIFICATION_FALSE`.
- Integration replay exposed that the first v3 receipt hashed working-tree raw
  bytes and failed after Git materialized LF evidence as CRLF. All campaign,
  source, corpus, and executor bindings now require
  `textCanonicalization=utf8-crlf-to-lf`.
- A dedicated replay converts every bound file to CRLF and verifies the same
  receipt. Semantic/corpus/executor tampering still fails closed.
- Canonicalized source commit:
  `6430d6a8f8b409c2c7d94d38ad02e0e2b77ff10d`; receipt self-hash:
  `632fd435b31c8f65cd07a1080bf3b02e79588b65a0e3523209043f036648da26`;
  executor identity:
  `b31882c8619eb3908838bde4ed087582600f234ea5307d8c3437da838f18ecd0`.
- Handoff:
  `HANDOFFS/20260825T082000Z-synthetic-v3-cross-worktree-canonicalization.md`.

## 2026-08-25 raw synthetic campaign v3 closure

- Status: `RAW_SYNTHETIC_1500_OF_1500_VERIFIED /
  BOOLEAN_ONLY_EVIDENCE_REJECTED / COMMERCIAL_CERTIFICATION_FALSE`.
- The release gate no longer accepts a results file made of repeated
  `requiredGatesPassed: true` booleans. Schema v3 requires exact source/corpus
  identity, four ordered raw assertions per run, complete consecutive campaign
  slots, executor-source bindings, and the immutable receipt hash.
- The real deterministic template-rebuild evaluator ran 100 cases across five
  domains, 3 campaigns, and 5 repeats: 1,500/1,500 runs and 6,000/6,000 raw
  required-axis observations passed.
- Bound source/raw-evidence commit:
  `4731d3bc669bed442132e56b3afd28496014c02b`; receipt self-hash:
  `8b0b0f0f84332d752fe64329d562f2fa7d2769b9762b1a9e91504babd1feea4a`;
  executor identity:
  `86510a680a4f337a018c0df7e16051f28df993c1a43d0a09cffd41437704df01`.
- This closes a local raw-evidence weakness only. The receipt explicitly cannot
  certify commercial accuracy or replace independent holdout/native-CAD review,
  and its local deployment identity cannot satisfy an exact production release.
- Handoff:
  `HANDOFFS/20260825T074500Z-raw-synthetic-campaign-v3.md`.

## 2026-08-25 release-gate-hardened staging success

- Status: `EXACT_HARDENED_SOURCE_STAGING_SUCCESS /
  IMMUTABLE_STAGING_RECEIPT_VERIFIED / PRIVATE_BETA_FALSE / GA_FALSE /
  PRODUCTION_UNCHANGED`.
- Exact application source/build/Git
  `3797ad6d75f02ad750e746199eb8c041e5d52d9f` is deployed to isolated Railway
  `staging` as `d4718236-06ca-4b56-81c8-5c271b2e8976`, image
  `sha256:bd1364d1121916016d91a19919486d39a053a9ce38db008a05c197f9a20ce2bf`.
  Railway reports `SUCCESS` with 2/2 instances `RUNNING`.
- The same-build immutable receipt passed all 11 exact release, PostgreSQL,
  Redis, migration, runtime-HOLD, forged-claim/lease, and callback fail-closed
  checks. Canonical receipt self-hash:
  `59485c350d6aeaa45881ef7e06032836bec330ce2be49c46331fcac9ca03731e`.
- The commercialization gate independently verified the receipt and removed
  `core_staging_hold_not_verified`. Private Beta remains false with 18 honest
  blockers because production release identity, recovery/operations evidence,
  a production-class native worker, independent CAD review, and pilots are not
  present.
- The receipt and handoff are post-deployment evidence. Their Git commit will
  be newer than application source `3797ad6d`; that evidence-only commit is not
  a different deployed application binary and must not be relabelled as one.
- Production was not deployed, restarted, reconfigured, or written.
- Handoff:
  `HANDOFFS/20260825T071500Z-release-gate-hardening-staging-success.md`.

## 2026-08-25 production identity and immutable staging receipt gate

- Status: `RELEASE_TARGET_BOUND / STAGING_RECEIPT_IMMUTABLE /
  CURRENT_STAGING_SOURCE_HISTORICAL / COMMERCIAL_RELEASE_HOLD`.
- Release baselines and commercial security receipts now bind
  `environment=production` and `service=nexyfab.com`. Staging deployment IDs or
  another Railway service can no longer satisfy production release identity.
- The exact-core staging HOLD receipt now carries a canonical self-hash and has
  an independent verifier for freshness, isolated origin, release identity,
  the exact 11 checks, response bindings, and the non-promoting claim boundary.
- The commercialization gate consumes that receipt and reports
  `core_staging_hold_not_verified` when it is missing, stale, edited, or from a
  different build. A valid staging HOLD is a prerequisite only; it never grants
  Private Beta or GA.
- Historical source `32ff05ba` was recollected successfully: 11/11 PASS, receipt
  self-hash
  `b6cba9a6b285eb0f42564e0471470d942745b0609ce83d39c57e496de607392c`.
- The hardened integrated source was subsequently deployed and recollected as
  recorded in the current section above. Production remains unchanged.
- Handoff:
  `HANDOFFS/20260825T063500Z-release-environment-staging-receipt-binding.md`.

## 2026-08-25 final integrated HEAD staging verification

- Status: `FINAL_HEAD_STAGING_SUCCESS / STAGING_HOLD_11_OF_11_PASS /
  PRIVATE_BETA_FALSE / GA_FALSE / PRODUCTION_UNCHANGED`.
- Final integrated source/build/Git
  `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7` is deployed to isolated Railway
  `staging` as `c1e03352-5f95-47eb-a031-80847b22391c`, image digest
  `sha256:bc2688c5b3c7cc6a34d9cbab9ad0357a87d2b8356d39786319aaf109849fab2a`.
- Two instances are RUNNING. `/ready` passes and `/live` reports the exact final
  HEAD. The verified deployment path passed workspace audit, architecture,
  production build, TypeScript, 301/301 static generation, and bundle budget.
- The redacted collector passed all 11 PostgreSQL, Redis, migration, exact
  release identity, packaged runtime HOLD, forged claim/lease, and callback
  fail-closed checks. Commercial mode remains off and release health remains
  intentional HTTP 503 `HOLD`.
- Production was not deployed, restarted, reconfigured, or written.
- Handoff:
  `HANDOFFS/20260825T060034Z-final-head-staging-hold.md`.

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
