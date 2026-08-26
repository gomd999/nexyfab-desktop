# AI Design current session

## 2026-08-26 chat-first model and six-locale closure

- Status: `CHAT_FIRST_ENTRY_CONFIRMED / OPENAI_QWEN_SELECTION_BOUND /
  SIX_LOCALE_WORKSPACE_CONTRACT_PASS / LIVE_PROVIDER_CALL_NOT_RUN`.
- The main design chat already exposes localized starter prompts for attached
  2D drawing to 3D, attached image to 3D, and complex product design. Starter
  and follow-up chips fill and focus the composer without auto-submitting.
- The same entry owns one reviewable attachment control with picker, paste,
  and drag/drop intake; a governed model selector carries its stable model ID
  through chat and CAD requests. OpenAI, Qwen, and DeepSeek provider keys are
  declared in the repository-external environment without exposing values.
- AI Design V10 now has a complete six-language contract for launcher
  metadata, canvas/accessibility labels, linked-selection state, inspector,
  gauge controls, and Precision boundary status. All six selectable model
  descriptions are localized; the provider catalog fallback is English rather
  than leaking Korean into non-Korean clients.
- Focused chat, selector, model policy, launcher, surface, and i18n regression
  passes 7 files / 59 tests. The official scope check passes TypeScript,
  11 files / 62 common-accuracy tests, 7 candidate-manifest tests, and zero
  ownership violations.
- No external model was called and no independent holdout or manufacturing
  qualification was executed. This verifies routing and product behavior, not
  commercial AI accuracy or exact-CAD release readiness.
- Handoff:
  `HANDOFFS/20260826T105555Z-chat-first-model-i18n-closure.md`.

## 2026-08-25 exact downstream deployment-source boundary

- Status: `AI_CANDIDATE_AUTHORITY_UNCHANGED / CLEAN_EXACT_HEAD_REQUIRED /
  DOWNSTREAM_RELEASE_EVIDENCE_INCLUDED / DEPLOYMENT_NOT_RUN /
  COMMERCIAL_ACCURACY_HOLD`.
- Platform implementation
  `cd196e04c88922982f0c34318e6974533fbe4e2b` and Precision handoff
  `d2ff6e90` bind a future verified Railway upload to one clean full Git HEAD,
  all fixed/dynamic release-health source bytes, and zero static module edges
  to repository-external `.env*` files.
- The actual clean-source preflight passed with 10,237 tracked files, 8,034
  parsed JS/TS-family files, all three packaged receipts present and hashed,
  and zero forbidden environment-file imports. Focused regressions pass 15/15;
  Platform quality passes 65 Node and 75 Vitest tests.
- This prevents an incomplete upload from dropping the downstream Precision
  runtime HOLD receipt after an AI candidate is accepted, and prevents local
  developer `.env` bytes from becoming an undeclared build dependency.
  Deployment metadata now includes the exact build ID and
  `source=clean-git-v1`.
- AI authority is unchanged: chat/V9/V10 may create a revision-bound
  `CONCEPT`/`DESIGN_CANDIDATE` and request Precision work, but cannot author
  exact PASS, native worker identity, workspace commit, manufacturing approval,
  or commercial release. No model/holdout campaign or deployment was run;
  external AI accuracy, CAD review, and pilots remain HOLD.
- Handoff:
  `HANDOFFS/20260825T225806+0900-ai-downstream-deployment-source-boundary.md`.

## 2026-08-25 downstream cross-store recovery boundary

- Status: `CHAT_FIRST_REVISION_BOUND_CANDIDATE_CONNECTED /
  PRECISION_DB_AND_OBJECT_RESTORE_PASS / AI_AUTHORITY_UNCHANGED /
  LOCAL_FIXTURE_ONLY / PRIVATE_BETA_FALSE / GA_FALSE`.
- The V9/V10 chat-first workspace, explicit apply confirmation, and
  concept-versus-Precision authority split remain unchanged. A revision-bound
  AI candidate may become an immutable commercial Precision input, but AI still
  cannot author an exact CAD result, worker receipt, workspace commit,
  manufacturing approval, or release decision.
- Shared Platform commits `2c79c2da`, `f6496787`, and `c54e6f60` now restore the complete
  downstream PostgreSQL state and copy every bounded commercial object through
  distinct source, backup, and restore roles. CI commit `acd76c9f` reruns this
  combined recovery campaign for relevant changes and weekly.
