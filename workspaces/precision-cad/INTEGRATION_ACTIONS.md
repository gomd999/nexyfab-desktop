# Precision CAD integration actions

These changes are required by the repository audit but target integration-owned
paths. They must be applied from `integration/nexyfab`, not from this Scope
branch.

## 2026-08-25 durable local closure and external promotion boundary

The integration-owned source/infrastructure gap is now closed locally:

- [x] Bind immutable input v2 to stable job/workspace/command/target/arguments
  while keeping attempt and lease generation in signed claim state.
- [x] Atomically advance outbox plus execution journal on worker claim and
  expired-lease recovery.
- [x] Run real versioned migrations and the complete v3 route/worker/persistence
  path against disposable PostgreSQL, Redis AOF, and immutable S3-compatible
  storage.
- [x] Prove all 24 local durable checks, including authoritative parser
  persistence, workspace HEAD CAS, hostile substitutions/conflicting replay,
  verified-unknown no-replay, key rotation, and exact persistence replay.
- [x] Add a path-filtered and weekly CI workflow for the same containerized
  campaign.
- [x] Upgrade runtime receipt derivation to v2 with registry-bound Ed25519
  verification and exact per-check assertion provenance.
- [x] Canonicalize the migration SQL, runtime observation, and five supporting
  JSON bindings as UTF-8 CRLF-to-LF so one signed observation verifies across
  Windows worktrees without accepting semantic changes.

The promotion work remains external and release-bound:

- [ ] deploy the exact final commit to isolated staging with a reviewed,
  production-class native CAD adapter and separately held worker private key;
- [ ] capture all five runtime evidence documents from that same deployment and
  derive a fresh Private Beta receipt v2;
- [ ] repeat the GA recovery matrix on the same production deployment after
  explicit approval;
- [ ] collect independent CAD/XCAF/GD&T, expert, three manufacturing-pilot,
  security/legal, restore/rollback, and seven-day operations evidence;
- [ ] keep production commercial/manufacturing authority disabled until those
  external receipts pass. The local fixture receipt is not eligible for
  promotion.

## 2026-08-25 current-head source integration closure

The source-side actions are closed at commits `498ca375`, `575cfcfb`, and
`6e4c271e`:

- [x] Bind the six-locale AI Design workspace to the revision-bound Precision
  handoff without granting AI exact or release authority.
- [x] Refresh the 30-feature/7-axis (`210/210`) and ten-intent/7-axis (`70/70`)
  evidence against the current integration implementation.
- [x] Preserve bounded AP242 occurrence geometry and semantic identifiers and
  retain an explicit XCAF reopen capability `HOLD`.
- [x] Pass the complete local Vitest, Node, TypeScript, production build, and
  bundle-budget verification.
- [x] Refresh kernel identity and scan 10,154 Git candidate files with zero
  secret findings.

The remaining actions require external systems or independent people and are
not satisfiable by another local source test:

- [ ] deploy the exact current source to isolated non-commercial staging with
  the real native CAD worker and separately held Ed25519/HMAC keys;
- [ ] execute the 15 private-beta checks and five same-deployment GA recovery
  checks, including replay, substitution, lease, crash, and rotation cases;
- [ ] complete independent STEP/native-CAD/XCAF/GD&T review, 20 blind
  challenges, three manufacturing pilots, and expert signatures;
- [ ] bind distributed Redis quota, SMTP/Sentry/payment, restore/rollback,
  security/legal, and seven-day operations/cost evidence to one release;
- [ ] keep production commercial mode and manufacturing release disabled until
  every required receipt passes for that exact release.

## 2026-08-24 exact bridge integration reconciliation

The following previously open cross-scope implementation items are complete at
integrated source head `920e660d`:

- [x] Persist the AI-to-Precision handoff in a PostgreSQL transactional outbox
  with immutable identity, lease, idempotency, and append-only receipts.
- [x] Rebind the request to the server-owned current canonical head and stable
  features before dispatch.
- [x] Execute the real current-head Node OCCT bundle and bind STEP, HLR drawing,
  dimensions, BOM, verification, and manifest to the same revision.
- [x] Store exact artifacts under private content-addressed immutable keys and
  reject differing overwrites.
- [x] Issue and verify signed PASS/FAIL receipts and record only server-accepted
  receipts into the AI aggregate/read model.
- [x] Quarantine uncertain sent work as `VERIFIED_UNKNOWN` and reconcile from
  persisted evidence without a second CAD execution.
- [x] Add an authenticated scheduled worker route, Railway cron schedule,
  readiness checks, migration/deploy contract tests, and scope ownership.
- [x] Fast-forward all three scopes to the integrated head and pass integration
  status, workspace audit, and all three scope checks.

These source items do not close the operational or commercial actions below.
The next integration sequence is:

- [ ] apply and verify migration `2026082403` on staging PostgreSQL, then prove
  restore and repeat application;
- [ ] run the exact flow against the real private object bucket and verify
  immutability, retention, access denial, and hash readback;
- [ ] prove Redis/multi-instance behavior plus Railway cron/worker restart,
  lease, alarm, and unknown-state reconciliation;
- [ ] record authenticated browser E2E and hostile tenant/stale/tamper cases;
- [ ] run third-party STEP interchange, OCCT burn-in, topology-survival, domain
  campaign, expert, fabrication, and pilot evidence;
- [ ] keep release and manufacturing authority on `HOLD` until those receipts
  bind to the same committed revision.

