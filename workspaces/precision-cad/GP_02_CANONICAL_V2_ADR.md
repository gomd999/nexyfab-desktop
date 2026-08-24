# GP-02 canonical CAD v2 consumer-draft ADR

- Status: `ACCEPTED_LOCAL_CONSUMER_DRAFT / NOT_SHARED / NOT_AUTHORITATIVE`
- Owner: `scope/precision-cad`
- Date: `2026-08-24`
- Release effect: none; all projected documents remain `NOT_RUN` / `HOLD`

## Decision

Precision CAD defines a local v2 canonical object, document, relationship, and
command model before any shared-package promotion or persistence migration.
The model version is `2`, while its local contract version and schema suffix
remain consumer-draft v1:

- `nexyfab.precision-cad.canonical-document-consumer-draft.v1`
- `nexyfab.precision-cad.canonical-command-consumer-draft.v1`

These names are intentionally not final shared contracts. Integration owns any
future package name, compatibility policy, and graduation decision.

The implementation boundary is:

- `src/lib/cad/canonicalCadV2ConsumerDraft.ts`: browser/server-safe types,
  strict validation, canonical hashing, and a pure structural reducer;
- `src/lib/cad/spatialCadV1CanonicalV2Adapter.ts`: one lossless compatibility
  projection for the tracked parameter-only spatial v1 document and command;
- focused tests for contract safety and v1 parity.

No database table, API route, UI controller, IndexedDB journal, worker, AI
emitter, product contract, or shared package changes in GP-02.

## Authority and revision semantics

The v2 consumer draft is never authoritative merely because it validates.
Every document carries:

- `authority: CONSUMER_DRAFT`;
- `verification: NOT_RUN`;
- `release: HOLD`.

Its revision consists of a stable revision ID, monotonically increasing
sequence, and document content SHA-256. The hash excludes only the revision's
own `contentSha256`; all other content, including object/relationship array
order, is bound. Object keys are sorted for canonical JSON, while array order
remains authored and semantic. Every command binds the exact base revision ID,
sequence, and content hash and supplies a distinct next revision ID.

The legacy spatial store has two revision axes: the embedded v1 document
revision and the authoritative project-head revision/hash. The adapter keeps
them distinct. It retains the authoritative project-head hash and the
independently recomputed spatial v1 document hash as two different source
bindings, gives the v2 projection its own revision ID/hash, and keeps the v1
document revision in the wrapper object's payload and object revision. None of
these values may substitute for another during conflict checks.

## Object and relationship semantics

Canonical object IDs and relationship IDs are stable machine IDs. Objects bind
namespace, machine-code kind, object revision, payload, transform, and content
hash. Relationships bind kind, endpoints, relationship revision, payload, and
content hash. Validators reject unknown keys, duplicates, dangling endpoints,
self references, and cycles in `HOST`/`UPSTREAM` edges.

The common operation vocabulary is frozen as:

`create`, `update`, `delete`, `move`, `relate`, `host`, `constraint`,
`feature`, `assembly`, and `drawing`.

The local reducer implements only universal structural semantics for
create/update/delete/move/relate/host. Constraint, feature, assembly, and
drawing commands require a dedicated Precision domain handler and therefore
return `domain_handler_required:<kind>`. A structurally valid payload is not
evidence that an exact kernel or domain operation succeeded.

Commands are atomic and immutable. Any invalid operation, stale/hash mismatch,
no-op, relationship conflict, expected changed-object mismatch, or missing
domain handler returns the original document and no changed IDs. A successful
consumer-draft reduction advances exactly one document revision and still
remains `NOT_RUN` / `HOLD`.

## Command safety envelope

The command draft records the master-plan common fields without implementing
the full later GP-07 policy engine. As a fail-closed minimum, this reducer
executes only `R2` document mutations: `R0`/`R1` are too low, `R3` remains
blocked until a trusted approval boundary exists, and `R4` is governed-workflow
only.