- Shared restore receipt:
  `docs/evidence/cad-independent/commercial-precision-cross-store-restore-20260825.json`;
  schema `nexyfab.backup-isolated-restore-drill.v3`, source
  `c54e6f607e13878b0adfcf7b64f9b8c0d9873975`, self-hash
  `575c30ebded3337f0cb9b50e24898bad30ddfd0746b1cb6fffb6c847b85a6b5d`.
- The local drill exactly restored 164 tables/104 rows and 8 objects/8,580
  bytes. Its DB bindings include two immutable inputs, three committed outputs,
  and three artifact snapshots; all source/backup/restored manifests match and
  both sources remain unchanged.
- This verifies downstream recoverability only. It does not call or qualify an
  AI model, prove independent holdout accuracy, execute a production native CAD
  adapter, or certify manufacturing. The receipt is local-fixture and the
  release gate refuses it for promotion. Release-bound restore additionally
  requires an immutable KMS/provider-bound DB backup and a distinct object-
  backup failure domain with versioning, Object Lock retention, and KMS
  readback; staging and production were unchanged.
- Handoff:
  `HANDOFFS/20260825T214338+0900-ai-downstream-cross-store-recovery-boundary.md`.

## 2026-08-25 durable downstream crash-recovery boundary

- Status: `AI_CONCEPT_AUTHORITY_CONNECTED /
  PRECISION_SEPARATE_CLAIM_CRASH_QUARANTINE_PASS /
  THREE_STORE_RESTART_PERSISTENCE_PASS / LOCAL_FIXTURE_ONLY /
  AI_ACCURACY_UNCHANGED / PRIVATE_BETA_FALSE / GA_FALSE`.
- The revision-bound AI handoff remains immutable input to the commercial
  Precision v3 boundary. AI can request Precision execution but cannot author a
  worker receipt, exact CAD PASS, workspace commit, manufacturing approval, or
  commercial release.
- Precision commit `94ad99b6eae22ab5b69f91992785aab8caa97e88` clears expired
  lease owner, expiry, and capability hash atomically with
  `VERIFIED_UNKNOWN` quarantine. Platform campaign commit
  `ad437dbf341b6c9d7643bf4d2e742ba077d0acbf` proves the boundary using a
  second approved and claimed execution with no callback/output side effects.
- Shared v3 durability receipt:
  `docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`;
  29/29 PASS, receipt SHA-256
  `67e1bafac0d4d747d0dd2d8ff1aa7b03d90bff64888a22e352cf714c6ad6d35a`.
- The same exact campaign proves actual disposable PostgreSQL, Redis AOF, and
  object-storage restart persistence plus exact replay with post-restart writes
  prohibited.
- This is downstream source/infrastructure evidence, not AI-model accuracy,
  independent holdout quality, deployed native CAD recovery, external expert
  review, or manufacturing qualification. AI authority remains
  `CONCEPT`/`DESIGN_CANDIDATE`; staging and production were unchanged.
- Handoff:
  `HANDOFFS/20260825T120440Z-ai-to-precision-crash-recovery-boundary.md`.

## 2026-08-25 synthetic v3 cross-worktree evidence closure

- Status: `RAW_SYNTHETIC_EVIDENCE_PORTABLE / AI_ACCURACY_AUTHORITY_UNCHANGED`.
- The first v3 receipt exposed LF/CRLF checkout drift after integration. All
  raw run, source, corpus, and executor bindings now use the exact
  `utf8-crlf-to-lf` policy and verify identically across worktrees.
- Current receipt self-hash:
  `632fd435b31c8f65cd07a1080bf3b02e79588b65a0e3523209043f036648da26`;
  executor identity:
  `b31882c8619eb3908838bde4ed087582600f234ea5307d8c3437da838f18ecd0`.
- Semantic or executor mutation remains rejected. AI-model, independent
  holdout, exact-CAD, and manufacturing authority remain unchanged and HOLD.
- Handoff:
  `HANDOFFS/20260825T082500Z-synthetic-v3-cross-worktree-ai-boundary.md`.

## 2026-08-25 raw synthetic campaign v3 downstream boundary