## 2026-08-24 Precision GP-10 integration resumption gate

This section is the operational entry point for the next integration session.
It complements `docs/operations/integration-ci-pause-handoff-20260824.md` and
does not supersede its security, CI, E2E, deployment, or history-rewrite holds.
Additional integration development is allowed; immediate PR merge, staging,
production, and history rewrite are not authorized by the Precision handoff.

### Phase A: freeze the Scope source

- [ ] Preserve the existing integration PR/CI state before importing Precision.
  Do not describe the cancelled E2E as passed and do not rerun the final full
  suite until the last planned integration change is present.
- [ ] Resolve ownership for `adminlink/index.php`,
  `docs/evidence/cad-independent/mechanical-core-internal-verification.json`,
  `public/search.php`, and `public/send-mail.php`. They are platform-owned
  changes currently visible from the Precision worktree and must not be hidden
  inside a Precision commit merely to make the check green.
- [ ] Review and commit the complete intended Precision-owned change set on
  `scope/precision-cad`. The current base HEAD
  `04d39ea9227b382ec40508b6d6f601a0115fe103` does not contain the uncommitted
  GP-10 implementation and is not an integration source commit.
- [ ] Run `npm run workspace:check -- precision-cad` and
  `npm run workspace:handoff:check -- precision-cad` at the frozen commit.
  Require zero shared, foreign, and unclassified-path violations.
- [ ] Create a new immutable source-freeze receipt containing the full commit,
  changed-path manifest, exact schema identifiers, test/build results, known
  skips, external blockers, and rollback point. Do not rewrite the original
  GP-10 evidence to simulate a clean source commit.

### Phase B: merge and bind

- [ ] From the clean `integration/nexyfab` checkout, run
  `npm run workspace:integration-status`, inspect the new Precision receipt,
  and merge `scope/precision-cad` once with
  `git merge --no-ff scope/precision-cad`.
- [ ] Keep the mechanical artifact v1 and FeatureTree v2 schemas and routes
  version-isolated. Reject unknown versions and silent v1/v2 upgrade,
  downgrade, or fallback before invoking Precision.
- [ ] Make the integration/AI adapter submit only authenticated path identity,
  versioned intent, approval reference, and provenance/evidence references.
  Never accept a caller revision triplet, exact receipt, registry/runtime
  identity, B-Rep/STEP bytes, HLR/BOM/cut-list output, XCAF result, commit state,
  or release state.
- [ ] Preserve server-loaded current-head, rights receipt, registry, runtime,
  STEP, bundle manifest, and XCAF same-revision bindings. A mixed-revision or
  stale artifact set must invalidate every downstream drawing, BOM, estimate,
  qualification, and agent result.
- [ ] Preserve all bounded negotiation literally, including the fixed
  delete-face set, sweep-path frame/transition, weldment two-solid compound and
  negative authority tokens, planar-face-only sketch exactness, and unsupported
  broad FeatureTree aliases.
- [ ] Keep the GP-12 durable commit/topology/XCAF/PMI work separate. GP-10
  integration must leave `authoritativeCommit: false` and
  `commercialReleaseReady: false` unchanged.

### Phase C: integrated verification and final CI

- [ ] Run the focused native OCCT, runtime, registry, sketch, sheet-metal, and
  weldment suite at the merged HEAD; the Scope baseline is 93 passed and one
  conditional external-corpus skip.
- [ ] Run TypeScript and the production Next.js build. Treat the current
  `REDIS_URL` warning as an unresolved production multi-instance readiness item,
  not a successful Redis deployment check.
- [ ] Run `npm run workspace:audit`,
  `npm run platform:architecture:check`, the Precision verification script,
  and the mechanical contract/scope release gates. Record an intentional
  external-evidence `HOLD` without relabelling it as a test failure or pass.
- [ ] Add hostile cross-scope tests for stale revision/CAS, tenant mismatch,
  changed intent on retry, schema substitution, receipt/STEP/XCAF tamper,
  missing native runtime, preview fallback, unsupported aliases, mixed
  revisions, and AI attempts to supply authority-owned fields.
- [ ] After every planned integration, CI, database, security, and adapter edit
  is complete, run the full GitHub CI and E2E at the final commit. The prior
  cancelled run is not reusable evidence.
- [ ] After a green final integration run, execute the integration/main-only
  large-assembly benchmark, OCCT B-Rep burn-in, full milestone verification,
  backup/bundle verification, and rollback drill required by the operations
  handoff.

### Integration acceptance decision

The merge is accepted only when the frozen source commit is traceable, Scope
ownership is clean, exact schema parity is proven, hostile tests remain
fail-closed, and final integrated checks are current. This acceptance permits
continued controlled development only. Production release remains `HOLD` until
credential rotation, private worker and Redis configuration, independent
exchange/authority/reviewer evidence, localization and operations review, and
the required real pilots are bound to the same committed revisions.

## P0 credential remediation

- [ ] Revoke and rotate the server-side reCAPTCHA credential currently embedded
  in `public/send-mail.php`. Code deletion does not revoke an already copied key.
- [ ] Delete `public/send-mail.php`; the supported endpoint is
  `src/app/api/send-mail/route.ts`. Keep the legacy-script deny rule and its proxy
  regression test until all deployment surfaces have been checked.
- [ ] Inspect Git history and deployed static artifacts after rotation. Rewrite
  history only through an explicit repository-owner operation.
