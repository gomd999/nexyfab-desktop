# GP-00 Precision CAD scope baseline

Status: `SCOPE_BASELINE_VALIDATED / SECURITY_AND_RELEASE_HOLD`
Owner: `scope/precision-cad`
Baseline date: `2026-08-24`

This is the GP-00 evidence index for the Precision CAD scope. It records
boundaries and blockers; it does not grant release approval and does not turn
synthetic or self-authored checks into external evidence.

## 1. Stable blocker IDs

IDs are stable across turns. A new receipt must update the evidence location
for the same ID instead of creating a second description of the blocker.

### Local Precision blockers

| ID | Meaning | Current state | Required evidence to close |
| --- | --- | --- | --- |
| `GP00-LOCAL-SCOPE-001` | Scope ownership and changed-path audit. | `CLOSED_FOR_CURRENT_WORKTREE` | `npm run workspace:check -- precision-cad` passed on 2026-08-24 with branch match, 122 changed files, and zero shared/foreign/unclassified paths. Re-run at handoff. |
| `GP00-LOCAL-EXACT-002` | Exact/native/no-stub and replay evidence is not established by this document. | `OPEN` | Current bounded verification receipt plus exact-kernel identity and replay/rollback receipts. |
| `GP00-LOCAL-QUAL-003` | Product qualification evidence is incomplete. | `OPEN` | Current independent domain, exchange, reviewer, campaign, and pilot receipts. |
| `GP00-LOCAL-I18N-004` | Precision-local catalog/format evidence is not established here. | `OPEN` | Locale key-parity, fallback, unit/number/date, RTL, and font-rights receipts. |

### External or integration blockers

| ID | Meaning | Current state | Owner / source |
| --- | --- | --- | --- |
| `GP00-EXT-SEC-001` | Credential rotation, legacy public endpoint removal, tracked-file secret scan, and security evidence correctness are pending. | `OPEN` | Integration; `INTEGRATION_ACTIONS.md` P0 and Security evidence correctness. |
| `GP00-EXT-CONTRACT-002` | Shared intent/tool/command/artifact contracts and emitter/consumer parity are not graduated. | `OPEN` | Integration; `INTEGRATION_ACTIONS.md` General-purpose contract actions. |
| `GP00-EXT-PLATFORM-003` | Shared job, artifact, identity/RBAC, queue, retention, audit, and production configuration evidence is pending. | `OPEN` | Integration/platform; `INTEGRATION_ACTIONS.md`. |
| `GP00-EXT-AI-004` | Versioned AI Design intent/provenance and Precision receipt binding are pending. | `OPEN` | AI Design; `INTEGRATION_ACTIONS.md` AI Design-owned actions. |
| `GP00-EXT-I18N-005` | Global locale/catalog/format/RTL/font policy is undecided. | `OPEN` | Integration/shared i18n; `INTEGRATION_ACTIONS.md`. |
| `GP00-EXT-RELEASE-006` | Independent authority, exchange, reviewer, campaign, fabrication, and field-pilot evidence is incomplete. | `OPEN` | Governed release; `CURRENT.md` and `INTEGRATION_ACTIONS.md`. |
| `GP00-EXT-SUPPLY-007` | Dependency audit and third-party notice evidence is incomplete or stale. | `OPEN` | Integration; global dependency/SBOM/license evidence and notices. |

`OPEN` means no current closing receipt was found during this baseline pass;
it is not a claim that an implementation is broken. IDs may only move to
`CLOSED` when the required evidence is linked and its revision/hash, owner,
date, and scope are recorded.

## 2. Owned-write boundary

This branch may write only Precision-owned paths listed in
`workspaces/registry.json`, including:

- `capabilities/precision-cad/**`, `domains/**`;
- Precision CAD routes and libraries under the registered `src/app/**` and
  `src/lib/**` CAD paths;
- registered CAD scripts, workers, solver/container paths; and
- `workspaces/precision-cad/**`.

The baseline itself is therefore owned by this scope. `packages/**`, root
build/CI/config, platform auth/queue/artifact/tenant infrastructure,
`src/lib/ai/**`, shared/global i18n, and other worktrees are not writable from
this branch. Requests for those paths are documentation-only handoffs through
`INTEGRATION_ACTIONS.md`; no local adapter or fixture closes an integration
acceptance gate.

Existing unrelated or prior scope changes remain untouched. A handoff must
identify all changed paths and their owner; shared-path changes are a stop
condition, not something to silently absorb.

## 3. GP-00 acceptance checklist

The scope-baseline items are checked from the current worktree. Release items
remain open and must not be read as GP-00 implementation failures.