- Status: `SYNTHETIC_TEMPLATE_REGRESSION_1500_OF_1500_PASS /
  AI_MODEL_NOT_CALLED / COMMERCIAL_ACCURACY_HOLD`.
- The five-domain campaign now contains 1,500 real template-rebuild runs and
  6,000 bound raw assertions instead of accepting repeated PASS booleans.
  Source/raw-evidence commit: `4731d3bc`; receipt self-hash:
  `8b0b0f0f84332d752fe64329d562f2fa7d2769b9762b1a9e91504babd1feea4a`.
- The v3 gate rejects corpus transplants, missing/failed/not-run axes,
  incomplete campaign slots, changed executor sources, stale evidence, and
  release transplants.
- No external AI model was called and no independent holdout was used. This
  verifies deterministic downstream template regression only; it cannot be
  marketed as AI design accuracy or satisfy commercial qualification.
- Handoff:
  `HANDOFFS/20260825T075500Z-raw-synthetic-v3-ai-boundary.md`.

## 2026-08-25 release-gate-hardened downstream staging evidence

- Status: `AI_CONCEPT_AUTHORITY_CONNECTED / EXACT_DOWNSTREAM_STAGING_11_OF_11 /
  NATIVE_AND_EXTERNAL_QUALIFICATION_HOLD`.
- Exact downstream application source/build/Git
  `3797ad6d75f02ad750e746199eb8c041e5d52d9f` is deployed to isolated Railway
  staging as `d4718236-06ca-4b56-81c8-5c271b2e8976`, image
  `sha256:bd1364d1121916016d91a19919486d39a053a9ce38db008a05c197f9a20ce2bf`,
  with 2/2 instances `RUNNING`.
- The immutable same-build receipt passed 11/11 and is independently accepted
  by the commercialization gate. Receipt self-hash:
  `59485c350d6aeaa45881ef7e06032836bec330ce2be49c46331fcac9ca03731e`.
- This proves the integrated AI-candidate-to-Precision core and fail-closed
  staging boundary for this build. It does not promote AI output to exact CAD,
  manufacturing approval, Private Beta, or GA.
- A registered production-class native worker, separate key authority,
  positive/recovery runtime campaign, independent CAD review, and pilots remain
  honest external blockers.
- Handoff:
  `HANDOFFS/20260825T072500Z-release-gate-hardened-downstream-staging.md`.

## 2026-08-25 exact downstream final-source staging HOLD

- Status: `AI_CONCEPT_AUTHORITY_CONNECTED / FINAL_CORE_STAGING_11_OF_11_PASS /
  POSITIVE_NATIVE_AND_EXTERNAL_QUALIFICATION_HOLD`.
- Downstream application source
  `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7` is running in Railway staging as
  deployment `c1e03352-5f95-47eb-a031-80847b22391c`, with 2/2 instances
  `RUNNING` and exact live build identity.
- The staging collector passed 11/11 release identity, PostgreSQL, Redis,
  migration, packaged runtime HOLD, forged claim/lease, and callback
  fail-closed checks.
- This confirms that AI Design candidate input reaches the integrated core
  boundary without gaining exact-CAD or manufacturing authority. AI output
  remains `CONCEPT`/`DESIGN_CANDIDATE`; Private Beta and GA remain false.
- Shared receipt:
  `docs/evidence/release/commercial-precision-staging-hold-20260825.json`.
- Handoff:
  `HANDOFFS/20260825T061000Z-final-source-downstream-staging-hold.md`.

## 2026-08-25 downstream exact-core staging HOLD verification

- AI Design remains revision-bound `CONCEPT`/`DESIGN_CANDIDATE` authority and
  hands immutable input v2 into the Precision commercial v3 boundary.
- The adapter-bound exact core source
  `d0ae60b6102e90bc0fcef1fa50c425d4d768a989` is verified in isolated staging
  at deployment `1839657a-a2ac-4671-aea9-cea408a3811a`.
  Exact release identity, PostgreSQL, Redis, migration, runtime HOLD packaging,
  and fail-closed forged worker paths passed 11/11.
- This validates the downstream core boundary, not a positive native CAD
  result. AI output cannot authorize manufacturing; Private Beta and GA remain
  false until the separately keyed real worker and external qualification are
  evidenced.
- Shared receipt:
  `docs/evidence/release/commercial-precision-staging-hold-20260825.json`.