- [ ] Change `scripts/scan-secrets.mjs` from the `src/scripts/security` allowlist
  to all tracked text files. Skip binary/generated artifacts by content and size,
  not by omitting `public`, `containers`, `services`, `workers`, or docs.
- [ ] Add a fixture proving a reCAPTCHA-style server secret under `public/` is
  detected. Never put a real credential in the fixture.

Completion evidence: rotated credential identifier/date, full tracked-file scan
receipt, no secret value in the current tree, and confirmation that supported
mail requests use only environment-bound credentials.

## Security evidence correctness

- [ ] Resolve the 2026-08-24 read-only check results recorded by Precision:
  `SECRET_SCAN_EVIDENCE_STALE`, `DEPENDENCY_AUDIT_INCOMPLETE:UNKNOWN`, and
  `THIRD_PARTY_NOTICES_STALE` (685 expected packages). Regenerate evidence only
  after the underlying scans/audits/notices genuinely pass.
- [x] In `scripts/build-dependency-audit-evidence.mjs`, preserve a stale/missing
  evidence failure. The final `report.status` assignment currently overwrites
  `process.exitCode = 1` from the freshness check. Closed 2026-08-25 by
  combining evidence freshness and live audit status in the final exit code.
- [ ] Refresh dependency, secret, supply-chain, and route-security receipts only
  after the scanners pass. Do not change timestamps by hand.
- [ ] Run both production-only and complete dependency audits in integration CI.

## Precision CAD CI ownership

- [ ] Extend `.github/workflows/modular-platform-boundaries.yml` path filters with:
  `src/app/[lang]/shape-generator/**`, `src/lib/cad/**`, `src/lib/cad-ir/**`,
  `src/lib/occt/**`, `src/lib/sketch/**`, `src/lib/assembly/**`,
  `scripts/drawing-to-3d/**`, `containers/occt-*/**`, and
  `capabilities/precision-cad/**`.
- [ ] Run `npm run workspace:check -- precision-cad` and
  `node workspaces/precision-cad/verify.mjs` in that job.
- [ ] Shard the broad Precision Vitest roots and give every shard a workflow
  `timeout-minutes`. Keep `critical`/`major` reference findings blocking; use
  `--report-findings` only for non-release investigation artifacts.
- [ ] Add coverage thresholds for contract, selection/topology, persistence, and
  worker-boundary code before enabling a repository-wide percentage target.

## Shared runtime and onboarding

- [ ] Pin Node 22 and the repository npm version with `.node-version` (or Volta)
  plus `packageManager` in `package.json`.
- [ ] Replace the create-next-app README with architecture, Scope workflow,
  required services/environment variables, bounded checks, and release-gate
  semantics.
- [ ] Make Redis-backed rate limiting a production readiness requirement for
  multi-instance deployment; in-memory fallback is development-only.
- [ ] Run the main application image as a non-root user after assigning writable
  data directories explicitly.
- [ ] Split or lazy-load the dashboard/design entry bundles before the current
  first-paint budget becomes a hard build failure.

## Shared contract graduation

- [ ] After this Scope handoff is integrated, move the capability-owned
  `mechanical-single-part-candidate.v1` declaration into a versioned shared
  package in a dedicated integration commit. Keep both the capability service
  and the legacy CAD adapter importing that single package.
- [ ] Wire the production deployment values so `JOB_CONTROL_URL` targets the
  shipping `job-orchestrator` service and `EXACT_KERNEL_URL` targets
  `occt-exact`. The legacy environment names may remain during migration, but
  the observable service identities must match the readiness contract.

## External release evidence

The missing feature-axis, STEP conformance, blind challenge, and manufactured
pilot receipts cannot be generated from code alone. Release remains HOLD until
real reviewed artifacts satisfy `mechanical:contracts:check` and
`mechanical:scope:check`; never fabricate or timestamp-refresh those receipts.

## General-purpose Agentic CAD cross-scope handoff

The following actions support
`GENERAL_PURPOSE_AGENTIC_CAD_MASTER_PLAN.md`, but are documentation-only requests
from this Scope. They must not be implemented on `scope/precision-cad`.

### Integration-owned contract and platform actions

- [ ] Graduate the Precision-owned consumer draft into versioned shared
  intent/tool/command/artifact contracts under an integration decision. Preserve
  schema hash, compatibility policy, and migration fixtures.
- [ ] Provide shared job, artifact, cancellation, identity, RBAC, retention, audit,
  and queue contracts without allowing AI Design to mutate Precision state
  directly.
- [ ] Require preview, approval, commit, verification receipt, stale propagation,
  idempotency, and rollback semantics at the shared boundary.
- [ ] Add integration CI that proves emitter/consumer contract parity and refuses
  unknown schema versions or silent fallback.
- [ ] Keep unresolved platform/security items attached to external blocker IDs;
  Precision features that depend on them remain `HOLD` until current evidence is
  linked.

### Canonical CAD v2 production migration

- [ ] Add the versioned production migration receipt
  `2026082401` for the Precision-owned GP-03 consumer. The migration itself and
  readiness configuration remain integration-owned; the Precision request path
  must never create or alter these tables at runtime.
