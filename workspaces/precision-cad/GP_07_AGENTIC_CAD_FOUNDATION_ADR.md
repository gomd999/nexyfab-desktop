# GP-07 agentic CAD tool, plan and sandbox foundation ADR

- Status: `IMPLEMENTED_INTERNAL_FOUNDATION / AUTHORITATIVE_COMMIT_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Depends on: `GP_02_CANONICAL_V2_ADR.md`,
  `GP_03_REVISION_JOURNAL_ADR.md`,
  `GP_05_FEATURE_REGISTRY_EXECUTION_ADR.md`,
  `GP_06_CAD_I18N_ADR.md`
- AI Design effect: none; cross-scope wiring remains an MD integration request.

## Decision

Agent intent is an untrusted candidate. Precision exposes a versioned allow-list
of CAD tools, seals a hash-bound dry-run-only execution plan, evaluates live
revision/lock/permission/time state, and records sandbox and policy receipts.
This foundation deliberately has no `ALLOW_COMMIT` state.

The only policy results are:

```text
READ_ONLY_READY
DRY_RUN_REQUIRED
SANDBOX_COMPLETE
AWAITING_HUMAN_APPROVAL
BLOCK
```

Every result records `authoritativeCommit: NOT_AUTHORIZED` and `release: HOLD`.
An approval artifact created in this scope is explicitly an
`UNTRUSTED_CANDIDATE`; it cannot satisfy the GP-02 trusted R3 boundary or the
GP-03 server store.

## Tool registry

The first registry contains 18 tools for project/document inspection, object
selection, requirements, feature/sketch/assembly/spatial preview and commit,
drawing, analysis, domain verification, exchange and qualification evaluation.

- R0 query tools are read-only and require no approval.
- R1 tools run only in a sandbox.
- authoritative mutation/artifact tools are R3 and require human approval.
- R4 release, quotation, RFQ, purchasing, construction approval and external
  transmission are absent and validation forbids governed tools in this registry.

Descriptor risk, mode, side effect, schema, budget, verifier, idempotency and
compensation policy are hashed into the registry. A caller cannot lower the risk
or substitute a descriptor without invalidating the registry or plan hash.

## Plan and evidence binding

Plans bind project, document, domain, full base revision triplet, lock-set hash,
agent/model/prompt hashes, dependency order, input artifact schema and SHA,
expected changed objects and output artifacts, resource budget, verifier set,
idempotency key and expiry. Raw prompt text, file paths, URLs, shell fragments
and executable arguments are not part of the plan interface.

`feature.commit` additionally requires the current GP-05 feature-registry hash,
trusted OCCT runtime identity SHA-256 and preflight receipt SHA-256. A preview,
unsupported feature, runtime drift or incomplete preflight cannot be re-labelled
as an authoritative feature plan.

Dry-run receipts bind every step to the plan, input, command and expected output
set. Changed-set or output-set mismatch converts the step and aggregate receipt
to `HOLD`. Partial success never becomes PASS. A dry-run PASS can lead only to
`SANDBOX_COMPLETE` or `AWAITING_HUMAN_APPROVAL`.

## Canonical spatial preview

The first real reducer integration is limited to a one-step
`spatial.object.commit` proposal. It validates an R3 agent proposal, derives the
actual touched object/path scope and checks exact equality with the plan and
command. It then seals a separate internal R2 preview command and applies GP-02
to an immutable document clone.

The preview allow-list is:

- create;
- update of the complete payload scope;
- move;
- relationship create;
- host relationship.

Delete, relationship delete, constraint, feature, assembly and drawing
operations remain HOLD in this path. The base document is unchanged; the result
is a `SANDBOX_CANDIDATE_ONLY` document and `SANDBOX_EVIDENCE_ONLY` receipt.
Tests cover all five allowed operations, direct R3 rejection, deletion/domain
HOLD, forged scope, live-lock drift, hash drift and hostile objects.

## Authoritative commit HOLD

GP-03 intentionally rejects every non-human actor before transaction entry. GP-07
does not bypass this and does not turn an agent principal into a human principal.
The following integration-owned capabilities are required before any agent
commit can be enabled:

- server-authenticated human approval bound to plan, proposal, exact operations,
  descriptor/feature/runtime hashes, base revision, live lock epoch, scope,
  actor, expiry and a one-time nonce;
- durable approval claim/consume and idempotency conflict handling;
- pre-execution and commit-transaction head, lock, registry and runtime recheck;
- trusted human command rematerialization without changing approved operations;
- atomic GP-03 revision, approval consumption, audit and invalidation writes;
- output schema, complete verifier set, artifact hashes and final-result checks;
- forward compensation revision; no history rewrite and no generic rollback tool;
- production migration, tenant, queue, cancellation, resource metering,
  observability, security and recovery evidence.

Until then, an approval hash, commercial preflight `ALLOW_EXACT`, catalog entry,
agent explanation or dry-run PASS is never authority.

## Clean-room and rights rule

The tool policy, IDs, plan/receipt schemas and tests are independently authored
from general agent safety and CAD transaction concepts. Manuals and the supplied
engineering encyclopedia are reference data only; their expression, examples,
tables, screenshots and code are not copied. External text is never interpreted
as an instruction or executable argument.