- Workspace handoff:
  `HANDOFFS/20260825T041106Z-adapter-bound-downstream-staging-hold.md`.

## 2026-08-25 durable AI-to-Precision exact closure

- Status: `AI_CONCEPT_AUTHORITY_CONNECTED / LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS /
  REAL_RUNTIME_AND_EXTERNAL_QUALIFICATION_HOLD`.
- The revision-bound AI handoff now reaches the actual commercial Precision v3
  path through immutable input schema
  `nexyfab.precision-cad-commercial-input.v2`. The immutable payload binds job,
  workspace, command, target, and arguments while claim-owned attempt and lease
  generation remain in the signed transport and worker receipt.
- A disposable real PostgreSQL/Redis-AOF/S3-compatible campaign now passes all
  29 checks: transactional enqueue, multi-instance exclusion, isolated native
  process, three immutable outputs, worker/callback signatures, hostile
  substitutions and conflicting replay, a separate approved claim followed by
  worker-disappearance quarantine, lease recovery/no-replay, key rotation,
  signed parser persistence, authoritative CAD workspace CAS, actual
  persistence-service restart recovery, and exact replay without a second copy
  or execution.
- Claim and expired-lease recovery now update outbox and execution journal in
  one PostgreSQL transaction. This closes the prior impossible state where a
  claimed worker job left its journal `APPROVED` and could never satisfy the
  authoritative persistence coordinator.
- Runtime evidence is versioned to
  `nexyfab.commercial-precision-runtime-evidence.v2`; it verifies the actual
  Ed25519 worker signature against the current public registry and requires an
  exact machine assertion for every promoted check. Local fixture evidence is
  never accepted as staging or production release evidence.
- AI authority is unchanged: AI produces `CONCEPT`/`DESIGN_CANDIDATE` and may
  request Precision work, but cannot author exact PASS, workspace commits,
  manufacturing approval, or commercial release. A real native-worker release,
  independent CAD/expert review, manufacturing pilots, and operations evidence
  remain `HOLD`.
- Integration handoff:
  `docs/operations/commercial-precision-local-durability-handoff-20260825.md`.

## 2026-08-25 six-locale UI and current-head commercial closure

- Status: `AI_DESIGN_SOURCE_CONNECTED / SIX_LOCALE_UI_PASS /
  PRECISION_LOCAL_CANDIDATE_PASS / COMMERCIAL_RELEASE_HOLD`.
- Commit `498ca375` replaces Korean/English-only branches in the unified AI
  Design launcher, client, workspace surface, starter flows, V9 cards, and V10
  integration copy with one `ko/en/ja/zh/es/ar` catalog. Arabic uses the RTL
  surface contract. Focused verification passed `7 files / 59 tests`; the
  related pre-commit suite passed `13 files / 76 tests`.
- Precision evidence commit `575cfcfb` binds the current integration sources to
  the bounded 30-feature/7-axis campaign (`30/30`, `210/210`) and the ten
  AI-intent/7-axis campaign (`10/10`, `70/70`).
- Regression closure `6e4c271e` refreshes the kernel identity and 10,154-file
  secret scan (`0` findings), preserves the bounded STEP occurrence semantics,
  detects semantic tampering, and prevents the topology spike test from
  mutating a checked-in result on an ordinary test run.
- Final local verification: Vitest `2,950` files and `30,188` tests passed;
  Node auxiliary suite `616` passed with `5` environment-gated skips;
  TypeScript and the production Next.js build passed with `301/301` static
  pages and the bundle budget within limits.
- Authority remains unchanged: AI output is `CONCEPT` or
  `DESIGN_CANDIDATE`. No browser/model output can author exact CAD PASS,
  manufacturing approval, or commercial release. Real native-worker staging,
  independent CAD/expert evidence, manufacturing pilots, and operations
  receipts remain required.
- Immutable handoff:
  `HANDOFFS/20260825T081348+0900-ai-design-commercial-source-closure.md`.

## 2026-08-25 Precision commercial evidence consumer closure

- Status: `AI_CONCEPT_CONNECTED / PRECISION_RELEASE_AUTHORITY_FAIL_CLOSED /
  EXTERNAL_EVIDENCE_HOLD`.
- Integration merge `d22d2723` now prevents the AI-to-Precision path from
  borrowing commercial readiness from source tests, local CAD campaigns, or a
  commercial-mode flag. The exact consumer must present the release-bound
  HMAC-attested Precision runtime receipt before release health can pass.