- [ ] Create immutable `nf_cad_canonical_v2_revisions`, single-head
  `nf_cad_canonical_v2_heads`, durable
  `nf_cad_canonical_v2_invalidations`, authority-owned
  `nf_cad_canonical_v2_locks`, and append-only
  `nf_cad_canonical_v2_audit` tables. Preserve the column contract exercised by
  `canonicalCadRevisionStore.sqlite.test.ts` and the v2 revision route tests.
- [ ] Enforce database uniqueness for project/document revision ID, sequence,
  command ID, idempotency key, and one compensation per target command. Enforce
  one lock ID per project/document and one audit receipt hash per commit.
- [ ] Add indexes for head lookup, dependency/compensation lookup, live lock
  loading, invalidation consumers, and chronological audit review. Add tenant/org
  isolation in the integration migration without weakening the Precision
  project/document bindings.
- [ ] Publish the reviewed migration checksum through
  `CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM` and add it to production readiness
  checks. A missing version, checksum mismatch, or missing table must return
  `MIGRATION_REQUIRED`/HTTP 503; it must not trigger request-time DDL.
- [ ] Bind lock writes to the existing authorization service and make expiry or
  release explicit in the shared authority contract. The v2 commit API only
  reads the current authority lock set and never trusts a client-supplied lock
  snapshot or execution timestamp.
- [ ] Connect durable invalidation rows to exact geometry, native document,
  analysis, drawing, quantity, exchange, and qualification consumers with
  at-least-once delivery and idempotent acknowledgements. Do not clear a stale
  state merely because a downstream notification was attempted.

Acceptance evidence: migration up/down review and checksum, PostgreSQL and
SQLite transaction fixtures, concurrent full-triplet CAS race, exact idempotent
replay, rollback with no orphan revision when audit/invalidation fails, tenant
isolation, backup/restore, and a production readiness probe. This request does
not authorize a migration change from `scope/precision-cad`.

### AI Design-owned actions

- [ ] Emit a versioned, machine-coded CAD intent envelope with ambiguity,
  assumptions, requested scope, budget, and provenance; do not emit direct
  database or kernel mutations.
- [ ] Consume Precision tool descriptors and risk/approval requirements, while
  treating Precision receipts as the authoritative execution result.
- [ ] Localize explanations separately from machine-coded tool arguments and
  never infer success from a translated narrative.
- [ ] Preserve model, prompt, retrieval, reference-rights, tool, and output
  provenance needed by Precision qualification.

### GP05 exact OCCT AI-consumer binding (integration/ai-design only)

The following five AI-owned exact consumers were identified by the GP05
registry audit. Apply these changes only from `integration/ai-design`; do not
edit the `src/lib/ai` implementations from `scope/precision-cad`:

- [ ] Bind `src/lib/ai/architectureInteriorExactGeometry.ts`,
  `src/lib/ai/assemblySelectionEditBrepEvidence.ts`,
  `src/lib/ai/design-driver/curvedGate.ts`,
  `src/lib/ai/exactCadGate.ts`, and `src/lib/ai/holeGate.ts` to the verified
  `loadOcctNode()` result. Each consumer must pass the returned
  `loaded.identity` directly into its exact-runtime decision; do not recreate,
  downgrade, or accept a caller-supplied identity.
- [ ] Require the commercial preflight and feature-registry receipt at every
  exact-consumer boundary. The receipt must bind the requested canonical
  feature IDs, planned command/handler decisions, verification IDs, and the
  registry snapshot hash to the loaded runtime identity before any exact OCCT
  call. Preview, unsupported, unknown, stub, or fallback-only entries are not
  eligible for these consumers.
- [ ] Preserve these four identity fields as an immutable, machine-readable
  binding in the receipt and consumer audit record:
  `runtimeIdentitySha256`, `glueSha256`, `wasmSha256`, and `registryHash`.
  `runtimeIdentitySha256`, `glueSha256`, and `wasmSha256` must come from the
  verified `loaded.identity`; `registryHash` must come from the exact
  feature-registry receipt used by commercial preflight.
- [ ] Return `HOLD` before invoking OCCT when `loadOcctNode()` fails, its
  verified `loaded.identity` is absent or incomplete, any of the four fields is
  missing or mismatches the receipt/configured artifact, the registry hash is
  stale/unknown, or the commercial preflight is not `PRECHECK_PASS`. Also hold
  on any `plan.unsupported`, `embeddedChildNodes`, command-op/handler mismatch,
  missing handler/verifier, non-single terminal, stale runtime identity, or
  `occtIsStub` condition. No legacy exact path, mesh preview, or silent
  fallback may convert one of these holds into success.
- [ ] Add integration/AI-design acceptance fixtures for all five consumers:
  one positive case proving the exact same four identity fields flow from
  `loaded.identity` through the commercial preflight/feature-registry receipt,
  plus negative cases for each missing/mismatched field, stale `registryHash`,
  preflight `HOLD`, preview/unsupported/unknown feature, stub runtime,
  handler/verifier omission, command mismatch, embedded node, and terminal
  mismatch. Assert that every negative case makes zero exact OCCT calls and
  emits a machine-coded HOLD receipt. Add a parity test that the five
  consumers reject a changed registry hash or loaded identity even when the
  human-readable explanation is unchanged.

### Shared/global i18n actions

- [ ] Decide global locale routing and shared catalog ownership for `ko`, `en`,
  `ja`, `zh`, `es`, and `ar`; Precision will keep only its owned local catalogs
  and adapters until that decision lands.
