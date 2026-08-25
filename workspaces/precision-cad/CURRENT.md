# Precision CAD current session

## 2026-08-25 release-gate-hardened exact-core staging evidence

- Status: `EXACT_CORE_STAGING_SUCCESS / 11_OF_11_PASS /
  POSITIVE_NATIVE_CLOSED_LOOP_NOT_RUN / COMMERCIAL_RELEASE_HOLD`.
- Exact application source/build/Git
  `3797ad6d75f02ad750e746199eb8c041e5d52d9f` is deployed as Railway staging
  deployment `d4718236-06ca-4b56-81c8-5c271b2e8976`, image
  `sha256:bd1364d1121916016d91a19919486d39a053a9ce38db008a05c197f9a20ce2bf`,
  with 2/2 instances `RUNNING`.
- The immutable same-build receipt passed 11/11 exact release, PostgreSQL,
  Redis, migration `2026082502`, packaged runtime-HOLD, forged worker/lease,
  and callback fail-closed checks. Receipt self-hash:
  `59485c350d6aeaa45881ef7e06032836bec330ce2be49c46331fcac9ca03731e`.
- The hardened commercialization gate accepts this as verified staging
  prerequisite evidence and still refuses Private Beta. It cannot replace a
  registered production-class native adapter, separately keyed positive
  closed loop, recovery campaign, independent CAD review, or pilots.
- AI Design remains candidate authority only; only signed, verified Precision
  results may cross the exact-CAD boundary, and manufacturing approval remains
  disabled.
- Handoff:
  `HANDOFFS/20260825T072000Z-release-gate-hardened-staging-evidence.md`.

## 2026-08-25 exact final-source staging HOLD verification

- Status: `FINAL_SOURCE_STAGING_SUCCESS / CORE_AND_FAIL_CLOSED_CHECKS_11_OF_11_PASS /
  POSITIVE_NATIVE_CLOSED_LOOP_NOT_RUN / COMMERCIAL_RELEASE_HOLD`.
- Application source `32ff05ba3f1e7addc5cf6da95d6e94ff9b437fe7` is running in
  Railway staging as deployment `c1e03352-5f95-47eb-a031-80847b22391c` with
  2/2 instances `RUNNING` and image digest
  `sha256:bc2688c5b3c7cc6a34d9cbab9ad0357a87d2b8356d39786319aaf109849fab2a`.
- The exact-release collector passed 11/11 checks: build identity, readiness,
  PostgreSQL, Redis, commercial boundary, HOLD identity, migration
  `2026082502`, packaged runtime HOLD evidence, forged claim/lease rejection,
  and fail-closed callback behavior.
- This is conclusive core staging evidence, not a positive production-class
  native CAD execution. Private Beta and GA remain false until the registered
  worker, separately held keys, recovery campaign, independent CAD review, and
  manufacturing pilots are supplied.
- Receipt:
  `docs/evidence/release/commercial-precision-staging-hold-20260825.json`.
- Handoff:
  `HANDOFFS/20260825T061000Z-final-source-staging-hold.md`.

## 2026-08-25 cross-worktree runtime evidence binding

- Status: `RUNTIME_DERIVATION_DETERMINISTIC / REAL_OBSERVATION_NOT_RUN /
  COMMERCIAL_RELEASE_HOLD`.
- Commercial Precision runtime evidence now canonicalizes UTF-8 CRLF to LF for
  the migration SQL, runtime observation, and all five supporting JSON evidence
  documents before recording byte counts and SHA-256 bindings.
- The signed observation must declare the same canonicalization for its
  migration and evidence manifest. Missing, broadened, raw-byte, or altered
  bindings fail closed.
- A replay contract converts the complete valid runtime evidence set from LF to
  CRLF after receipt creation and verifies the unchanged receipt; semantic
  tampering remains rejected.
- This removes checkout-specific `receipt_derivation_mismatch` only. The local
  checked-in receipt remains an honest HOLD without a separately held HMAC key,
  same-release native worker observation, independent CAD review, or pilots.
- Handoff:
  `HANDOFFS/20260825T051154Z-runtime-evidence-text-binding.md`.

## 2026-08-25 approved native adapter identity closure

- Status: `SOURCE_TRUST_BOUNDARY_PASS / REAL_ADAPTER_NOT_SUPPLIED /
  STAGING_WORKER_NOT_DEPLOYED / COMMERCIAL_RELEASE_HOLD`.
