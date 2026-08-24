# GP-03 canonical revision and recovery journal ADR

- Status: `IMPLEMENTED_INTERNAL / PRODUCTION_MIGRATION_HOLD`
- Date: `2026-08-24`
- Owner: `scope/precision-cad`
- Depends on: `GP_02_CANONICAL_V2_ADR.md`
- Release effect: none; all documents and receipts remain `CONSUMER_DRAFT`,
  `NOT_RUN`, and `HOLD`.

## Decision

Canonical CAD v2 uses one server-authoritative immutable revision lineage. A
browser IndexedDB journal is only a bounded recovery cache for commands that
have not yet been confirmed against the server head. It is never a project
database, approval authority, merge authority, or evidence source.

The first v2 mutation boundary is human-only. Agent and system actors are held
until GP-07 supplies a trusted risk evaluation, approval receipt, tool registry,
and audit identity. A command's own actor, risk, lock snapshot, or timestamp is
not sufficient authority.

## Server revision invariants

`src/lib/cad/canonicalCadRevisionStore.ts` enforces:

- read-only migration readiness checks and no request-time DDL;
- full revision triplet compare-and-swap: revision ID, sequence, and content
  SHA-256;
- one immutable canonical document plus command and receipt per committed
  revision;
- exact idempotent replay only when the durable command hash and canonical JSON
  match;
- separate conflicts for reused command IDs, substituted idempotency payloads,
  and stale heads;
- stored document, command, receipt, parent, actor, compensation, and timestamp
  consistency checks before replay;
- live authority locks and server evaluation time passed into the GP-02 reducer;
- revision, head, seven derived invalidations, downstream hook, and audit hook in
  one transaction;
- rollback on zero-row writes, failed CAS, invalidation failure, or audit failure;
- no orphan revision after a failed transaction.

The seven invalidation scopes are exact geometry, native document, analysis,
drawing, quantity, exchange, and qualification. A new canonical revision makes
all of them stale; a downstream attempt does not make them current again.

## HTTP boundary

The Precision-owned route is:

```text
GET|POST /api/cad/v2/projects/{projectId}/documents/{documentId}/revisions
```

The route uses awaited dynamic parameters, bounded JSON, authenticated project
membership, editor permission for POST, private no-store responses, server time,
and authority lock rows. Client-provided execution context, lock evidence,
clock, approval override, and storage hooks are rejected by the body contract.

The API intentionally returns stable machine codes rather than localized human
text. Precision UI catalogs map these codes without changing their meaning.

## Browser recovery journal

`src/lib/cad/canonicalCadRecoveryJournal.ts` stores only canonical command JSON
and the minimum recovery envelope under the exact
`user/project/document/command` scope.

State progression is:

```text
PENDING -> SENT -> ACKNOWLEDGED -> CONFIRMED
   |         |
   +---------+-> BLOCKED

invalid or tampered entry -> CORRUPT quarantine
```

Rules:

- append before network send;
- validate and rehash the GP-02 command on write and read;
- bind the outer base revision, IDs, actor scope, timestamps, and server head to
  the embedded command;
- never store credentials, approval tokens, or raw artifact bytes;
- never auto-rebase or auto-merge;
- classify recovery as `BASE_MATCH`, `STALE_OR_REPLAY`, `GAP`, or `BLOCKED`;
- confirm only an exact next revision ID and next sequence returned by the
  server;
- prune only confirmed entries;
- quarantine corruption instead of executing or deleting it;
- preserve existing entries on quota failure;
- cap command bytes and per-scope/global entry counts;
- return `UNAVAILABLE` for SSR, blocked open, or a newer database version without
  wiping data.

## Integration-owned migration

Production tables, checksum publication, readiness wiring, tenant isolation,
backup/restore, and invalidation consumers are integration-owned. The exact
request and acceptance evidence are recorded in `INTEGRATION_ACTIONS.md`.

Until migration `2026082401`, the lock/audit authority tables, checksum, and
production race evidence exist, the server path returns `MIGRATION_REQUIRED`
and release remains `HOLD`.

## Verification status

Internal synthetic verification covers reducer validation, immutable commit,
SQLite atomicity, CAS rollback, exact replay, lock/time enforcement, audit
rollback, IndexedDB recovery, corruption quarantine, version preservation, and
scope isolation. These tests establish implementation behavior only. They do
not substitute for production PostgreSQL concurrency, backup/restore, security,
external reviewer, or field-pilot evidence.

## Next decision

GP-04 may consume a canonical v2 revision candidate and bind an OCAF/XCAF
document to it, but it may not bypass this store or turn a browser/native worker
result directly into authoritative state. GP-07 must graduate agent mutations;
until then the v2 POST path accepts authenticated human actors only.