- [ ] Publish shared message-ID naming, ICU placeholder, English fallback,
  missing-key reporting, and locale-version compatibility policies.
- [ ] Define shared number/unit/date/timezone formatting APIs that never alter
  canonical CAD values.
- [ ] Qualify Arabic RTL behavior and shared logical-layout primitives without
  mirroring controls whose CAD meaning must remain spatially fixed.
- [ ] Approve Unicode shaping, font embedding/subsetting, font-license, project
  language, and bilingual drawing/PDF export policies.
- [ ] Track translation provenance, terminology reviewers, locale-specific
  qualification status, and marketing claims independently for each locale.

### GP08 legacy agent truth hardening (integration/ai-design only)

- [ ] Replace the permissive generic success predicate in the AI-owned
  precision-agent controller. `null`, strings, empty objects, `{ok:true}` without
  a versioned receipt, and `{status:'HOLD'}` must not complete CAD validation.
- [ ] Make the AI-owned agent panel distinguish agent-turn completion from CAD
  verification. Missing execution status must render `NOT_RUN/HOLD`, never a
  default success state.
- [ ] Emit the exact versioned `agenticCadContract` envelope consumed by the
  precision-owned summary. Bind plan, dry-run receipt, policy receipt, preview,
  base revision/content hash, lock-set hash, registry hash, and expiry. Do not
  emit authoritative commit or release PASS from the browser controller.
- [ ] Harden AI-owned architecture/interior and review-queue consumers so
  `{ok:true}` without exact evidence cannot become PASS and an empty gate array
  cannot enable approval. Translate stable machine blockers instead of exposing
  raw result strings or exception messages.

Acceptance evidence: hostile/partial result fixtures, stale revision/lock/
registry/expiry fixtures, six-locale UI tests, and a cross-scope test proving a
generic completed run stays `NOT_RUN/HOLD` in CAD truth.

### GP09 authoritative product-qualification binding

- [ ] Provide a tenant/project-scoped read contract for an immutable product
  qualification receipt and its authority/deliverable manifests. The server,
  not the browser or AI Design, must load the current canonical revision ID,
  sequence, and content hash used for comparison.
- [ ] Add a server-side serializer for the exact
  `nexyfab.precision-cad.product-qualification-view.v1` envelope. It must run
  the Precision receipt evaluator first and bind project, domain, revision,
  CAS sequence, content/artifact/receipt hashes, blocker codes, and expiry. Do
  not send raw evaluator, database, exception, AI, or user-provided strings.
- [ ] Do not reuse `POST /api/cad/v1/product-qualification` contract/pipeline
  `PASS` as receipt qualification. Introduce a separately versioned receipt
  evaluation/read mode or endpoint with authorization, current-revision lookup,
  immutable evidence retrieval, rate limits, audit, and stale propagation.
- [ ] Bind architecture/interior artifact-bundle hashes and later civil,
  landscape, and mechanical deliverable manifests to the same canonical
  revision. A successful exact/artifact request cannot promote
  `PRODUCT_QUALIFIED` without the receipt, independent evidence, and reviews.
- [ ] Keep AI Design as an intent/evidence-reference producer only. It must not
  construct the UI qualification envelope, select a release state, or mutate
  product receipts. Cross-scope source changes remain integration/AI-owned.

Acceptance evidence: authorization and tenant-isolation fixtures, current and
stale revision fixtures, canonical receipt/manifest hash parity, replay and
tamper rejection, six-locale UI integration, audit retention, and owner-reviewed
external evidence. Until those receipts exist, the Precision UI must remain
`NOT_RUN/HOLD`.

Acceptance evidence for these requests is an integration commit and contract
hash, cross-scope fixtures, current CI receipts, owner approval, and a documented
rollback path. A Precision-local adapter or passing self-authored fixture is not
completion evidence for a shared action.

## GP10 mechanical exact-loop integration binding

Precision now provides two version-isolated, read-only current-head mechanical
verticals. The v1 base-extrude-plus-hole contract remains unchanged. The v2
contract executes `convex extrude -> explicit stable-edge fillet/chamfer ->
drilled hole` through the actual Node OCCT runtime and carries the server-loaded
revision triplet through STEP round trip, HLR drawing, overall dimensions, BOM,
runtime/registry identity, rights receipt, and XCAF occurrence binding. These are
internal evidence only and do not satisfy the integration-owned durable commit,
authorization, tenant, invalidation, or release requirements below.

The bounded registry surface reached 22/30 exact internally after adding
`cad.mechanical.sweep` with handler
`occt.sweep.orthogonal-polyline-rect`: exactly three path points, two
axis-aligned orthogonal non-collinear segments, one constant rectangular
section, native OCCT pipe-shell right-corner construction, closed manifold
single-solid inspection, volume/bounding-box checks, and STEP round trip.
Integration and AI Design must not translate this into general FeatureTree
`tree:sweep` or `tree:sweep_path` support; those broader contracts remain
blocked.

The next two bounded handlers are also complete internally. At 23/30,
`cad.mechanical.split-body` with
`occt.split-body.keep-side-axis-plane` accepts one axis-aligned rectangular
prism host, one strict-interior XY/XZ/YZ plane offset, and exactly one retained
positive or negative side. Native intersection, closed single-solid topology,
analytic retained volume/bounding box, and STEP round-trip evidence are bound;
returning both bodies or a full split remains `HOLD` until a versioned
multi-body/XCAF occurrence contract exists.