- Commit `7e01ba140bda3daa9f48aa79af76eb59e3dce8a9` binds every signed worker
  receipt to both the native executable SHA-256 and the canonical invocation
  SHA-256 (executable hash plus ordered arguments). The core worker registry
  rejects a valid Ed25519 signature when either approved value differs.
- The worker now verifies the executable bytes before every native process
  launch, carries both bindings in its verification artifact, signed receipt,
  and health response, and separates HTTP 200 `/live` from self-test-gated
  `/health` (`503 NOT_READY` until a canary succeeds).
- `containers/occt-commercial-worker/` is a non-root, fail-closed OCI/Railway
  wrapper. It requires an exact adapter-image digest, executable checksum, and
  worker-source checksum; it does not contain a CAD engine or runtime secret.
- Follow-up commit `58a93bc7f820842a8a2edf4a82c539581ebf2add` removes the
  cross-scope migration allowance: both adapter trust fields are now required
  by the shared receipt contract and the typed trusted-worker registry.
- This closes a source-level substitution gap only. No external adapter image,
  worker private key, positive canary, recovery observation, independent CAD
  review, or manufacturing pilot was created.


## 2026-08-25 exact core staging HOLD verification

- Status: `CORE_STAGING_HOLD_VERIFIED / NATIVE_WORKER_NOT_DEPLOYED /
  PRIVATE_BETA_FALSE / COMMERCIAL_RELEASE_HOLD`.
- Source `d0ae60b6102e90bc0fcef1fa50c425d4d768a989`, Railway staging
  deployment `1839657a-a2ac-4671-aea9-cea408a3811a`, is running 2/2 instances.
- The redacted staging collector passed 11/11 exact release, PostgreSQL, Redis,
  migration, packaged runtime evidence v3 HOLD, forged claim/lease, and
  callback fail-closed checks. The deployed trust contract rejects either
  native executable or invocation substitution even under a valid worker
  signature. Receipt:
  `docs/evidence/release/commercial-precision-staging-hold-20260825.json`.
- This is not a positive exact-worker run. A reviewed checksum-pinned native
  adapter, separately held worker key, positive canary, recovery campaign,
  independent CAD review, experts, and manufacturing pilots remain blockers.
- Operational handoff:
  `docs/operations/commercial-precision-staging-hold-handoff-20260825.md`.
- Workspace handoff:
  `HANDOFFS/20260825T041106Z-adapter-bound-staging-hold.md`.

## 2026-08-25 real local durability and authoritative CAS closure

- Status: `LOCAL_DURABLE_EXACT_CLOSED_LOOP_PASS /
  PRODUCTION_CLASS_NATIVE_AND_EXTERNAL_QUALIFICATION_NOT_RUN /
  COMMERCIAL_RELEASE_HOLD`.
- The commercial v3 source path was executed against disposable real
  PostgreSQL, Redis AOF, and S3-compatible storage with an isolated native
  fixture process. All 24 checks passed, including migration checksum, immutable
  input/output readback, multi-instance exclusion, Ed25519/HMAC verification,
  negative substitution/replay cases, expired-lease quarantine/no-replay,
  credential rotation, authoritative parser persistence, and workspace HEAD
  compare-and-swap.
- A real integration defect was closed: outbox claim previously advanced only
  the job row while the execution journal remained `APPROVED`. Claim and lease
  recovery now update both records and append their journal events atomically,
  so the verified result can reach `COMMITTED`/`DONE` without weakening the
  persistence preconditions.
- Immutable input moved to
  `nexyfab.precision-cad-commercial-input.v2`: mutable claim attempt/generation
  are excluded from the staged object but remain exactly signed in the
  transport/receipt. This removes a normal-flow binding contradiction while
  retaining substitution protection for all immutable job fields.
- The checked-in local receipt is
  `docs/evidence/cad-independent/commercial-precision-local-durability-20260825.json`,
  and `.github/workflows/commercial-precision-durability.yml` reruns the same
  campaign for affected changes and weekly.
- Runtime release evidence v2 additionally requires the registered worker's
  real Ed25519 signature and exact per-check machine assertions. The committed
  release receipt remains honest `HOLD` because there is no current
  release-bound real-worker observation.
- This closes the durable local exact loop, not product qualification. The
  native campaign adapter is a deterministic fixture; independent native-CAD
  exchange/XCAF/GD&T review, real production-class worker, experts, three
  manufacturing pilots, and same-release operations evidence remain required.
- Integration handoff:
  `docs/operations/commercial-precision-local-durability-handoff-20260825.md`.

## 2026-08-25 current-head local evidence and regression closure

- Status: `LOCAL_EXACT_CANDIDATE_PASS / EXTERNAL_QUALIFICATION_NOT_RUN /
  COMMERCIAL_RELEASE_HOLD`.