- [x] `A1` Branch is `scope/precision-cad`; registry and scope files were read.
- [x] `A2` Every changed path is inside the Precision owned boundary or is
  explicitly classified as pre-existing/unrelated; no shared path was edited.
- [x] `A3` Local blocker IDs and external blocker IDs are attached to the
  relevant evidence, owner, revision, and next action.
- [x] `A4` Bounded type/architecture/scope checks are run from the same
  revision; synthetic fixtures are labeled as synthetic.
- [ ] `A5` Exact/native kernel identity, no-stub behavior, save/reopen/replay,
  rollback, and stale/invalidation evidence are present where claimed.
- [ ] `A6` Security, dependency/SBOM/license, tenant/isolation, backup, and
  secret-scan receipts are current; missing or stale receipts remain `HOLD`.
- [ ] `A7` Independent exchange/domain/reviewer/campaign/pilot evidence is
  present for each claimed vertical; self-authored validators do not qualify.
- [ ] `A8` AI Design and shared-contract work is linked to integration/AI
  Design receipts; Precision does not claim ownership of those gates.
- [x] `A9` All unresolved blockers have a named owner and explicit closing
  evidence; otherwise the dependent capability remains `HOLD`.

## 4. Evidence locations and present interpretation

| Evidence area | Location | Interpretation in this baseline |
| --- | --- | --- |
| Scope ownership and checks | `workspaces/registry.json`, `workspaces/precision-cad/SCOPE.json`, `scripts/workspaces/check.mjs` | 2026-08-24 worktree run: typecheck PASS, architecture PASS, branch match, zero shared/foreign/unclassified paths. Must be re-run at handoff. |
| Current Precision status | `workspaces/precision-cad/CURRENT.md`, `EVALUATION.md`, `DECISIONS.md` | Reports internal readiness with external/product evidence still held. |
| Focused verification | `workspaces/precision-cad/VERIFY.md`, `workspaces/precision-cad/verify.mjs` | Runner and policy only; receipt must be generated for a claim. |
| General-purpose plan | `workspaces/precision-cad/GENERAL_PURPOSE_AGENTIC_CAD_MASTER_PLAN.md` | GP sequence, ownership, evidence, and hold policy. |
| Integration requests | `workspaces/precision-cad/INTEGRATION_ACTIONS.md` | External action ledger; not closed by Precision-local work. |
| Prior handoffs | `workspaces/precision-cad/HANDOFFS/**` | Historical context only unless a receipt explicitly names the current revision. |

Current bounded security/supply check results from 2026-08-24:

- `security:secrets:check`: exit 1, `SECRET_SCAN_EVIDENCE_STALE`; the scanner also
  reported a current pass over 7,609 files, but that does not close the known
  credential-remediation or stale-evidence blocker.
- `security:dependencies:check`: exit 1,
  `DEPENDENCY_AUDIT_INCOMPLETE:UNKNOWN`.
- `licenses:check`: exit 1, `THIRD_PARTY_NOTICES_STALE` with 685 expected packages.

These commands target integration-owned evidence. Their output is recorded here
without refreshing timestamps, generating evidence, rotating credentials, or
editing shared files. `GP00-EXT-SEC-001` and `GP00-EXT-SUPPLY-007` remain open.

The inspected current status is `READY_FOR_HANDOFF_INTERNAL_VERTICALS_EXTERNAL_HOLD`.
The release state remains `HOLD`. This baseline asserts the bounded typecheck,
architecture, and scope results above, but does not assert security, external
authority, independent exchange, or pilot passes.

## 5. HOLD rules

Keep GP-00 and every dependent release claim on `HOLD` when any of the
following applies:

1. A write crosses the registry boundary, or ownership/revision cannot be
   determined.
2. A required receipt is missing, stale, synthetic-only, self-authored, or
   cannot be tied to the claimed revision and scope.
3. An external blocker (`GP00-EXT-*`) remains open for the dependency being
   exercised, including shared contracts, security, platform identity/queue,
   AI provenance, global i18n, or governed release evidence.
4. Exact/native behavior, authoritative revision lineage, stale propagation,
   rollback, or no-silent-fallback behavior is unproven.
5. Rights, license, source provenance, reviewer independence, or pilot scope
   is unknown.

HOLD may be lifted only by the responsible owner after linking the closing
receipt, commit/revision hash, date, and reviewer decision. Passing a local
test, adding a fixture, or changing a timestamp is not sufficient. Until then,
proceed only with read-only inspection, documentation, bounded reversible work,
or explicitly approved work within the Precision boundary.
