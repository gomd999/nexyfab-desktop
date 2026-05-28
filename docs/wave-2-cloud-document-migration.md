# Wave 2 — Cloud Document Migration (Local `.nfab` → R2 + Postgres)

**Status:** design / plan-only — NO implementation in this doc
**Date:** 2026-05-28
**Author:** wave-2 architecture
**Risk tier:** P0
**Phase:** Wave 2 Phase 1 Week 2
**Related:** ADR-010 (Cloud-first document model, Onshape-style),
`docs/wave-2-crdt-architecture.md`, `src/app/[lang]/shape-generator/io/nfabFormat.ts`,
`src/lib/storage.ts`, `src/lib/db-postgres-migrations.sql`

---

## Purpose

ADR-010 commits NexyFab to a **cloud-first document model** (Onshape style)
where the canonical store of a CAD project is **server-side**, not a file the
user keeps on their disk. The existing `.nfab` JSON file is a local-first
artifact: open → edit → save-to-disk. We replace it with **R2 blob (Yjs
binary snapshot) + Postgres metadata row**, with local IndexedDB as a cache
only.

This document is the **Phase 1 Week 2 plan** for that transition. It is
**design only** — no source files are modified by this plan. Implementation
lands across phases 2-5 (see §6).

The companion document `docs/wave-2-crdt-architecture.md` describes the
in-memory Yjs structures. This document covers everything *between* the Yjs
doc and the user: where bytes live, what API the client calls, how schema
migrations roll out, and how we keep `.nfab` import/export working as a
bootstrap-and-backup path.

### Out of scope for this doc

- Yjs Y.Doc shape (already designed in `wave-2-crdt-architecture.md`)
- WebSocket / Cloudflare Durable Object relay protocol (CRDT doc §6 phase 0)
- Real-time presence / awareness UI (CRDT doc §6 phase 5)
- Billing implications of cloud storage cost (separate finance memo)

### What this doc decides

1. The shape of the **3 new Postgres tables** + 1 audit table.
2. The **R2 object layout** for Yjs snapshots + full op logs.
3. The **REST + signed-URL API surface** the client uses to load/save/share.
4. How **existing `.nfab` files migrate** into a cloud document on first
   import (one-shot conversion, not ongoing sync).
5. The **deprecation glide path** for the `.nfab`-on-disk workflow: still
   available as export/backup forever, but no longer the source of truth.
6. The **permission model** — 4 roles × workspace-or-document scope — and
   how it's enforced at the API + WebSocket layer.
7. The **reversal plan** if cloud sync proves untenable.

---

## 1. Current `.nfab` Structure Summary

Source of truth: `src/app/[lang]/shape-generator/io/nfabFormat.ts`. Format is
**versioned JSON** with a `magic: 'nfab'` discriminator and a forward-compat
migration chain (`migrate(raw) → v2`).

### 1.1 Top-level shape (current v2)

```ts
NfabProjectV1 {
  magic:        'nfab',
  version:      1 | 2,                  // current writes are v2
  createdAt:    number,                 // ms epoch
  updatedAt:    number,                 // ms epoch
  name:         string,                 // project display name
  thumbnail?:   string,                 // base64 PNG, ~50 KB cap

  tree: {
    nodes:        HistoryNode[],        // flat array (parentId + children[])
    rootId:       string,
    activeNodeId: string,
  },

  scene: {
    selectedId:        string,
    params:            Record<string, number>,
    paramExpressions:  Record<string, string>,
    materialId:        string,
    color:             string,
    isSketchMode:      boolean,
    sketchPlane:       'xy' | 'xz' | 'yz',
    sketchProfile:     SketchProfile,    // segments + closed
    sketchConfig:      SketchConfig,
    activeTab?:        'design' | 'optimize',
    cadWorkspace?:     string,           // ribbon workspace id
    renderMode?:       'standard' | 'photorealistic',
    explodeFactor?:    number,
    sketchViewMode?:   '2d' | '3d' | 'drawing',
    ribbonTheme?:      'dark' | 'lightRibbon',
    studioView?:       NfabStudioViewV1, // section plane + slice palette
    sketchFaceFrame?:  { origin, normal, uAxis, vAxis } | null,
  },

  assembly?:     NfabAssemblySnapshotV1, // placedParts + mates + bodies?
  manufacturing?: NfabManufacturing,     // CAM post, sheet metal, currency
  meta?:         Record<string, unknown>, // free-form, reserves 'nexyfabPdm'
  configurations?:        NfabConfigurationV1[],
  activeConfigurationId?: string | null,

  // v2 additions (optional; absent on legacy v1):
  aiHistory?:   NfabAiHistoryEntry[],    // prompt + intent + provider + ts
  scadIntents?: Record<string, unknown>, // node id → SCAD intent JSON
}
```

### 1.2 Embedded sub-schemas

`HistoryNode` (feature tree):
```ts
{ id, type, label, icon, featureType?, params, enabled, expanded,
  error?, parentId, children[], editingActive, timestamp,
  dependsOn?, enabledExpr?, sketchData?, edgeSelections?, faceSelections? }
```

`SketchProfile` lives on the active sketch node *and* in `scene`. Inside
feature nodes (sketchExtrude), the full sketch context (`profile`, `config`,
`plane`, `planeOffset`, `operation`, `constraints`, `dimensions`,
`faceFrame`) is bundled into `node.sketchData`.

`NfabAssemblySnapshotV1`:
```ts
{ placedParts: PlacedPart[],
  mates: AssemblyMate[],
  bodies?: BodyEntry[],
  activeBodyId?, selectedBodyIds?, hiddenParts?, transparentParts?, partColors? }
```

`NfabManufacturing`:
```ts
{ camPostProcessorId?, camOperation?, smMaterial?, smThickness?,
  smKFactorOverride?, currency?, quoteQuantity? }
```

`NfabConfigurationV1`:
```ts
{ id, name, params, featureEnabled, paramExpressions? }
```

### 1.3 File-size envelope (today)

Measured on dev fixtures + 15 internal-use projects (May 2026): empty
project ~2 KB; single-part 10-feature ~25 KB; 50-feature with sketch
~80 KB; 5-part assembly with 30 mates ~200 KB; worst-observed gear train
~520 KB; thumbnail adds ~20-50 KB. 90th-percentile minified `.nfab` is
**~250 KB**. Cloud storage cost in this range is dominated by request
volume, not blob bytes (§3.4).

### 1.4 Mutation pattern (today)