- AI Design remains limited to `CONCEPT` and `DESIGN_CANDIDATE`. It cannot
  author exact PASS, native worker identity, authoritative CAD persistence, or
  manufacturing approval.
- The bounded local Precision campaign passes 30/30 features and 210/210 axes,
  but commercial runtime, independent CAD/expert evidence, and manufacturing
  pilots remain `NOT_RUN`/`HOLD`.

## 2026-08-25 integrated AI-to-Precision staging baseline

- Status: `AI_CONCEPT_RUNTIME_CONNECTED / PRECISION_V3_CORE_STAGING_DEPLOYED /
  EXTERNAL_EVIDENCE_HOLD`.
- All three scopes are integrated on the source line that produced staging build
  `674c54f59ec908891962591314366afe0c8eea30`. The Precision commercial v3 core
  path and migration `2026082502` are deployed in non-commercial staging.
- AI Design V10 remains the chat-first, synchronized 2D/3D producer and sends
  revision-bound Precision requests through the server-authoritative bridge.
  AI output remains `CONCEPT` or `DESIGN_CANDIDATE`; it cannot create an exact
  PASS or manufacturing authority.
- No real commercial native worker/canary or independent external qualification
  exists. Staging release health is therefore HTTP 503 `HOLD`, and production
  was not changed.

## 2026-08-24 AI-to-Precision exact round-trip integration

- Status: `RUNTIME_CONNECTED_LOCAL / EXTERNAL_EVIDENCE_HOLD`
- Implementation base: `920e660d` on both `scope/ai-design` and
  `integration/nexyfab` before this documentation handoff.
- Result: V10 Precision handoff now resolves the server-owned current canonical
  CAD head and stable references, emits V2/V3 revision-bound requests, and
  idempotently enqueues a PostgreSQL-backed exact bridge job.
- Receipt boundary: the AI aggregate accepts only a server-verified signed
  Precision PASS/FAIL receipt whose request, revision, artifact manifest, and
  aggregate reference are digest-bound. Browser-authored PASS and manufacturing
  authority remain impossible.
- Recovery: an uncertain post-dispatch failure becomes `VERIFIED_UNKNOWN` and
  is never automatically re-executed. Reconciliation succeeds only from an
  already persisted immutable receipt plus the exact aggregate reference.
- Validation: bridge/coordinator/worker/route and PostgreSQL authority tests,
  actual Node OCCT current-head bundle execution, TypeScript, focused ESLint,
  production build (301 pages), workspace audit, and all three scope checks
  passed at the integrated source baseline.
- Immutable handoff:
  `HANDOFFS/20260824T134510Z-ai-precision-exact-round-trip.md`.
- Next action: run the real staging PostgreSQL/S3/Redis/Railway round trip and
  authenticated browser read-model refresh, then attach restore, alarm, tenant
  isolation, and multi-instance receipts. External review and fabrication
  evidence remain required before commercial release.

- Status: `V3_V10_SOURCE_FREEZE_READY`
- Branch: `scope/ai-design`
- Baseline: `baseline/pre-scope-20260823`
- Current integration base: `76a69c5d` on `integration/nexyfab`; the preserved V3-V10 work reapplied without conflicts.
- Current task: Freeze the completed V3-V10 AI Design producer, chat-first V9 workspace, and Pre-Precision V10 controller as one scope-owned source commit before real React/Three consumption.
- Integration baseline: V9 handoff `HANDOFFS/20260824T153232+0900-ai-design-chat-first-v9.md`, V10 handoff `HANDOFFS/20260824T164434+0900-ai-design-pre-precision-v10.md`, and integration addendum `HANDOFFS/20260824T170157+0900-ai-design-v9-v10-integration-addendum.md`.
- Current verification: fixed Node.js 22.23.2/npm 10.9.8 `workspace:check -- ai-design` passed with 81 changed paths, zero ownership/classification violations, TypeScript PASS, 62 common-accuracy tests, and 7 candidate-manifest tests.
- Next action: Commit the scope-owned source tree, generate a canonical UTC source-freeze handoff, merge once with `--no-ff`, then bind the real chat + synchronized 2D/3D UI to the V10 controller and run the deferred browser/mobile evidence suite.