At 24/30, `cad.mechanical.bend` with
`occt.bend.single-rectangular-sheet` accepts one rectangular sheet length,
width, and thickness, `fixedLengthMm`, `innerRadiusMm`, an angle from 5 through
90 degrees, and upward direction only. The raw Node OCCT bridge prisms an
eight-edge analytic cross-section with two concentric circular arcs. It requires
flat-sheet volume and surface-area preservation, analytic bounding box, exactly
eight planar and two cylindrical faces, cylinder radii `[R, R + thickness]`, a
closed manifold single solid, and STEP round trip. This does not establish
material behavior, K-factor, springback, tooling, relief, downward, or multiple
bend semantics; all remain blocked and commercial release remains `HOLD`.

At 25/30, bounded `cad.mechanical.flange` with
`occt.flange.single-positive-end` is complete internally. It accepts one
rectangular sheet host, `edge: positive_length_end`, upward direction, an angle
from 5 through 90 degrees, one straight-leg length, and one inner radius. It
reuses the verified analytic bend primitive for base-sheet plus circular-arc and
straight-leg material. The receipt checks base volume against the arc-plus-leg
material increase, developed-length surface area, analytic bounding box, eight
planar and two cylindrical faces, radii `[R, R + thickness]`, a closed manifold
single solid, and STEP round trip. Generic edges, miter, relief, downward
direction, multiple flanges, material compensation, and tooling remain blocked;
commercial release remains `HOLD`.

At 26/30, bounded `cad.mechanical.flat-pattern` with
`occt.flat-pattern.single-bend-step-dxf` is complete internally for one exact
single bend or positive-length-end flange. The caller supplies the bounded
source request but cannot supply a source receipt, source STEP, flat STEP, DXF,
runtime, or verifier. Precision reruns the bend/flange request through native
exact execution, derives developed length, width, and bend line, builds and
STEP-roundtrips an actual OCCT planar face, emits millimetre DXF with exactly
four `OUTLINE` lines and one `BEND_UP` line, and reparses that DXF before PASS.
The receipt binds revision, regenerated source receipt/STEP, flat STEP, DXF,
dimensions, bend line, and receipt hashes. Multi-bend, K-factor, material,
springback, tooling, relief, nesting, and shop-floor claims remain blocked.

At 27/30, the separately versioned native planar-face geometry receipt completes
the bounded geometry-only `cad.mechanical.sketch` registry graduation through
`occt.sketch.convex-line-loop-planar-face`. It consumes a verified
`CanonicalSketchPreflightPass` directly, accepts only one strict-convex line
loop on the three principal planes, and requires the trusted runtime plus exact
registry gate. Integration and AI Design must keep
`nexyfab.precision-cad.canonical-sketch-preflight.v1` structural evidence and
`nexyfab.precision-cad.canonical-sketch-constraint-solve.v1` numeric-only
evidence distinct from
`nexyfab.precision-cad.canonical-sketch-occt-geometry.v1` native face evidence.
The native receipt binds the current revision, canonical structural hash,
trusted runtime, plane, area, perimeter, boundary edges, STEP, and receipt hash,
but it does not consume the numeric solver receipt. None of these receipts,
alone or combined, proves constraint/dimension/expression exactness, fully
constrained status, native solver authority, curve or nested-loop support, or
general sketch exactness.

At 28/30, bounded `cad.mechanical.delete-face` with
`occt.delete-face.blind-hole-cap` is complete internally for one strict-interior
blind cylindrical hole in one axis-aligned rectangular prism. The exact machine
face set is `[f.hole.wall, f.hole.floor, f.cap.top.perforated]`. Native execution
removes those three faces, retains the five untouched host faces, reuses the
deleted perforated top face's outer wire for a topology-preserving cap, assembles
a closed shell, and solidifies it. Detailed B-Rep inspection and STEP re-import
must prove the restored six-plane, 12-edge, closed manifold rectangular-prism
topology, volume, and bounding box. Arbitrary delete, surface extension,
feature suppression/rebuild, and multi-hole semantics remain blocked.

At 29/30, versioned `cad.mechanical.sweep-path` with
`occt.sweep-path.orthogonal-polyline-rect.v1` is bounded exact only for one
constant rectangular section, exactly two orthogonal non-collinear segments, a
start-normal profile frame, and right-corner transition. The broader
`tree:sweep_path` FeatureTree alias remains `UNSUPPORTED`; Integration and AI
Design must not route arbitrary frames, curved or multi-segment paths, variable
sections, or alternate transition semantics to the bounded handler.

At 30/30, `cad.mechanical.weldment` with
`occt.weldment.two-member-corner-cut-list` preserves exactly two rectangular
members as an unfused native two-solid compound. STEP replay and a generated
millimetre cut list bind the revision, request, runtime identity, registry,
result and round-trip inspection, STEP, cut-list, and receipt hashes. Machine
statuses remain literal: weld bead geometry `NOT_MODELLED`, process
specification `NOT_AUTHORIZED`, member material `UNSPECIFIED`, weld process
authority `NOT_CLAIMED`, and XCAF occurrence verification `NOT_RUN`. Arbitrary
joints, more members, weld geometry, process/material approval, and fabrication
release remain blocked.

The 30/30 figure is internal bounded candidate coverage, not a commercial or
general-purpose completeness score. It does not close the authority, XCAF,
external interchange, manufacturing, standards, independent review, security,
localization, operational, or real-pilot gates. `authoritativeCommit` and
`commercialReleaseReady` remain false and overall release remains `HOLD`.