- Evidence commit `575cfcfb` reruns the bounded mechanical campaign on the
  current integration sources: `30/30` exact features and `210/210` closed-loop
  axes PASS. Its design revision SHA-256 is
  `a361da8b50b3e4b840c04e7bdf7077467580a73242a109090dad13b8f5102e22` and
  receipt SHA-256 is
  `d592a83f044c34560134d69d4be75e6bb6a72e20047e93102813e04c660af2b9`.
- The AI-intent runtime subset also passes `10/10` cases and `70/70` axes with
  source hashes bound to the current `occtEngine.ts` and
  `pipelineManager.ts`.
- Regression commit `6e4c271e` proves the bounded AP242 two-occurrence
  roundtrip preserves geometry, transforms, component names, part numbers, and
  occurrence labels, and adds a negative semantic-loss test. Product identity
  remains `HOLD` because the local binding still lacks
  `STEPCAFControl_Reader` plus reopened XCAF traversal.
- Full local verification passed: Vitest `30,188` tests, Node auxiliary suite
  `616` tests (`5` environment-gated skips), TypeScript, production build,
  `301/301` static pages, and bundle budget.
- This is not independent native-CAD interoperability or manufacturing
  qualification. The committed commercial runtime receipt remains `HOLD`
  until a real isolated native worker, release-bound observations, independent
  reviews, external CAD exchange, and three manufacturing pilots are supplied.
- Immutable handoff:
  `HANDOFFS/20260825T081348+0900-current-head-local-commercial-evidence.md`.

## 2026-08-25 commercial runtime evidence authority

- Status: `LOCAL_30X7_CANDIDATE_PASS / COMMERCIAL_RUNTIME_NOT_RUN /
  RELEASE_HOLD`.
- Integration merge `d22d2723` adds an HMAC-attested commercial Precision
  runtime receipt and requires it in both the offline commercialization gate
  and live `/api/health/release`.
- Private Beta now requires the 15 durable execution and negative-attack
  checks; GA additionally requires five production same-deployment recovery,
  exclusion, no-replay, and credential-rotation checks.
- The current local mechanical campaign is fresh at 30/30 features and 210/210
  axes PASS. Its authority is only `LOCAL_CANDIDATE`; it does not claim
  independent STEP interoperability, expert qualification, or manufacturing
  readiness.
- The committed runtime receipt remains an honest `HOLD` because no real
  native-worker observation/evidence root or evidence signing secret was
  supplied. The next action is the isolated staging worker canary and negative
  campaign described in `docs/operations/commercial-precision-worker-v3.md`.

## 2026-08-25 commercial worker v3 core staging deployment

- Status: `CORE_STAGING_DEPLOYED / WORKER_RUNTIME_NOT_RUN / RELEASE_HOLD`.
- Integration source `674c54f59ec908891962591314366afe0c8eea30` is deployed to the
  isolated staging web/core service as Railway deployment
  `e9286b9d-7d9b-4f45-8404-e4ec838fdbd2`; migration `2026082502` is applied and
  release evidence reports its migration as `PASS`.
- Liveness and non-commercial readiness are HTTP 200 with PostgreSQL and Redis
  `ok`; the v3 artifact gateway rejects a forged lease with HTTP 403
  `LEASE_CAPABILITY_INVALID`. Release health remains HTTP 503 `HOLD`.
- The commercial boundary is intentionally disabled and skipped. A real native
  CAD adapter, isolated worker service, independent worker key holder, and fresh
  canary/self-test receipt still do not exist, so no worker runtime or CAD-engine
  qualification is claimed.
- The exact deployment evidence and activation sequence are recorded in
  `docs/operations/commercial-precision-worker-v3.md`.

## 2026-08-25 commercial worker v3 immutable I/O closure

- Status: `SOURCE_CLOSED_LOOP_PASS / EXTERNAL_RUNTIME_NOT_RUN / RELEASE_HOLD`.
- Integration foundation: `8673bd45` versions the execution contract to
  `nexyfab.precision-cad-commercial-execution.v3` and migration `2026082502`.
- A commercial request now stages one canonical, content-addressed private
  input object and persists its exact identity in the same PostgreSQL
  transaction as approval, journal, claim, and outbox. Exact replay includes
  that input row and fails closed on absence or substitution.
- The authenticated claim route rechecks the immutable input row and object
  hash before returning an HMAC-bound transport. A lease-scoped artifact
  gateway serves the input and accepts only fixed-identity, content-verified
  `model`, `report`, and `verification` output commits.