## 2026-08-24 additive implementation

- Status: READY_FOR_PRECISION_CAD_CONSUMER_HANDOFF
- Task: Add model selection, direct 3D manipulation planning, safe preview/commit boundary, and headless desktop/mobile AI Design UX contracts.
- Result: AI-owned implementation and tests complete; no Precision CAD files modified.
- Consumer handoff: `HANDOFFS/20260824T043323+0900-ai-design-direct-edit-implementation.md`
- Next action: Precision CAD implements the visual selector/gauge, authoritative CAD execution, durable idempotency, rollback, and exact verification receipt producer against the v1 handoff.

## 2026-08-24 unified AI Design workspace implementation

- Status: READY_FOR_PRECISION_CAD_UI_CONSUMER
- Task: Unify multimodal intent intake, workflow, candidate comparison, gauges, model/change/verification workspace state, mobile recovery, and screen consumption bindings.
- Result: Headless producer contracts, desktop/mobile screen binding, and three executable user scenarios complete; no Precision CAD file modified.
- Validation: 11 targeted files / 59 tests, TypeScript typecheck, workspace scope/ownership check, 11 common-accuracy files / 62 tests, and 7 candidate-manifest tests passed.
- Consumer handoff: `HANDOFFS/20260824T101259+0900-ai-design-workspace-consumption.md`
- Next action: Precision CAD binds its actual React/Three.js components to the view-model and screen contract, then records component/E2E evidence using the three shared scenario IDs.

## 2026-08-24 AI Design runtime v1

- Status: READY_FOR_RUNTIME_CONSUMER_HANDOFF
- Task: Turn the headless workspace contracts into a revisioned, recoverable AI Design runtime with safe multimodal adapters, generation execution stages, comparison/gauge UX, persistence API, action effects, and privacy-safe telemetry.
- Result: Three Luna-owned independent slices were integrated and hardened; AI Design runtime producer and tests complete. Precision CAD and integration-owned files were not modified.
- Validation: 24 relevant files / 117 tests, TypeScript typecheck, workspace scope/ownership check, 11 common-accuracy files / 62 tests, and 7 candidate-manifest tests passed.
- Consumer handoff: `HANDOFFS/20260824T105118+0900-ai-design-runtime-v1.md`
- Next action: Precision CAD implements the React/Three.js consumer and shared browser scenarios; integration adds the authoritative PostgreSQL runtime repository, provider worker adapter, and telemetry sink.

## 2026-08-24 AI Design runtime v2

- Status: READY_FOR_SERVER_COMMAND_AND_UI_CONSUMERS
- Task: Replace client-authored runtime snapshots with bounded server-authoritative commands, connect governed model execution, persist signed evidence and immutable candidate artifacts, add intent graph/question planning and change-impact planning, enforce candidate diversity, and expose an optimized desktop/mobile V2 view-model.
- Result: Bootstrap is server-created, normal mutations use Command V2 + CAS, each generation stage is provider-backed and receipt-bound, final concept candidates publish automatically with exact verification left `NOT_RUN`, unresolved conflicts reach `NEEDS_INPUT`, and no Precision CAD files were modified.
- Validation: Runtime V2 focused suite 13 files / 37 tests; AI Design V1 + V2 regression suite 37 files / 153 tests; TypeScript typecheck and `npm run workspace:check -- ai-design` passed.
- Consumer handoff: `HANDOFFS/20260824T112457+0900-ai-design-runtime-v2.md`
- Next action: Precision CAD binds the V2 view-model/actions to its real React/Three.js UI and exact-verification receipt flow; integration supplies commercial PostgreSQL/artifact/job implementations.

## 2026-08-24 AI Design complex-product v3

- Status: READY_FOR_COMPLEX_PRODUCT_UI_AND_INTEGRATION_CONSUMERS
- Task: Extend the AI Design workspace from flat concepts to complex assembly structure, cross-domain constraints, explicit conflict resolution, hierarchical artifacts/partitions, actual signed conceptual critics, durable job/outbox contracts, assembly gauge/change-heat UX, and executable complex-product scenarios.
- Result: Product/session-bound structure and constraint sidecars, immutable resolution lineage, scalable partitions, seven server-run concept critics, candidate publication critic binding, responsive complex workspace view-model, and machine/tooling/electromechanical golden scenarios are complete. Exact CAD and manufacturing authority remain `NOT_RUN`; no Precision CAD file was modified.
- Validation: 38 AI Design/API test files / 137 tests passed; TypeScript typecheck, workspace scope/ownership check, and diff check passed.
- Consumer handoff: `HANDOFFS/20260824T121704+0900-ai-design-complex-product-v3.md`
- Next action: Precision CAD consumes the V3 read-only view-model and returns separate exact receipts for structure/interface/partition/gauge bindings; integration supplies transactional PostgreSQL/job/outbox/artifact implementations and records round-trip E2E evidence under the three shared scenario IDs.