`.nfab` is read-modify-write atomically on **save** (user clicks "Save as
.nfab" or Ctrl+S → file download / overwrite). There is no incremental
update concept. Every save serializes the entire React-state-derived
project to a fresh blob.

This is the model we replace. In the cloud model, the *Yjs op log* is
incremental (per CRDT architecture); a fresh `.nfab`-equivalent snapshot is
generated by the **collab worker** periodically (every 60 s active editing
or 5 KB pending ops, per CRDT doc §6 phase 5) and stored in R2.

### 1.5 What `.nfab`-on-disk gets us today (and we must preserve)

1. **Offline editing**. User opens a `.nfab` on a plane without WiFi, edits,
   saves. Cloud document migration must keep this working via IndexedDB
   cache + queued op log for replay on reconnect.
2. **External backup**. Users (especially design partners) hand a `.nfab`
   off to a customer or save it to their own NAS. Export must remain.
3. **Audit / paper trail**. A `.nfab` in a project folder is evidence of
   who designed what when. Cloud equivalents: `nf_documents.updated_at`,
   `nf_document_versions.created_by`, `nf_document_audit_log`.
4. **Air-gapped factory workflows**. A few design partners run NexyFab on
   isolated networks. They will keep using local `.nfab` indefinitely; this
   is supported via a "single-user / no-sync" mode in Phase 5.

---

## 2. Cloud Document Data Model

### 2.1 Postgres tables (canonical schema)

Naming convention: `nf_*` prefix (consistent with
`src/lib/db-postgres-migrations.sql`). All ids that reference application
state (`documents`, `workspaces`, `versions`) are `UUID`; user ids come from
`nf_users(id)` which is `TEXT` (legacy decision — keep).

```sql
-- ─── Workspaces ─────────────────────────────────────────────────────────
-- A workspace is a container of documents. Owner is the creator; others
-- get access via nf_workspace_members.role.
CREATE TABLE nf_workspaces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    TEXT        NOT NULL REFERENCES nf_users(id) ON DELETE RESTRICT,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ              -- soft-delete; 90-day GC
);

CREATE INDEX idx_nf_workspaces_owner ON nf_workspaces (owner_id)
  WHERE deleted_at IS NULL;

-- Workspace membership (workspace-level permission grant).
CREATE TABLE nf_workspace_members (
  workspace_id UUID NOT NULL REFERENCES nf_workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES nf_users(id)     ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','editor','commenter','viewer')),
  invited_by   TEXT REFERENCES nf_users(id),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_nf_workspace_members_user ON nf_workspace_members (user_id);

-- ─── Documents ──────────────────────────────────────────────────────────
-- One row per logical project. blob_r2_key points at the current Yjs
-- snapshot; collab worker rewrites this on every snapshot tick.
CREATE TABLE nf_documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT        NOT NULL REFERENCES nf_users(id) ON DELETE RESTRICT,
  workspace_id    UUID        REFERENCES nf_workspaces(id) ON DELETE SET NULL,
  -- If workspace_id is null, the document lives in the user's "Personal"
  -- pseudo-workspace (an implicit workspace per user).

  name            TEXT        NOT NULL,
  -- Current canonical blob (Yjs binary snapshot).
  blob_r2_key     TEXT        NOT NULL,
  -- Monotonic version counter; bumped on every snapshot commit.
  version         INTEGER     NOT NULL DEFAULT 1,

  -- Format/protocol versions so we can roll forward without breaking old clients.
  nfab_format     SMALLINT    NOT NULL DEFAULT 2,   -- mirrors NFAB_FORMAT_VERSION
  yjs_proto       SMALLINT    NOT NULL DEFAULT 1,   -- y-protocols version

  -- Lightweight metadata for list views without fetching the blob.
  thumbnail_r2_key TEXT,                            -- optional PNG, ~50 KB cap
  size_bytes      INTEGER     NOT NULL DEFAULT 0,   -- blob size; informational
  feature_count   INTEGER     NOT NULL DEFAULT 0,
  part_count      INTEGER     NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_edited_by  TEXT REFERENCES nf_users(id),
  deleted_at      TIMESTAMPTZ                       -- soft-delete; 90 d GC
);

CREATE INDEX idx_nf_documents_workspace ON nf_documents (workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_nf_documents_owner     ON nf_documents (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_nf_documents_deleted   ON nf_documents (deleted_at)
  WHERE deleted_at IS NOT NULL;        -- GC sweep filter

-- ─── Document-level permissions (overrides workspace-level role) ────────
-- If a row exists for (document_id, user_id), it overrides the workspace
-- role for that user on that document. Lets us share a single doc out of a
-- workspace, or restrict one doc to a subset of workspace members.
CREATE TABLE nf_document_permissions (
  document_id UUID NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES nf_users(id)    ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','editor','commenter','viewer')),
  granted_by  TEXT REFERENCES nf_users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  PRIMARY KEY (document_id, user_id)
);

CREATE INDEX idx_nf_document_permissions_user ON nf_document_permissions (user_id);

-- ─── Version history (branches + named checkpoints) ─────────────────────
-- Every snapshot tick writes a row here. Users can also explicitly
-- "Save version" / "Branch from here" to create labeled, retained
-- versions (which survive the rolling-window GC of unlabeled snapshots).
CREATE TABLE nf_document_versions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        UUID        NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  parent_version_id  UUID        REFERENCES nf_document_versions(id), -- linear or branched
  blob_r2_key        TEXT        NOT NULL,
  oplog_r2_key       TEXT,                                 -- optional: full op log since parent
  label              TEXT,                                 -- 'v1', 'for review', 'branch: gear-mod'
  branch_name        TEXT,                                 -- non-null on branch points
  is_explicit        BOOLEAN     NOT NULL DEFAULT FALSE,   -- TRUE = user-named, never GC'd
  size_bytes         INTEGER     NOT NULL DEFAULT 0,
  created_by         TEXT        NOT NULL REFERENCES nf_users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Future: thumbnail_r2_key, comments, etc.
  CHECK ((branch_name IS NULL) OR (parent_version_id IS NOT NULL))
);

CREATE INDEX idx_nf_document_versions_doc ON nf_document_versions (document_id, created_at DESC);
CREATE INDEX idx_nf_document_versions_explicit ON nf_document_versions (document_id)
  WHERE is_explicit = TRUE;

-- ─── Audit log (who did what, append-only) ──────────────────────────────
CREATE TABLE nf_document_audit_log (
  id           BIGSERIAL    PRIMARY KEY,
  document_id  UUID         NOT NULL REFERENCES nf_documents(id) ON DELETE CASCADE,
  user_id      TEXT         REFERENCES nf_users(id),
  action       TEXT         NOT NULL,    -- 'create','open','snapshot','version','share','revoke','rename','delete','restore','import','export'
  detail       JSONB,                    -- action-specific (e.g., {fromVersion, toVersion})
  ip_inet      INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nf_document_audit_doc ON nf_document_audit_log (document_id, created_at DESC);
```

#### 2.1.1 Why these tables, in this order

- **Workspaces before documents**: matches Onshape / Google Drive mental
  model and lets us bill per-workspace later (per-seat pricing tier needs a
  workspace boundary).
- **Two-tier permissions** (`nf_workspace_members` + `nf_document_permissions`):
  workspace role is the default for every doc in the workspace; document
  override is opt-in. Without override, a workspace `editor` is an editor on
  all docs in that workspace.
- **`version` integer on `nf_documents` + separate `nf_document_versions`
  table**: the integer lets the client do an optimistic-concurrency check
  ("I'm saving from version 47") cheaply. The history table gives full
  branching.
- **`is_explicit BOOLEAN`**: separates the firehose of 60-second auto-
  snapshots (GC'd after 30 days) from user-named checkpoints (retained
  indefinitely until the doc itself is deleted).
- **`audit_log` is BIGSERIAL, not UUID**: cheap append-only, no FK from
  versions, just an append stream for "who clicked what". Forensics +
  customer support.

### 2.2 What lives in Postgres vs R2 vs IndexedDB

| Item | Postgres | R2 | IndexedDB |
|------|----------|----|-----------|
| Document metadata (name, owner, version) | yes (`nf_documents`) | no | mirrored read-only |
| Permission ACL | yes (`nf_document_permissions`) | no | not cached |
| Yjs Y.Doc snapshot (binary) | no — only the R2 key | yes (`documents/{user}/{doc}/v{n}.ydoc`) | yes (latest snapshot, IndexedDB Yjs adapter) |
| Yjs op log (incremental updates) | no | yes (rolling buffer, append-only) | yes (pending ops queue when offline) |
| `.nfab` export blob | no | not stored persistently — generated on demand | optional download-history |
| Audit log entries | yes (`nf_document_audit_log`) | no | no |
| Workspace list, recent docs | yes | no | session cache (5 min) |
| Awareness state (cursors) | no | no | no (ephemeral in DO memory) |

Rules:
- **Postgres is the source of truth for *who can access what***.
- **R2 is the source of truth for *what the document contains***.
- **IndexedDB is a cache** — never authoritative. If IndexedDB and R2
  disagree, R2 wins after a fresh fetch; locally pending ops (offline edits)
  are replayed on top via the Yjs merge.
- The client **never trusts IndexedDB for ACL checks**. Permissions are
  re-validated on every API call and on every WebSocket handshake.

### 2.3 Document identity & URLs

- **Internal id**: `nf_documents.id` (UUID v4 / random).
- **URL slug**: short base62 of the UUID (~22 chars) → user-visible URL:
  `/shape-generator?doc=<slug>`.
- **No collision with workspaces**: workspace URLs use a separate prefix
  (`/workspaces/<slug>`).
- **Resolvability**: a slug always resolves to a `nf_documents.id`; we never
  expose user ids in URLs.

### 2.4 Workspace defaults

Every user gets an **implicit "Personal" workspace** on first cloud-doc
creation. Implementation: lazy — create the row in `nf_workspaces`
(`owner_id = user.id`, `name = 'Personal'`) on first document insert if
the user has no workspace yet. UI shows it as a system folder, undeletable.

Workspace deletion soft-deletes the workspace and cascade-soft-deletes
docs inside; both go through the 90-day GC. Document permissions on
cascade-deleted docs are removed by the audit-log-keeping GC pass (not
DB FK cascade — we want to retain audit history).

---

## 3. R2 Blob Layout

### 3.1 Path scheme

```
documents/
  {ownerId}/
    {docId}/
      current.ydoc                  # latest snapshot (mirror of versions/v{n}.ydoc for fast load)
      thumbnail.png                 # latest thumbnail (~50 KB)
      versions/
        v{n}.ydoc                   # snapshot at version n (n = nf_documents.version)
        v{n}.oplog                  # ops applied to reach version n (delta since v{n-1})
      branches/
        {branchName}/
          v{n}.ydoc
          v{n}.oplog
      exports/
        {exportId}.nfab             # on-demand .nfab JSON exports (TTL 24h, expired by lifecycle rule)
        {exportId}.step             # on-demand STEP exports (separate flow, not in scope here)
```

Notes:
- `current.ydoc` exists for fast first-load (one R2 GET) without the client
  needing to query Postgres first. It's a duplicate of the latest
  `versions/v{n}.ydoc`, written atomically by the collab worker on each
  snapshot.
- `{ownerId}` in the path is the original creator. Ownership transfer
  (rare; future feature) does **not** rewrite the R2 path — only Postgres
  metadata updates. The path stays stable.
- All writes go through signed PUT URLs from the API server; client never
  has direct R2 credentials. Reads go through signed GET URLs scoped to
  10 min.

### 3.2 Yjs snapshot format

Each `.ydoc` file is the output of `Y.encodeStateAsUpdate(doc)`:

- **Encoding**: binary protocol-v1 / proto-v2 (whichever pins to `nf_documents.yjs_proto`).
- **Size**: ~10-200 KB for a typical project, up to ~1 MB worst case.
- **Compression**: R2 stores raw bytes; we set `Content-Encoding: gzip` on
  PUT (gzip the buffer client-side before signed PUT). Saves ~50% on the
  wire and on R2 cost. Yjs payloads compress well (lots of repeated UUIDs).
- **Integrity**: SHA-256 of the (uncompressed) bytes is stored as the R2
  object's user-metadata `x-amz-meta-sha256`. Client verifies on download.

### 3.3 Op log

Between snapshots, **incremental updates** flow over WebSocket through the
Cloudflare Durable Object (see CRDT doc §6 phase 0). The DO also batches
ops into an op-log file in R2:

- Append batches every ~10 s of activity (or on snapshot tick).
- File: `versions/v{n}.oplog` containing one length-prefixed `Y.encodeStateAsUpdate`
  per batch.
- Purpose: replay (e.g., AI history reconstruction, post-mortem debugging,
  branch-from-arbitrary-point-in-time). Not load-critical — the snapshot
  alone is sufficient to open the doc.
- GC: op logs for non-`is_explicit` versions are deleted with their parent
  version row after 30 days.

### 3.4 Size budget per doc

Typical active doc (10 sketch sessions/week, 5 saves/day): `current.ydoc`
~200 KB (overwritten), `versions/v{n}.ydoc` × 5/day × 30 d retention
~30 MB, op logs ~4.5 MB, thumbnail ~50 KB → **~35 MB/active doc/month**.

R2 storage at $0.015/GB/mo → ~$0.0005/doc/mo. R2 PUT at $4.50/M ×
~150 snapshots/mo → ~$0.0007/doc/mo. GET cost negligible (cached via
`current.ydoc`). Storage is not the binding cost; Durable Object compute
time will dominate (CRDT doc §7.1).

### 3.5 Lifecycle rules (R2 bucket policy)

- `documents/*/exports/*` — TTL 24 h (signed-URL exports auto-expire).
- `documents/*/versions/v{n}.{ydoc,oplog}` where the matching Postgres row
  has `is_explicit = FALSE` and `created_at < NOW() - 30 days` — deleted by
  nightly cron.
- `documents/*` for docs with `nf_documents.deleted_at < NOW() - 90 days`
  — entire prefix deleted by nightly cron.
- Soft-deleted docs (within 90 d) retain blobs for restore.

---

## 4. API Endpoint Design

All endpoints under `/api/documents/*`. Auth: existing session cookie /
JWT (Wave 1 auth stack). Response shape: standard
`{ ok: true, data: ... }` / `{ ok: false, error: { code, message } }`.

### 4.1 Endpoint table

| Method | Path | Purpose | Required role |
|--------|------|---------|---------------|
| POST   | `/api/documents` | Create a new (empty) document. Returns id + signed PUT URL for initial blob. | authenticated user; workspace `editor` if `workspace_id` set |
| GET    | `/api/documents` | List documents the user can see. Query params: `workspace_id`, `q` (name search), `page`, `pageSize`. | authenticated |
| GET    | `/api/documents/:id` | Fetch metadata + 10-min signed GET URL for the current blob. | doc `viewer` or higher |
| PUT    | `/api/documents/:id` | Update name / workspace / thumbnail-key. **Not** blob — blob is owned by the collab worker. | doc `editor` |
| DELETE | `/api/documents/:id` | Soft-delete (`deleted_at = NOW()`). Restore via PUT `?undelete=1` within 90 d. | doc `owner` (or workspace `owner`) |
| POST   | `/api/documents/:id/versions` | Create an explicit (named) version. Body: `{ label, branch_name? }`. Server reads `current.ydoc`, copies to `versions/v{n}.ydoc`, inserts row. | doc `editor` |
| GET    | `/api/documents/:id/versions` | List versions of a doc. | doc `viewer` |
| GET    | `/api/documents/:id/versions/:vid` | Fetch version metadata + signed GET URL for `versions/v{n}.ydoc`. | doc `viewer` |
| POST   | `/api/documents/:id/versions/:vid/restore` | Set this version's blob as the new `current.ydoc` and bump `version`. Creates a new audit-trail version row. | doc `editor` |
| POST   | `/api/documents/:id/permissions` | Grant a user a role on this doc. Body: `{ user_id, role, expires_at? }`. Idempotent on PK. | doc `owner` |
| GET    | `/api/documents/:id/permissions` | List ACL entries for the doc. | doc `viewer` |
| DELETE | `/api/documents/:id/permissions/:userId` | Revoke. | doc `owner` |
| POST   | `/api/documents/import` | Multipart upload: client posts a `.nfab` file. Server validates JSON, runs migration to v2 if needed, converts to Yjs Y.Doc, writes blob + DB row. Returns new doc id. | authenticated |
| GET    | `/api/documents/:id/export` | Generate a fresh `.nfab` export. Server reads current Yjs doc, serializes via existing `serializeProject()`, uploads to `exports/{exportId}.nfab`, returns 24-h signed GET URL. | doc `viewer` |
| GET    | `/api/documents/:id/audit` | Tail of audit log (last 100 entries, paginated). | doc `editor` |

### 4.2 Create + open lifecycle (sequence)

```
Client                                  API                          R2          Postgres        DO (WS)
  │ POST /api/documents {name, workspace}  │                          │             │              │
  │ ─────────────────────────────────────▶ │  INSERT nf_documents     │             │              │
  │                                        │ ─────────────────────────┼────────────▶│              │
  │                                        │  signed PUT URL          │             │              │
  │ ◀───────────────────────────────────── │  for current.ydoc        │             │              │
  │                                        │                          │             │              │
  │  PUT (initial empty Y.Doc as bytes)    │                          │             │              │
  │ ───────────────────────────────────────┼──────────────────────────▶             │              │
  │                                        │                          │             │              │
  │  GET /api/documents/:id                │                          │             │              │
  │ ─────────────────────────────────────▶ │  SELECT + signed GET URL │             │              │
  │ ◀───────────────────────────────────── │                          │             │              │
  │  GET current.ydoc                      │                          │             │              │
  │ ───────────────────────────────────────┼──────────────────────────▶             │              │
  │ ◀───────────────────────────────────── │                          │             │              │
  │                                        │                          │             │              │
  │  WSS /doc/:id?token=<scoped JWT>       │                          │             │              │
  │ ─────────────────────────────────────────────────────────────────────────────────────────────▶│
  │  awareness, op stream                                                                          │
  │ ◀──────────────────────────────────────────────────────────────────────────────────────────── ▶│
```

### 4.3 Auth, scoping, signed URLs

- API authentication: session cookie (browser) or `Authorization: Bearer
  <jwt>` (CLI / API). Existing Wave 1 stack — no change.
- **Per-document scoped JWT** for WebSocket: API issues a short-lived
  (15 min) JWT with claims `{ doc_id, user_id, role, workspace_id, exp }`.
  DO validates on connect; rejects on role mismatch or expiry. Client
  refreshes via `/api/documents/:id/ws-token` before the JWT expires.
- **Signed R2 URLs**: 10 min for GETs, 5 min for PUTs. PUTs are limited to
  the `current.ydoc` path on the server side (the signed URL is generated
  with method + key locked). Client cannot PUT arbitrary keys.

### 4.4 Optimistic concurrency

Endpoints that mutate metadata (`PUT /api/documents/:id`) accept an
`If-Match: <version>` header. On mismatch → `409 Conflict` with current
version returned in the body so the client can refetch. Blob writes go
through DO (not REST), so the same concurrency check happens server-side in
the DO before the snapshot tick rewrites `current.ydoc`.

### 4.5 Error model

All errors use a 2-tier code:

```json
{ "ok": false,
  "error": {
    "code":    "document.not_found" |
               "document.permission_denied" |
               "document.deleted" |
               "document.version_mismatch" |
               "import.invalid_nfab" |
               "import.version_too_new" |
               "workspace.not_found" |
               "ratelimit",
    "message": "...",
    "hint":    "..."   // optional, customer-facing
  } }
```

Same shape as the existing partner API; reuse the error-handling middleware.

### 4.6 Rate limits

- Create document: 30 / hour / user.
- Import .nfab: 20 / hour / user (size limit 5 MB per file).
- Snapshot via DO: 1 / 60s / doc (the DO enforces, not REST).
- Export: 60 / hour / user.

Enforced via existing `nf_api_usage` table + middleware.

---

## 5. Existing `.nfab` File Import Path

Two import flows; both **one-shot** (not ongoing sync).

### 5.1 First-time import on file drag-drop

User drags a `.nfab` onto the shape-generator page (or clicks Open). Flow:

1. Client reads file as text → `parseProject(json)` (existing function).
2. If parse OK and `migrate()` returns `v2`, client POSTs the JSON to
   `/api/documents/import` (multipart, raw `.nfab` bytes).
3. Server validates:
   - `magic === 'nfab'`
   - `version <= NFAB_FORMAT_VERSION` (current=2)
   - Size < 5 MB
4. Server runs `nfabToYjs(project)` — a **new pure function** in
   `src/lib/cloudDoc/nfabToYjs.ts` (Phase 3 implementation; see CRDT doc
   §6 phase 3) that walks the JSON and applies Yjs ops in one transact():
   - `tree` → `Y.Array<Y.Map>` (each `HistoryNode`)
   - `node.sketchData` (where present) → entry in top-level `sketches`
     Y.Map; node gets `sketchRef: string`
   - `scene` → flat `Y.Map`
   - `assembly` → `Y.Map<nodeId>` + `mates` + `bodies`. **bodyIndex →
     bodyId** rewrite happens here using the `placedParts[i].id` mapping.
   - `manufacturing`, `meta`, `configurations`, `aiHistory`, `scadIntents`
     — direct translation per CRDT doc §2.8.
5. Server `Y.encodeStateAsUpdate(doc)` → uploads to
   `documents/{userId}/{newDocId}/current.ydoc` and `versions/v1.ydoc`.
6. Server INSERTs `nf_documents` (`version=1`, `nfab_format=2`,
   `feature_count` + `part_count` from a quick walk of `tree` and `bodies`).
7. Server returns `{ doc_id, slug }`. Client navigates to the new doc URL.

### 5.2 Bulk import (workspace migration)

For design partners who have a folder of `.nfab` files:

- `POST /api/documents/import/bulk` — multipart with N files; server
  processes serially (one DB transaction per file), returns
  `{ results: [{ filename, ok, doc_id?, error? }] }`.
- Rate limit: 100 / 24 h / user.
- Failure mode: per-file, no global rollback. User sees a CSV-style result.

### 5.3 Failure handling on import

- **Parse error** (corrupt JSON) → `400 import.invalid_nfab`, hint says
  "Try opening locally first; export a fresh copy."
- **Version too new** (`v3` from a future build) → `400 import.version_too_new`,
  hint links to release notes.
- **bodyIndex inconsistency** (mate references a body that's not in
  `placedParts`) → server emits a warning in the response; mate is dropped
  with a note in the audit log. Doc still imports.
- **Oversize** (> 5 MB) → `413`, hint says "Split into sub-assemblies."

### 5.4 What `nfabToYjs` does *not* do

- It does not re-run the solver. Sketch points/constraints are imported
  as-is; the next solver tick on the live doc re-converges.
- It does not re-mesh bodies. `volumeMm3 / bbox / surfaceAreaMm2` are
  copied over from the file; meshes are not in `.nfab` (the feature tree
  regenerates them).
- It does not validate face/edge tracker ids against the current geometry.
  Mismatches surface as orphan-red selection markers in the UI (same as
  today when opening a `.nfab` against newer geometry code).

### 5.5 Where the conversion code lives

- `src/lib/cloudDoc/nfabToYjs.ts` — pure function, no Yjs in the prod
  bundle until Phase 3 ships. Stub now (Phase 2) for API endpoint type
  contract; full body in Phase 3.
- `src/lib/cloudDoc/yjsToNfab.ts` — reverse direction, used by the export
  endpoint. Reads Yjs doc → `SerializeInput` → existing
  `serializeProject(input)`.

---

## 6. Migration Timeline (Phase-by-Phase)

Aligned with the CRDT migration phases in `docs/wave-2-crdt-architecture.md`
§6. This timeline covers the **cloud document** half — schema, R2 layout,
API endpoints. Implementation work happens in the same phase numbers.

### Phase 2 — Schema + half-built API (weeks 7-9, parallel with CRDT phase 2)

Goal: **new** documents are cloud-native; legacy `.nfab` users unaffected.

- [ ] Apply all 5 `nf_*` table DDL (`nf_workspaces`, `nf_workspace_members`,
      `nf_documents`, `nf_document_permissions`, `nf_document_versions`,
      `nf_document_audit_log`). Migration file:
      `src/lib/migrations/2026-06-XX_wave2_cloud_documents.sql`.
- [ ] Implement REST endpoints (read + create + list):
      - POST `/api/documents`
      - GET  `/api/documents`
      - GET  `/api/documents/:id`
      - PUT  `/api/documents/:id`  (metadata only)
      - DELETE `/api/documents/:id` (soft)
- [ ] R2 bucket policy + lifecycle rules deployed.
- [ ] Implicit "Personal" workspace auto-creation on first cloud-doc.
- [ ] Signed-URL flow (10 min GET, 5 min PUT).
- [ ] UI: "Save to cloud" button alongside existing "Save .nfab" (off by
      default; design-partner flag).
- [ ] Audit log writes on create / open / rename / delete.

**Ship criteria**: a design partner can create a new doc, save, close
browser, reopen, see the same doc. No collab yet — single-user only.

### Phase 3 — Import + full API + first cloud-only flows (weeks 10-14, parallel with CRDT phase 3)

Goal: existing `.nfab` files can become cloud docs. New users default to
cloud.

- [ ] Implement `POST /api/documents/import` + `nfabToYjs(project)`.
- [ ] Implement `GET /api/documents/:id/export` + `yjsToNfab(doc)`.
- [ ] Implement versions endpoints:
      - POST   `/api/documents/:id/versions`
      - GET    `/api/documents/:id/versions`
      - GET    `/api/documents/:id/versions/:vid`
      - POST   `/api/documents/:id/versions/:vid/restore`
- [ ] Permission endpoints:
      - POST   `/api/documents/:id/permissions`
      - GET    `/api/documents/:id/permissions`
      - DELETE `/api/documents/:id/permissions/:userId`
- [ ] UI: "Import .nfab" button on document list; drag-drop `.nfab` onto
      empty workspace creates a new cloud doc.
- [ ] **New user default flips to cloud** (Save .nfab still available as
      Export).
- [ ] Bulk-import endpoint for design-partner migrations.

**Ship criteria**: a design partner with a folder of `.nfab` files can
bulk-import them, share one with a teammate, and the teammate can open it
(read-only at this point — collab WS lands in CRDT phase 3).

### Phase 4 — Deprecate local `.nfab` as primary (weeks 15-18, parallel with CRDT phase 4)

Goal: cloud is the default; local `.nfab` is a read-only fallback and
backup format.

- [ ] All existing users get a one-time "Import your local files" banner
      on next sign-in (if they've used Save .nfab in the last 90 days).
- [ ] `.nfab` v3 ships (bodyIndex → bodyId migration; per CRDT doc §6
      phase 4). Import path handles v3.
- [ ] "Save .nfab" button is moved to File → Export menu (still works).
- [ ] Cloud documents become collab-enabled (WS via DO, per CRDT doc).
- [ ] Audit log surfaces in a UI panel ("History").
- [ ] Workspace UI (create / invite / member list / role change).

**Ship criteria**: > 80% of weekly active users have at least one cloud
doc. Local `.nfab` is no longer the default save target.

### Phase 5 — Cleanup + air-gap fallback (weeks 19-22, parallel with CRDT phase 5)

Goal: local `.nfab` is fully optional. Air-gapped factory mode supported.

- [ ] Single-user / no-sync mode for air-gapped users: cloud doc lives in
      IndexedDB only, no R2 / Postgres dependency. Same code path; Y.Doc
      persistence target swapped. (Engineering effort: ~3 days.)
- [ ] Soft-deleted doc GC cron sweeps `deleted_at < NOW() - 90 days`.
- [ ] Non-explicit version GC cron sweeps `created_at < NOW() - 30 days
      AND is_explicit = FALSE`.
- [ ] Documentation: customer-facing "Export and back up your designs"
      guide showing `.nfab` is still a first-class export.
- [ ] Migration completeness audit: any user with > 0 `.nfab` saves in
      the last 30 days but 0 cloud docs gets a follow-up email.

**Ship criteria**: `.nfab`-on-disk is purely an export / backup format.
Cloud is the source of truth for > 95% of weekly editing sessions.

### Phase 6+ — Future work (not committed)

- Branching UI (create branch from version, diff two branches, merge).
- Comments / annotations attached to features.
- Public share links (read-only, no account required).
- Full-text search across workspace docs (Postgres `tsvector` on
  `nf_documents.name` + metadata is enough for v1; later add a separate
  search index on body / sketch labels).
- Cross-workspace move ("Send a copy" → creates a new doc in the
  recipient's workspace).

---

## 7. Backwards Compatibility

The migration is **non-destructive to local files**: every `.nfab` ever
written keeps working. The contract:

### 7.1 `.nfab` v1 / v2 / v3 import

- **v1 and v2** — full import support indefinitely (existing migration
  chain in `nfabFormat.ts`). v1 → v2 → cloud Yjs doc.
- **v3** (Phase 4+) — adds `placedParts[i].id` as a stable identifier
  the export side needs to write. `migrateV2ToV3` is the reverse of the
  body-index → body-id rewrite done during cloud import.

### 7.2 Export always available

`GET /api/documents/:id/export` produces a `v2` (or `v3` post-Phase 4)
`.nfab` JSON that opens correctly in any future NexyFab build that
understands `NFAB_FORMAT_VERSION >= 2`. No "lossy" warnings — the JSON is
a complete round-trip of the doc state, because Yjs structures map 1:1
onto `.nfab` fields (modulo the bodyIndex → bodyId fix, which is benign).

Export limitations:
- No collab history (op log). The export is a snapshot, not a replay log.
- No comments / annotations once those exist (Phase 6+). They become a
  separate Postgres-only feature; `.nfab` is geometry + metadata.
- No permissions ACL. The export is a single file; sharing model resets
  to "whoever has the file."

### 7.3 Auto-suggest import on legacy file open

When a signed-in user opens a `.nfab` from disk (drag-drop or File →
Open), the UI prompts: "Save this design to your cloud workspace?" Yes →
runs the import flow §5.1 in the background, opens the new cloud doc; the
local `.nfab` stays untouched on disk as the user's backup. Cancel →
opens read-only in a session-only Y.Doc that does not persist anywhere
(closed-tab loses changes). Local "Save .nfab" still available in this
session.

### 7.4 IndexedDB as offline cache

Per CRDT doc §6, the Yjs doc is mirrored in IndexedDB on every snapshot.
On reconnect, pending local ops replay through the DO. If the user is
offline > 7 days, the local cache is **stale-but-usable**: they can keep
editing, and on reconnect the merge resolves per CRDT doc §4
(deterministic, with toasts for the rare lossy cases).

The IndexedDB cache is **per-user-per-browser-per-doc**. Clearing browser
data wipes it; no data loss because R2 has the canonical copy.

### 7.5 Email / link sharing

In Phase 4, a "Share" button generates a link of the form
`https://nexyfab.com/d/<slug>?invite=<token>`. Recipient must sign in;
the token grants the role specified at share-time (defaults to
`commenter`). This **replaces** the workflow of emailing a `.nfab`
attachment — though the export-attachment path still works for users who
prefer it.

---

## 8. Permission Model

### 8.1 Four roles

| Role | Read | Edit feature tree / sketch | Comment | Manage permissions | Delete doc |
|------|:----:|:---------------------------:|:-------:|:------------------:|:----------:|
| `viewer`    | yes | no  | no  | no  | no  |
| `commenter` | yes | no  | yes | no  | no  |
| `editor`    | yes | yes | yes | no  | no  |
| `owner`     | yes | yes | yes | yes | yes |

- **`viewer`** — read-only; can open, render, export `.nfab`. Cannot run
  parametric edits, cannot persist any change to the cloud doc.
- **`commenter`** — same as `viewer` plus can attach comments / markers
  (Phase 6 feature; ACL slot reserved now).
- **`editor`** — full CAD edit access; cannot reshare or change others'
  permissions.
- **`owner`** — everything, including delete, ownership transfer (future),
  and granting/revoking other users.

Exactly one user holds `owner` at any time (enforced by partial unique
index: `CREATE UNIQUE INDEX ON nf_document_permissions (document_id) WHERE
role = 'owner'` — added in the DDL alongside the main schema in Phase 2).

### 8.2 Workspace vs document scope

```
effective_role(user, doc) =
  if exists nf_document_permissions(doc, user):
    return nf_document_permissions.role
  else if exists nf_workspace_members(doc.workspace_id, user):
    return nf_workspace_members.role
  else:
    return null   // no access
```

`null` → `404 document.not_found` (we don't leak existence to unauthorized
users; intentional — same as Onshape / Google Drive).

Document-level overrides take precedence. This lets us:
- Workspace `editor` who should not edit a specific doc → grant them
  `viewer` on that doc.
- Workspace `viewer` who needs to edit one doc → grant them `editor` on
  that doc.

### 8.3 JWT claims for WebSocket

The scoped JWT issued by `GET /api/documents/:id/ws-token` contains:

```json
{
  "sub":          "<user_id>",
  "doc_id":       "<doc_uuid>",
  "workspace_id": "<workspace_uuid_or_null>",
  "role":         "owner|editor|commenter|viewer",
  "exp":          <unix_ts_15min_future>,
  "iat":          <unix_ts_now>
}
```

The Durable Object validates `doc_id` matches the WS path, `exp` is in
the future, and `role != null` before accepting the connection. Mid-session
demotion: role changes invalidate the JWT immediately; the DO re-checks on
the next op (max 15-min lag without proactive revocation). Phase 5 adds a
"force-disconnect" message from API → DO via DO RPC for instant revocation.

### 8.4 Read-only enforcement (viewers / commenters)

Yjs is **shared-state-by-default**; a viewer with a valid Y.Doc handle
could theoretically `Y.Map.set(...)` and propagate. We defend at three
layers:

1. **UI**: `useEffectiveRole(doc)` returns the role; all edit UI is
   gated. (`disabled` on buttons, etc.) Trivial bypass via dev tools, but
   stops the 99% case.
2. **DO server**: every incoming op message includes the user's role
   claim (from the JWT). DO rejects ops if `role in ('viewer', 'commenter')`.
   This is the hard enforcement.
3. **Audit**: rejected ops are logged with the user id and op summary so
   we can spot pen-test attempts.

### 8.5 Workspace-level membership UI

Phase 4 ships a workspace settings page:
- Member list with role column.
- Invite by email (creates a row in `nf_workspace_members` with
  `joined_at = NULL` until accepted; reuses existing partner-invite flow).
- Change role / remove member (owner only).
- Workspace transfer ("Make X owner of this workspace") — Phase 6+.

### 8.6 Auditing permission changes

Every grant / revoke in `nf_document_permissions` and
`nf_workspace_members` writes to `nf_document_audit_log` (`action = 'share'`
or `'revoke'`) with `detail = { user_id, role, expires_at }`. Owners
inspect via the History panel; PII redaction happens server-side before
display.

---

## 9. Risk + Reversal

The migration runs alongside live CRDT work — both must ship together to
unlock collab. Reversal options vary by phase.

### 9.1 Top risks (cloud-doc-specific)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R2 outage → no doc loads | Low | High | `current.ydoc` is the only fast-path GET; IndexedDB cache covers ~80% of re-opens during a short outage. Status page + retry-with-backoff. |
| Postgres outage → no metadata, no auth | Low | High | Read-only fallback: serve docs from IndexedDB cache; refuse writes; show banner. Reuse Wave 1 read-only-mode middleware. |
| Permission misconfig leaks a doc | Medium | Very High | Server-side ACL re-check on every API + WS handshake; never trust client. Audit log retains all `share` / `revoke`. Penetration test before Phase 4 ship. |
| `nfabToYjs` corrupts mate references on import | Medium | High | Per-file unit tests on 50 sample `.nfab` (10 fixtures + 40 internal projects). Audit log records dropped-mate warnings. Re-import allowed (delete + retry). |
| 90-day soft-delete GC over-deletes | Low | Very High | Two-stage: cron writes to `_gc_pending` table 7 days before deletion; admin must approve manually for first 3 months of operation. Then auto. |
| Signed-URL leakage (URL in logs) | Medium | Medium | URLs are 10-min GET only; revoked by client SHA in DO if abuse seen. Headers stripped from access logs in Wave 1 already. |
| User imports a 5 MB `.nfab` that creates a 10 MB Yjs blob | Medium | Medium | Server-side conversion has a 30 s budget; over-budget → 413 with hint. Real fix: streaming nfabToYjs (Phase 5+, low priority). |
| Workspace deletion cascade-deletes shared docs unexpectedly | Low | High | Cascade is `ON DELETE SET NULL` for `nf_documents.workspace_id` — orphaned docs survive in the user's Personal workspace. UI explicit confirm: "5 docs will move to Personal." |
| Cloud cost balloons (DO compute + R2 ops + Postgres rows) | Medium | Medium | Per-workspace cost monitoring via existing `nf_api_usage`; alert at $50/mo per workspace. Hard cap on R2 writes per doc per day (1000). |
| Air-gapped customers stranded if we deprecate `.nfab` | Low | High | Air-gap mode is in Phase 5 scope explicitly; `.nfab` Save/Open remain forever. |

### 9.2 Reversal plans

| Phase | Reversal action | Cost |
|-------|-----------------|------|
| 2 | Drop 5 new tables; delete API code. No production users yet (flagged off). | 1 eng-day |
| 3 | Script `scripts/wave2-bulk-export.ts`: walk `nf_documents` per user → `yjsToNfab` → zip → email link. Disable cloud-save UI; revert to local `.nfab`. | 1 eng-week + 2 wk support tail |
| 4 | Same as Phase 3, plus collab is on. Bulk export works for geometry; permissions become unenforceable once each user has their own `.nfab` copy. 4-week advance notice, opt-in per-workspace migration. | 3 eng-weeks + 6 wk comms |
| 5 | Air-gap mode becomes the default. DO / WS infrastructure shut down; metadata tables preserved as historical audit. | 2 eng-weeks |

### 9.3 Cost / capital tier-down

If we need to cut cloud costs aggressively (e.g., bridge funding gap):

- **Tier 1** (drop ~40% cost) — disable Cloudflare Workers fan-out;
  collab still works via DO direct WS, just less efficient.
- **Tier 2** (drop ~70% cost) — disable DO; collab becomes turn-based
  (save → notify → reload), Yjs still merges on each save. Worse UX but
  schema and API unchanged. Achievable in 2 days.
- **Tier 3** (drop ~90% cost) — disable cloud entirely; flip air-gap
  mode on for all users. `.nfab` becomes default again. Achievable in
  1 day (UI flag).

Each tier preserves data — Postgres + R2 retain everything. No customer
data loss in any tier-down.

### 9.4 Decision checkpoints

After each phase ship, hold a 1-hour "continue / pivot / reverse" review
against these signals:

- API P95 latency on `GET /api/documents/:id` < 200 ms
- Import success rate > 95% (rejecting only truly corrupt `.nfab`)
- R2 cost per active workspace < $0.50/mo
- No more than 1 user-reported "I lost my doc" incident per phase
- Permission-leak penetration test: 0 critical findings

If any two consecutive signals fail two reviews in a row, halt and
re-evaluate. The ADR-010 commitment is to cloud-first as a **goal**, not
this specific R2 + Postgres path.

---

## 10. Open Questions (Parking Lot)

Not blocking design approval; must be answered before Phase 4 ship.

1. **Multi-region R2** — EU residency for German design partners? R2
   supports jurisdictional placement; bucket-per-region rewrite is non-
   trivial post-launch. Decide before Phase 4.
2. **Audit log export** — regulated-industry customers want PDF/CSV of
   `nf_document_audit_log` per doc. Phase 6+; schema already supports it.
3. **Per-version thumbnails** — add `thumbnail_r2_key` to versions in
   Phase 5 if user feedback warrants.
4. **Snapshot dedup** — SHA-256 lookup before PUT could save ~30% on R2
   writes. Phase 5 candidate.
5. **NexyFlow integration** — embedded viewer vs static thumbnail when a
   doc is shared into a NexyFlow channel? Coordinate Phase 4.
6. **Export concurrency** — rate-limit at 60/h/user covers v1; add job
   queue (existing `nf_jobs`) if throughput insufficient.
7. **Workspace transfer** — schema supports it (`owner_id` is just an
   FK); UI + audit flow Phase 6+.

---

## 11. Acceptance Criteria for This Plan

This document is "done" when:

- [x] The 6 tables (`nf_workspaces`, `nf_workspace_members`,
      `nf_documents`, `nf_document_permissions`, `nf_document_versions`,
      `nf_document_audit_log`) have full DDL above.
- [x] R2 path scheme is unambiguous and shown in §3.1.
- [x] Every API endpoint has method + path + role requirement in §4.1.
- [x] Import flow from existing `.nfab` is described step-by-step in §5.1.
- [x] Phase-by-phase implementation order aligns with the CRDT doc.
- [x] Reversal path exists at every phase boundary.
- [x] Permission model resolves the workspace-vs-document precedence.
- [x] All four roles (`owner / editor / commenter / viewer`) have
      defined capability matrix in §8.1.

Implementation begins when:
- ADR-010 is approved.
- This document is reviewed by the wave-2 architect + 1 product partner.
- The CRDT architecture document is approved.
- Cost projection (separate finance memo) is approved.

---

## Appendix A — Schema deltas vs current `.nfab` v2

Field-by-field map of what becomes what:

| `.nfab` v2 field | Cloud equivalent | Notes |
|------------------|------------------|-------|
| `magic`, `version` | `nf_documents.nfab_format` | Versioned at the row level. |
| `createdAt` | `nf_documents.created_at` | Postgres TIMESTAMPTZ. |
| `updatedAt` | `nf_documents.updated_at` | Auto-updated by trigger. |
| `name` | `nf_documents.name` | Synced both ways via PUT. |
| `thumbnail` | R2 `documents/{owner}/{doc}/thumbnail.png` + `nf_documents.thumbnail_r2_key` | Stored once, not per-version (Phase 5 may add per-version). |
| `tree`, `scene`, `assembly`, `manufacturing`, `meta`, `configurations`, `aiHistory`, `scadIntents` | Inside the Yjs Y.Doc; persisted at R2 `current.ydoc`. | Per CRDT doc §2. |
| `activeConfigurationId` | Yjs `scene.activeConfigurationId` | Inside the Y.Doc. |

Fields **without** a current `.nfab` equivalent (new in cloud model):
- `nf_documents.workspace_id`, `owner_id`, `last_edited_by`
- `nf_documents.version` (monotonic counter)
- `nf_documents.deleted_at` (soft delete)
- `nf_document_permissions.*`
- `nf_document_versions.*`
- `nf_document_audit_log.*`

Fields **dropped** (in cloud, not persisted):
- `node.editingActive`, `node.error` — already stripped by
  `stripRuntimeFields` on serialize today; cloud doc never persists them.

---

## Appendix B — Glossary

- **`.nfab`** — current local file format for NexyFab projects; JSON,
  versioned (v1 / v2 today), described in §1.
- **Cloud document** — a `nf_documents` row + its R2 blob + Yjs Y.Doc;
  the new canonical project unit.
- **Snapshot** — `Y.encodeStateAsUpdate(doc)` output stored as a single
  binary blob in R2. Mirrored at `current.ydoc` (fast path) and
  `versions/v{n}.ydoc` (history).
- **Op log** — incremental Yjs update messages between snapshots, stored
  in `versions/v{n}.oplog`. Useful for replay; not required for load.
- **Workspace** — container of documents with shared membership. Implicit
  "Personal" workspace exists per user.
- **DO** — Cloudflare Durable Object; hosts one `y-websocket` session
  per doc (per CRDT doc §6).
- **Scoped JWT** — short-lived (15 min) JWT containing `doc_id`,
  `user_id`, `role`; used to authenticate the WS handshake.
- **Effective role** — the role a user has on a specific doc after
  resolving document-level overrides over workspace-level membership.
  See §8.2.
- **Soft delete** — `nf_documents.deleted_at = NOW()`; row retained for
  90 days, then GC'd.
- **Air-gap mode** — Phase 5 single-user mode where the cloud doc lives
  in IndexedDB only, no network. For factory-floor / isolated-network
  customers.

---

*End of plan.* Design only — no source modifications. Approve to begin
implementation in Phase 2 (weeks 7-9).