- `scripts/drawing-to-3d/commercial-precision-worker.mjs` is a deployable Node
  client for claim, input readback, an explicitly configured native executable,
  three immutable output commits, Ed25519 receipt signing, callback HMAC, and a
  fail-closed health contract. It never substitutes a JavaScript geometry
  fallback for the configured native executable.
- Verification: TypeScript PASS; platform architecture PASS; focused worker
  client, contract, route, transaction, and Precision regressions `216/216`
  PASS. The worker test executes a separate native-process fixture, uploads
  exactly three outputs, and independently verifies its Ed25519 PASS receipt.
- Boundary: no real production-class native CAD executable, worker service,
  registry key, or self-test job has been deployed or evidenced. Independent
  STEP/native-CAD interoperability, topology/XCAF/GD&T review, sustained
  recovery evidence, experts, and manufacturing pilots remain required.
- Immutable handoff:
  `HANDOFFS/20260824T202926Z-commercial-worker-v3-immutable-io.md`.

## 2026-08-25 commercial migration compatibility closure

- Status: `CURRENT_MIGRATION_COMPATIBLE / RELEASE_HOLD`.
- Source implementation commit: `06ef2d63` (`[P0] fix(cad): accept current
  commercial migrations`).
- All six commercial generation and verifier entry points now use the shared,
  ordered PostgreSQL migration contract. They still fail closed below required
  migration `2026082208` and for unknown versions, while accepting registered
  later authority migrations through the current target `2026082403`.
- This removes the production incompatibility where a correctly upgraded
  service advertised `2026082403` but Precision routes required literal
  equality with the older `2026082208` value and returned HTTP 503.
- Verification: focused commercial readiness and Precision route regression
  `43/43` PASS, including real OCCT STEP writes; `workspace:check --
  precision-cad` PASS with TypeScript, architecture, ownership, and
  classification checks clean.
- Boundary: the source path is migration-compatible, but commercial release
  remains `HOLD` until staging is migrated, configured, deployed, and proven by
  authenticated multi-instance and recovery exercises plus independent CAD
  interoperability, expert review, and manufacturing pilots.
- Immutable handoff:
  `HANDOFFS/20260824T154924Z-commercial-migration-compatibility.md`.

## 2026-08-24 AP242 semantic identity re-export closure

- Status: `LOCAL_AP242_SEMANTIC_ROUNDTRIP_PASS / RELEASE_HOLD`.
- Source implementation commit: `f727a3dc` (`[P0] fix(cad): preserve STEP assembly identity on re-export`).
- Imported STEP PRODUCT, part number, PRODUCT_DEFINITION, and NAUO occurrence
  identity is now captured independently from the OCCT shape handle. Re-export
  rebinds those fields only when the returned product tree has the identical
  fail-closed structure; unsupported or changed trees block export instead of
  silently replacing product identity with translator defaults.
- The implementation changes no geometry or placement entities. It ignores
  comment-contained fake entities, escapes STEP strings, and verifies the
  rebound semantic graph before returning bytes.
- Verification: pure parser/rebinder tests `4/4`, actual OCCT WASM AP242
  open-export semantic roundtrip `1/1`, existing STEP hierarchy regression
  `32 PASS / 6 conditional skip`, TypeScript PASS, ESLint PASS, and Precision
  workspace ownership/architecture PASS at the source tree.
- Boundary: this closes the previously observed local name/part-number/
  occurrence-label loss. It does not claim XCAF reader availability,
  independent native CAD interoperability, signed external operation, or
  commercial release.
- Immutable handoff:
  `HANDOFFS/20260824T145321Z-ap242-semantic-identity-reexport.md`.

## 2026-08-24 AI exact bridge execution closure

- Status: `EXACT_BRIDGE_RUNTIME_CONNECTED_LOCAL / RELEASE_HOLD`.
- Integrated implementation base: `920e660d` on both `scope/precision-cad` and
  `integration/nexyfab` before this documentation handoff.
- The stable-reference prerequisite now continues through a durable bridge
  worker that rechecks the current canonical head, executes the actual Node OCCT
  current-head artifact bundle, stores STEP/HLR/dimensions/BOM/verification and
  the canonical manifest immutably, and issues a revision-bound signed receipt.
- Dispatch uncertainty does not cause automatic CAD replay. Expired sent work is
  quarantined as `VERIFIED_UNKNOWN` and can close only from an already persisted
  signed receipt and matching AI aggregate reference.