## 2026-08-24 AI Design V4–V8 scoped roadmap

- Status: PLANNED
- Scope: Future implementation changes are limited to `worktrees/ai-design`; Precision CAD and integration work remain versioned MD dependencies only.
- Master-plan update: `C:\Users\gomd9\Downloads\nexysys_1\nexyfab.com\worktrees\NEXYFAB_MASTER_PLAN.md` Part 0 and Part 16 now distinguish contracts, runtime connection, evidence, and commercial readiness.
- Plan: V4 server-authoritative sidecar/resolution/critic/Precision-receipt loop → V5 rights-safe Concept Cards → V6 bounded MADR → V7 rights-cleared topology retrieval → V8 scale/mobile/accessibility/i18n/evidence.
- Copyright boundary: concepts and independently written engineering rules only; unknown/restricted sources fail closed; no manual text, screenshot, proprietary geometry, or generated TypeScript rule injection.
- Plan handoff: `HANDOFFS/20260824T134337+0900-ai-design-v4-v8-plan.md`
- Planning validation: Master Plan UTF-8/required-section checks and `git diff --check` passed. Workspace check was attempted but preflight-blocked by pre-existing `platform`-owned PHP deletions; this task did not modify or revert them.
- Next action: Verify and implement V4 Command V3 and the authoritative complex-workspace sidecar loop without modifying Precision CAD or integration-owned files.

## 2026-08-24 AI Design V4-V8 implementation

- Status: `AI_SCOPE_IMPLEMENTATION_COMPLETE_EXTERNAL_EVIDENCE_HOLD`
- Scope: V4 server-authoritative complex workflow, V5 rights-safe knowledge, V6 bounded MADR, V7 rights-cleared topology retrieval, and V8 scale/mobile/accessibility/i18n/release-evidence gates are implemented in `worktrees/ai-design` only.
- Runtime result: V4 command/CAS/immutable artifact loop and read API are connected; all three complex-product scenarios traverse the command path; the API returns the V4 model plus V8 renderer-neutral UX contract.
- Copyright result: independent concept metadata and declarative rules only; unknown/restricted sources fail closed; no manual prose, screenshots, proprietary geometry, raw B-rep, or generated executable rule code is embedded.
- Authority result: AI remains concept-only. Exact CAD is request/receipt-bound and otherwise `NOT_RUN`; manufacturing release is always `false`.
- Validation: focused 10 files / 33 tests; full AI Design/API 48 files / 167 tests; typecheck; common accuracy 11 files / 62 tests plus 7 candidate-manifest tests; production build with 298 static pages and bundle budget; diff check all passed.
- Workspace check: attempted and preflight-blocked only by the pre-existing platform-owned deletions `adminlink/index.php`, `public/search.php`, and `public/send-mail.php`; this task did not alter them. Nested checks were run separately and passed.
- Consumer handoff: `HANDOFFS/20260824T145024+0900-ai-design-v4-v8-implementation.md`
- Next action: Integration supplies PostgreSQL/object storage/Redis/durable workers and independent evidence; Precision CAD binds the actual React/Three UI and exact-receipt round trip. Commercial rollout remains `HOLD` until both consumer tracks and external holdouts/pilots are evidenced.

## 2026-08-24 AI Design Chat-first Unified Workspace V9