- project, document, base revision/hash, command and idempotency identities;
- actor plus required agent/model/prompt identity for agent commands;
- units, coordinate frame, and tolerance policy;
- command dependencies and expected changed-object set;
- a hashed human/authority lock snapshot, selected-object/parameter scope, and
  optional `compensationForCommandId` lineage. The pure reducer requires a
  separately supplied current lock set and execution time, rejects a stale lock
  snapshot and expired/not-yet-valid command, and never trusts the command's
  embedded lock list as the live state. Persisted lock authority and the
  compensation record itself remain GP-03/GP-07 work;
- input and expected-output artifact hashes;
- permission, risk class, approval scope, and optional approval receipt hash;
- timeout, memory, iteration, and retry budgets;
- an explicit side-effect declaration that forbids external transmission,
  quote, and RFQ behavior;
- verifier IDs, blockers, issued/expiry times, and stale conditions.

Validation uses exact-key schemas, finite numbers, bounded strings, arrays,
depth, and total JSON values. Prototype keys, undefined/function/symbol values,
non-plain objects, cycles, and non-finite numbers are rejected before hashing.

## v1 migration and parity

GP-02 is dual-read only. It does not dual-write and does not rewrite existing
rows or local caches.

The spatial v1 adapter creates exactly one object of kind
`legacy.spatial.parameters`. It preserves the entire v1 document payload and
does not infer walls, spaces, roads, terrain, features, authority, or exact
geometry from parameter names. A reviewed v1 command is first evaluated by the
existing pure v1 reducer. Its deterministic next v1 document becomes one v2
wrapper-object update. Governance, approval, model, prompt, units, frame,
tolerance, and hashed live-lock context must be supplied by the caller; the
adapter does not invent them.

Required parity is:

1. v1 document -> v2 wrapper -> v1 document has identical
   `stableSpatialCadDocumentJson`;
2. direct v1 `set_parameter` / `replace_parameters` and the v2-adapted path
   produce the same v1 revision, parameters, actor, and changed paths;
3. canonical-compatible command IDs and actor class are preserved (`human` ->
   `human`, `ai` -> an identified `agent` only); legacy IDs outside the bounded
   machine-ID grammar fail with an explicit migration blocker rather than being
   silently rewritten;
4. stale document revisions, post-projection hash tampering, projection drift,
   and actor disguise fail closed; GP-03 must compare the bound project-head
   hash with the live server head because GP-02 cannot prove external freshness;
5. authoritative project-head hash, v1 spatial source hash, and v2 document
   hash remain separately available.

## Deferred work and non-decisions

- GP-03 owns server revision persistence, IndexedDB recovery journal,
  reconnect replay, compensation records, crash recovery, and dual-write/CAS
  migration design.
- Feature-tree migration must later preserve node order, IDs, dependencies,
  payloads, and v1 serialization. LocalStorage remains a recovery cache and is
  not promoted by this ADR.
- CAD-IR remains import/reconstruction evidence and source provenance, never
  canonical authority.
- Domain product contracts and qualification remain downstream. A projection
  must preserve their original revision/hash and stay invalidated/HOLD until
  current qualification runs.
- OCAF/XCAF labels, exact kernel transactions, stable topology survival, and
  native document binding remain GP-04 and later work.
- Tool registry, trusted risk classification, approval-receipt resolution,
  execution receipts, and rollback policy remain GP-07 and later work.
- No `src/lib/ai/**`, `packages/**`, shared/global config, or integration-owned
  path is modified by this decision.

## Acceptance tests

The focused contract tests cover canonical hash behavior, strict and bounded
JSON, content/hash tampering, duplicate/dangling/cyclic relationships, stale
revisions, no-op/hash/changed-set conflicts, atomic rollback, explicit missing
domain handlers, input immutability, and blocked authority/release promotion.

The adapter tests cover lossless round trip, project/document revision
separation, both v1 command kinds, changed-path and actor parity, source/v2
hash separation, and fail-closed stale/tampered/drifted/disguised inputs.