- Verification: actual OCCT STEP bundle regression, bridge tamper/crash/reconcile
  tests, TypeScript, production build, workspace audit, and all three scope
  checks passed at the integrated source baseline.
- Immutable handoff:
  `HANDOFFS/20260824T134514Z-ai-precision-exact-round-trip.md`.
- Remaining: live staging database/object store/Redis/Railway execution,
  authenticated browser round trip, third-party STEP review, topology campaign,
  experts, manufacturing pilots, and release authority. Exact bundle PASS still
  does not imply authoritative CAD commit or manufacturing approval.

## 2026-08-24 commercial-readiness continuation

- Source implementation commit: `5670cb85` (`[P0] feat(cad): bind AI stable refs to canonical head`).
- Added `nexyfab.precision-cad.mechanical-stable-reference-binding.v1` as the
  fail-closed bridge prerequisite for the AI Design V1 handoff. Precision now
  discovers the matching document from server-owned canonical heads and binds
  the exact revision ID, content SHA-256, rights receipt, FeatureTree, part, and
  every requested stable feature ID. The browser/AI does not supply a document,
  sequence, exact receipt, runtime identity, or PASS state.
- Ambiguous document matches, stale/corrupt heads, unknown feature references,
  malformed/extended contracts, and migration absence remain machine-coded
  `HOLD` outcomes.
- Verification: `workspace:check -- precision-cad` PASS (TypeScript and platform
  architecture); focused stable-binding tests `2/2` PASS; canonical revision and
  current-head bundle regression `13/13` PASS including a real OCCT STEP write.
- Remaining bridge work is integration-owned: durable dispatch/outbox, exact
  bundle execution after rebind, Precision signing, immutable receipt storage,
  AI aggregate CAS update, and read-model refresh. Those integration-owned
  items are now implemented locally at `920e660d`; this historical source entry
  still records the earlier `NOT_RUN` boundary and commercial release remains
  `HOLD`.

- Status: `SOURCE_FREEZE_READY / INTERNAL_30_OF_30_BOUNDED / RELEASE_HOLD`
- Source branch: `scope/precision-cad`
- Integration target: `integration/nexyfab`
- Baseline: `baseline/pre-scope-20260823`
- Current integration base: `bd200378` on `integration/nexyfab`; the preserved GP-02 through GP-11 work reapplied without conflicts after the AI V3-V10 merge and awaits its implementation commit.
- Delivered boundary: the clean-room mechanical candidate set is implemented as 30/30 bounded exact handlers. The closing slices are the topology-preserving bounded blind-hole delete/cap repair, the versioned three-point orthogonal rectangular sweep path, and the two-member unfused weldment compound with a hash-bound millimetre cut list. These contracts do not claim general delete-face, sweep, weldment, manufacturing, or commercial completeness.
- Source verification: fixed Node.js 22.23.2/npm 10.9.8 `workspace:check -- precision-cad` passed with zero ownership/classification violations, TypeScript PASS, and architecture PASS. The focused native/registry/sketch/sheet-metal/weldment suite passed 93 tests with one conditional external-corpus skip. The earlier production build result remains pre-integration and must be rerun at the final integrated HEAD.
- Scope preflight: the platform-owned legacy PHP changes are now committed on integration. A generated `mechanical-core-internal-verification.json` containing only sandbox `EPERM` failures was excluded from the source freeze and retained in recovery checkpoints; it is not success evidence.
- Immediate action: freeze and commit only the intended Precision-owned tree, generate a canonical UTC handoff pointing to that implementation commit, validate it, then merge the clean Scope branch once with `--no-ff`.
- Integration acceptance: retain literal v1/v2 schema routing, server-loaded current-head and rights bindings, stable machine tokens, fail-closed unsupported forms, and `authoritativeCommit: false`/`commercialReleaseReady: false`. AI Design may emit only versioned intent and provenance references; it may not manufacture Precision receipts, revisions, artifacts, runtime identity, XCAF results, or release state.
- CI sequencing: run focused Precision tests after the Scope merge, then workspace audit, architecture, type, build, security and database gates. Run the full GitHub CI/E2E only after all planned integration edits are complete. The previously cancelled E2E is not completion evidence.
- Deferred Precision action: begin GP-12 authority-owned CAS commit, stable topology edit/replay survival, and expanded XCAF provenance only after this GP-10 integration intake is frozen and verified; do not mix those new semantics into the GP-10 merge.
- Release: `HOLD` (`authoritativeCommit: false`, `commercialReleaseReady: false`). Integration is development `GO`, but immediate PR merge, staging promotion, production deployment, and Git history rewrite remain `NO-GO` until their independent gates pass.