- Status: `AI_SCOPE_V9_COMPLETE_INTEGRATION_AND_BROWSER_TESTS_DEFERRED`
- Scope: AI Design contracts, orchestration view-model, and owned API only; no Precision CAD or integration-owned React/Three files changed.
- Result: The complex-workspace API now returns one V9 model combining chat-first guidance, executable action cards, model explanation, synchronized 2D/3D semantics, desktop/mobile layout, recovery, and authority boundaries.
- Safety: 2D/3D ambiguity returns `NEEDS_INPUT`; previews do not persist exact CAD; browser-authored PASS and manufacturing release remain impossible.
- Copyright: Independently written concepts/contracts and synthetic scenarios only; no manual prose, screenshots, proprietary geometry, or copied implementation.
- Validation: AI Design/API 55 files / 193 tests; typecheck; common accuracy 11 files / 62 tests; candidate manifests 7/7; production build with 298 static pages and bundle budget; final adjustment typecheck plus 4 files / 15 tests all passed.
- Workspace check: no shared violations or unclassified new paths; preflight blocked only by the existing platform-owned PHP deletions, which were not touched.
- Consumer handoff: `HANDOFFS/20260824T153232+0900-ai-design-chat-first-v9.md`
- Next action: Integrate the V9 producer, bind the actual chat + 2D/3D React/Three consumers, then run the deferred browser/mobile/Precision round-trip scenarios and adjust from evidence.

## 2026-08-24 Pre-Precision Integration Readiness V10

- Status: `AI_SCOPE_V10_COMPLETE_UI_AND_PRECISION_CONSUMERS_DEFERRED`
- Scope: Only AI Design-owned contracts, client orchestration state, deterministic fixtures, and handoff documentation were changed. Precision CAD and integration-owned React/Three surfaces were not modified.
- Result: V9 action cards now adapt into parser-validated V2 server requests, local instructions, nonpersistent concept-preview/apply requests, or a runtime+complex-revision-bound Precision handoff. A renderer-neutral client state and controller coordinate server snapshots, local view state, gauge drafts, preview/apply/reject, stale revisions, connectivity, and explicit server completion.
- Preview boundary: Draft and preview never mutate the authoritative server snapshot. Applying requires explicit confirmation and a matching proposal/server completion. Preview evidence can only report `NOT_RUN`; exact CAD execution, browser-authored PASS, and manufacturing release remain false.
- Consumer readiness: Server source and V9 renderer projection are bound in one validated snapshot. Ten deterministic bounded fixtures cover empty, clarification, generation, three-candidate review, gauge preview, stale, offline mobile, model fallback, Precision pending, and fixture-only non-release Precision PASS.
- Validation: V3-V10 AI Design/API regression `59 files / 210 tests`; V10 focused `5 files / 19 tests`; TypeScript; focused ESLint; common accuracy `11 files / 62 tests`; candidate manifests `7 / 7`; production build `298` static pages and bundle budget all passed.
- Workspace check: Correct branch; no shared violations or unclassified new paths. Preflight remains blocked only by the existing platform-owned deletions `adminlink/index.php`, `public/search.php`, and `public/send-mail.php`, which this task did not modify.
- Consumer handoff: `HANDOFFS/20260824T164434+0900-ai-design-pre-precision-v10.md`
- Next action: Integration binds the actual chat + synchronized 2D/3D React/Three UI to the V10 controller and fixtures, then records desktop/mobile/browser evidence. Precision CAD later consumes only the revision-bound handoff and returns separately signed exact receipts.

## 2026-08-24 integration execution decision (updated after security preflight)

- Status: `PLATFORM_PREFLIGHT_COMPLETE_AI_SOURCE_FREEZE_READY`
- Decision: The immutable V9 handoff remains the chat-first/UI contract baseline. V10 is the required client-state, preview, recovery, and command-controller addendum; integration must consume both rather than implementing V9 alone.
- Security preflight: Complete on integration. The three legacy PHP files are removed, the remaining admin inquiry caller routes to `/admin/inquiries`, and the proxy denies all retired PHP paths. Historical external credentials still require operator-side rotation.
- Integration ownership: Actual React/Three files, preview transport, durable runtime adapters, browser/mobile evidence, and cross-scope wiring are now integration work. AI Design retains concept orchestration and non-exact preview authority; Precision CAD retains exact geometry and signed verification authority.
- Ordered execution: AI V3-V10 source freeze and merge -> Precision CAD source freeze and merge -> V10 controller and ten-fixture UI binding -> preview/apply transport -> browser/mobile/accessibility evidence -> Precision CAD revision-bound round trip -> release-gate reassessment.
- Integration addendum: `HANDOFFS/20260824T170157+0900-ai-design-v9-v10-integration-addendum.md`