The versioned Precision consumer surfaces are:

- `nexyfab.precision-cad.mechanical-single-part-feature-tree.v1` and
  `nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1` at
  `/api/cad/v2/projects/{projectId}/documents/{documentId}/artifacts/mechanical-exact`;
- `nexyfab.precision-cad.mechanical-single-part-feature-tree.v2` and
  `nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2` at
  `/api/cad/v2/projects/{projectId}/documents/{documentId}/artifacts/mechanical-exact/feature-tree-v2`;
- the same-revision XCAF occurrence envelope
  `nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1` at the
  corresponding `/xcaf` suffix for each artifact route.

Integration and AI Design changes listed here are documentation-only requests;
they are not authorized on `scope/precision-cad`. A caller may provide only the
authenticated path project/document identity to these read endpoints. It must
not provide or override the revision triplet, canonical head, rights receipt,
feature tree, exact receipt, bundle or manifest, STEP bytes, runtime identity,
registry receipt, XCAF inspection, worker location, or worker credential.

- [ ] Bind the Precision-owned
  `nexyfab.precision-cad.native-mechanical-exact-receipt.v1` to the authoritative
  canonical v2 commit service. The authority must load the current tenant-scoped
  base revision and CAS state; it must not accept a caller assertion that a local
  exact receipt committed a revision.
- [ ] Persist the exact request, registry hash, verified runtime identity hash,
  result measurement hash, STEP hash, and receipt hash with the resulting
  revision ID, sequence, and content hash. Reject stale base bindings, duplicate
  operation IDs with different content, altered artifacts, and non-idempotent
  replays.
- [ ] Keep the AI-owned `mechanicalCoreFeatureContract` as an intent/evidence
  reference producer. AI Design must not construct a Precision exact receipt,
  supply a bridge/runtime identity, or promote an interactive mesh result to
  exact status.
- [ ] Add an AI Design/integration version-selection adapter that maps an
  approved v1 or v2 intent to the exact versioned read route above. The adapter
  may reference a requested operation and approval, but it must never submit a
  caller revision, receipt, bundle, STEP payload, edge-authority hash, or XCAF
  result. Unknown schema/route combinations and silent v1/v2 fallback must
  return `HOLD` before a Precision request.
- [ ] Keep the v1 contract and route available until an integration-owned
  compatibility and migration decision is reviewed. A v1 object must not be
  relabelled as v2, and a v2 object must not be downgraded to v1 when stable
  edge references or treatment semantics fail validation.
- [ ] Adapt integration-owned mechanical verification scripts and evidence only
  after the canonical binding exists. Do not refresh the current 30-feature
  evidence timestamps or convert their `HOLD` state into `PASS` from a local
  self-authored run.
- [ ] Bind STEP, XCAF occurrence identity, HLR drawing, dimensions, BOM, and
  invalidation receipts to the same committed revision. Reuse the exact
  versioned `nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1`
  or `nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2`
  contract without weakening its current-head, rights, manifest, or tamper
  checks. For v2, preserve the feature-tree schema/hash, treatment kind, stable
  edge-reference hash, and the same revision/rights/STEP/bundle-manifest binding
  carried by the XCAF envelope. A successful assembly import or drawing fixture
  from another revision is not reusable evidence.
- [ ] Configure the production-only `OCCT_XCAF_SERVICE_URL` and a rotated,
  secret-managed `OCCT_XCAF_SERVICE_TOKEN` on both the application caller and
  XCAF worker. Keep the worker on a private authenticated network, prevent
  public `/v1/inspect` exposure, and verify timeout, request-size, concurrency,
  audit, and recovery behavior. A mock-native receipt is protocol evidence only.
- [ ] Add cross-scope negative fixtures for stale revision/CAS, changed registry
  or runtime identity, receipt/STEP tamper, missing native handle, mesh fallback,
  retry with changed arguments, tenant mismatch, replay after invalidation,
  v1/v2 schema substitution, fallback-only or changed `edgeRefs`, altered
  treatment dependency, and stale embedded `childExtrude`. Prove that the
  current-head v2 extractor rejects stale child-snapshot parity even though the
  lower-level generic exact handoff records that case only as a known boundary.
- [ ] Keep exact feature negotiation literal: the bounded sweep handler
  must reject arbitrary FeatureTree sweep/path requests, non-orthogonal or
  collinear paths, variable sections, and changed corner semantics. The bounded
  split-body handler must reject boundary/outside planes, non-axis-aligned hosts
  or planes, ambiguous keep-side requests, both-body output, and any attempt to
  package two bodies under the current single-part XCAF envelope. The bounded
  bend handler must reject out-of-range angle/radius/fixed-length values,
  downward or multi-bend requests, changed analytic face/radius signatures, and
  claims of material, K-factor, springback, tooling, or relief qualification.
- [ ] Keep the bounded flange negotiation limited to one positive length-end
  edge and one analytic arc-plus-straight-leg result. Reject generic edge,
  miter, relief, downward, multiple-flange, material-compensation, and tooling
  semantics; an internal 25/30 receipt does not qualify those forms.
- [ ] Keep delete-face negotiation limited to the exact blind-hole repair
  handler and fixed three-face machine-token sequence. Reject reordered,
  translated, inferred, partial, extra, or caller-remapped face sets; arbitrary
  faces, surface extension, feature suppression/rebuild, multiple holes, and a
  regenerated-host substitution must remain `HOLD`.
