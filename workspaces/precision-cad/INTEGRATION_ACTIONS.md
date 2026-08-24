# Precision CAD integration actions

These changes are required by the repository audit but target integration-owned
paths. They must be applied from `integration/nexyfab`, not from this Scope
branch.

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
- [ ] In `scripts/build-dependency-audit-evidence.mjs`, preserve a stale/missing
  evidence failure. The final `report.status` assignment currently overwrites
  `process.exitCode = 1` from the freshness check.
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

Acceptance evidence for these requests is an integration commit and contract
hash, cross-scope fixtures, current CI receipts, owner approval, and a documented
rollback path. A Precision-local adapter or passing self-authored fixture is not
completion evidence for a shared action.