- [ ] Keep the versioned sweep-path negotiation literal. Only the
  start-normal/right-corner/two-orthogonal-segment constant-rectangle contract
  may use the bounded handler; preserve `tree:sweep_path` as `UNSUPPORTED` and
  reject broad FeatureTree fallback or alias promotion.
- [ ] Keep weldment negotiation limited to the fixed two-member square-corner
  compound and its server-generated mm cut list. Do not fuse the solids, accept
  a caller cut list, infer XCAF occurrence identity, localize machine tokens, or
  convert `NOT_MODELLED`/`NOT_AUTHORIZED`/`UNSPECIFIED`/`NOT_CLAIMED`/`NOT_RUN`
  into weld, material, process, or fabrication approval.
- [ ] Keep flat-pattern input limited to the exact bend/flange source request.
  Never add caller fields for source receipts or source/output STEP, DXF,
  runtime, verifier, or hashes. Reject multi-bend, unqualified material/K-factor/
  springback/tooling/relief semantics, changed DXF units or machine layer names,
  failed independent reparse, nesting, and shop-floor release claims.
- [ ] Consume the implemented native planar-face sketch receipt as a separate
  versioned contract without changing either existing sketch receipt. Recognize
  the EXACT label only for the literal
  `occt.sketch.convex-line-loop-planar-face` geometry contract and verified
  receipt. Reject any AI or integration claim that structural preflight, numeric
  solver success, native planar-face geometry, zero residual in the bounded
  subset, or a localized explanation is equivalent to fully constrained
  constraint/solver exactness or broader sketch support.

Acceptance evidence: an integration-owned canonical commit adapter, durable
transaction and idempotency tests, AI/Precision contract parity, current
artifact hashes, third-party STEP interoperability review, and an owner-reviewed
release decision. Until then `authoritativeCommit` and
`commercialReleaseReady` remain false.

## GP11 canonical sketch and AI Design binding

Precision now owns three narrow, versioned sketch consumer contracts:

- `nexyfab.precision-cad.canonical-sketch-preflight.v1` validates one strict
  convex line loop and returns structural evidence only;
- `nexyfab.precision-cad.canonical-sketch-constraint-solve.v1` accepts only the
  bounded fixed/horizontal/vertical/coincident subset, executes deterministic
  replay, and returns `NUMERIC_ONLY / release: HOLD`;
- `nexyfab.precision-cad.canonical-sketch-occt-geometry.v1` consumes the verified
  structural pass through `occt.sketch.convex-line-loop-planar-face`, constructs
  and STEP-replays an actual principal-plane OCCT face, and returns bounded
  geometry-only EXACT evidence with `release: HOLD`.

The following cross-scope work must be done from integration/AI Design rather
than this branch:

- [ ] Publish versioned shared descriptors for all three schemas without allowing AI
  Design to construct a Precision PASS receipt, choose solver status, provide a
  solver callback or runtime, supply a native face or STEP artifact, or alter the
  canonical revision triplet.
- [ ] Make AI Design submit intent plus candidate points/lines/constraints only.
  Precision must rerun structural validation and numeric replay; a narrative,
  browser `satisfied` flag, or AI-calculated hash is not execution evidence.
- [ ] Preserve the preflight, constraint-input, numeric replay/output, native
  geometry receipt, runtime identity, and STEP hashes plus
  project/document/revision identity in the cross-scope audit record. Reject a
  stale head, unsupported constraint, dimension/expression field, unknown schema
  or handler version, altered geometry receipt, and changed arguments on
  idempotent retry.
- [ ] Map stable issue codes through shared locale catalogs. Localized messages,
  decimal formatting, and translated units must never enter canonical geometry,
  solver input, or hashes.
- [ ] Keep `SOLVER_PASS / NUMERIC_ONLY` visually and machine-readably distinct
  from bounded `GEOMETRY_PASS` B-Rep exactness, and keep both distinct from fully
  constrained sketch authority, canonical commit, manufacturing readiness, and
  commercial release. Never omit the strict-convex line-loop/principal-plane
  qualifier from the registry EXACT label.

Acceptance evidence: hostile emitter/consumer parity fixtures, stale-revision
and tampered preflight/numeric/native-geometry receipt tests, deterministic
replay across supported Node builds, exact handler and STEP-hash parity,
six-locale issue-code rendering, audit retention, and owner review. The current
Precision-local tests are internal evidence only.
## 2026-08-25 staging HOLD checkpoint

- [x] Deploy exact durable core to isolated Railway staging with commercial
  mode disabled (`7c732639` / `356947fe-2b45-453a-aba2-eeb57c33b91e`).
- [x] Verify 2/2 instances, PostgreSQL, Redis, migration `2026082502`, packaged
  runtime HOLD, forged worker claim, forged lease, and callback fail-closed.
- [x] Add a repeatable collector that refuses production/non-HTTPS origins and
  emits a redacted, exact-release-bound receipt.
- [ ] Supply and review a checksum-pinned production-class native CAD adapter.
- [ ] Deploy the separately keyed isolated commercial worker and run the
  positive canary, negative substitution/replay, and recovery campaigns.
- [ ] Obtain independent CAD/expert and manufacturing-pilot evidence before
  changing Private Beta or GA eligibility.
