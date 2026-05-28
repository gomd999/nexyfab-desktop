/**
 * document-permissions.test.ts
 *
 * Tests the Wave 2 document ACL resolver in isolation. The DB is mocked with
 * a small in-memory store keyed off the SQL substrings that
 * `document-permissions.ts` issues. We mock *just enough* SQL surface to
 * cover the contract — not a full SQL engine.
 *
 * Three modules under test:
 *   - effectiveRole(userId, docId, db)
 *   - requireRole(userId, docId, minRole, db)
 *   - listAccessibleDocs(userId, db)
 *
 * Test contract:
 *   effectiveRole       — 7 cases (owner / editor / viewer / commenter /
 *                         workspace-only / no-access / cross-user)
 *   requireRole         — 3 cases (sufficient / insufficient / not-found)
 *   listAccessibleDocs  — 4 cases (own / shared / workspace / mixed)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DbAdapter } from './db-adapter';
import {
  effectiveRole,
  requireRole,
  listAccessibleDocs,
  roleSatisfies,
  DocumentPermissionError,
  type DocumentRole,
} from './document-permissions';

// ───────────────────────────────────────────────────────────────────────────
// In-memory store + SQL-substring-driven mock adapter
// ───────────────────────────────────────────────────────────────────────────

interface DocRow {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  deleted_at: number | null;
  updated_at: number;
}

interface DocPermRow {
  document_id: string;
  user_id: string;
  role: DocumentRole;
  expires_at: number | null;
}

interface WsMemberRow {
  workspace_id: string;
  user_id: string;
  role: DocumentRole;
}

const store = {
  documents: [] as DocRow[],
  docPerms:  [] as DocPermRow[],
  wsMembers: [] as WsMemberRow[],
};

function resetStore(): void {
  store.documents = [];
  store.docPerms  = [];
  store.wsMembers = [];
}

/**
 * Minimal DbAdapter implementation that recognises exactly the SQL shapes
 * issued by document-permissions.ts. Match is done on substring patterns —
 * fragile by design, so any unintended SQL change will fail loudly.
 */
function makeMockAdapter(backend: 'sqlite' | 'postgres' = 'sqlite'): DbAdapter {
  return {
    backend,

    async queryOne<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      // 1. SELECT id, workspace_id FROM nf_documents WHERE id = ? AND deleted_at IS NULL
      if (/FROM nf_documents WHERE id = \? AND deleted_at IS NULL/.test(sql)) {
        const [docId] = params as [string];
        const d = store.documents.find(x => x.id === docId && x.deleted_at == null);
        if (!d) return undefined;
        return { id: d.id, workspace_id: d.workspace_id } as unknown as T;
      }

      // 2. SELECT role, expires_at FROM nf_document_permissions
      if (/FROM nf_document_permissions/.test(sql) && /role.*expires_at/.test(sql)) {
        const [docId, userId] = params as [string, string];
        const p = store.docPerms.find(x => x.document_id === docId && x.user_id === userId);
        if (!p) return undefined;
        return { role: p.role, expires_at: p.expires_at } as unknown as T;
      }

      // 3. SELECT role FROM nf_workspace_members
      if (/FROM nf_workspace_members/.test(sql)) {
        const [wsId, userId] = params as [string, string];
        const m = store.wsMembers.find(x => x.workspace_id === wsId && x.user_id === userId);
        if (!m) return undefined;
        return { role: m.role } as unknown as T;
      }

      throw new Error(`Unrecognised queryOne SQL in mock:\n${sql}`);
    },

    async queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      // listAccessibleDocs UNION-shaped query — we recognise it by the joined
      // table set (nf_documents + nf_document_permissions + nf_workspace_members).
      if (
        /FROM nf_documents d/.test(sql) &&
        /LEFT JOIN nf_document_permissions dp/.test(sql) &&
        /LEFT JOIN nf_workspace_members wm/.test(sql)
      ) {
        const [userId1, nowVal, userId2] = params as [string, number | string, string];
        expect(userId1).toBe(userId2);            // sanity: same user on both branches
        const nowMs = typeof nowVal === 'number' ? nowVal : Date.parse(nowVal);

        const rows = store.documents
          .filter(d => d.deleted_at == null)
          .map(d => {
            const dp = store.docPerms.find(p =>
              p.document_id === d.id &&
              p.user_id === userId1 &&
              (p.expires_at == null || p.expires_at > nowMs),
            );
            const wm = d.workspace_id
              ? store.wsMembers.find(m => m.workspace_id === d.workspace_id && m.user_id === userId1)
              : undefined;
            if (!dp && !wm) return null;
            return {
              id:           d.id,
              name:         d.name,
              workspace_id: d.workspace_id,
              owner_id:     d.owner_id,
              doc_role:       dp?.role ?? null,
              workspace_role: wm?.role ?? null,
              updated_at:   d.updated_at,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        rows.sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
        return rows as unknown as T[];
      }

      throw new Error(`Unrecognised queryAll SQL in mock:\n${sql}`);
    },

    async execute(): Promise<{ changes: number }> { return { changes: 0 }; },
    async executeRaw(): Promise<void> { /* no-op */ },
    async transaction<T>(fn: (d: DbAdapter) => Promise<T>): Promise<T> { return fn(this); },
    async close(): Promise<void> { /* no-op */ },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Seed helpers
// ───────────────────────────────────────────────────────────────────────────

function seedDoc(opts: Partial<DocRow> & { id: string; owner_id: string }): void {
  store.documents.push({
    workspace_id: null,
    name:         opts.id,
    deleted_at:   null,
    updated_at:   Date.now(),
    ...opts,
  } as DocRow);
}

function seedDocPerm(row: DocPermRow): void { store.docPerms.push(row); }
function seedWsMember(row: WsMemberRow): void { store.wsMembers.push(row); }

// ═══════════════════════════════════════════════════════════════════════════
// effectiveRole — 7 cases
// ═══════════════════════════════════════════════════════════════════════════

describe('effectiveRole', () => {
  let db: DbAdapter;

  beforeEach(() => {
    resetStore();
    db = makeMockAdapter();
  });

  it('returns "owner" when a doc-perm owner row exists', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-1', role: 'owner', expires_at: null });

    expect(await effectiveRole('user-1', 'doc-1', db)).toBe('owner');
  });

  it('returns "editor" when a doc-perm editor row exists', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-2', role: 'editor', expires_at: null });

    expect(await effectiveRole('user-2', 'doc-1', db)).toBe('editor');
  });

  it('returns "viewer" when a doc-perm viewer row exists', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-3', role: 'viewer', expires_at: null });

    expect(await effectiveRole('user-3', 'doc-1', db)).toBe('viewer');
  });

  it('returns "commenter" when a doc-perm commenter row exists', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-4', role: 'commenter', expires_at: null });

    expect(await effectiveRole('user-4', 'doc-1', db)).toBe('commenter');
  });

  it('falls back to workspace membership when no doc-perm row exists', async () => {
    // Doc lives in workspace ws-1, user is a workspace editor — no direct grant.
    seedDoc({ id: 'doc-1', owner_id: 'user-1', workspace_id: 'ws-1' });
    seedWsMember({ workspace_id: 'ws-1', user_id: 'user-2', role: 'editor' });

    expect(await effectiveRole('user-2', 'doc-1', db)).toBe('editor');
  });

  it('returns null when user has neither doc-perm nor workspace membership', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1', workspace_id: 'ws-1' });
    // Workspace exists but user-99 isn't a member, no doc-perm either.

    expect(await effectiveRole('user-99', 'doc-1', db)).toBeNull();
  });

  it('does not leak access across users (other-user doc-perm row is ignored)', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    // user-1 owns the doc, user-2 has editor, but user-3 should see nothing.
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-1', role: 'owner', expires_at: null });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-2', role: 'editor', expires_at: null });

    expect(await effectiveRole('user-3', 'doc-1', db)).toBeNull();
  });

  // Extra coverage: expired doc-perm row falls through to workspace.
  it('treats an expired doc-perm row as absent and falls through to workspace', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1', workspace_id: 'ws-1' });
    seedDocPerm({
      document_id: 'doc-1',
      user_id:     'user-2',
      role:        'editor',
      expires_at:  Date.now() - 60_000,   // expired one minute ago
    });
    seedWsMember({ workspace_id: 'ws-1', user_id: 'user-2', role: 'viewer' });

    expect(await effectiveRole('user-2', 'doc-1', db)).toBe('viewer');
  });

  // Soft-deleted doc returns null even to its owner.
  it('returns null for a soft-deleted document', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1', deleted_at: Date.now() - 1000 });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-1', role: 'owner', expires_at: null });

    expect(await effectiveRole('user-1', 'doc-1', db)).toBeNull();
  });

  // Defensive: empty inputs.
  it('returns null for empty userId or docId', async () => {
    expect(await effectiveRole('',  'doc-1', db)).toBeNull();
    expect(await effectiveRole('u', '',      db)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// requireRole — 3 cases
// ═══════════════════════════════════════════════════════════════════════════

describe('requireRole', () => {
  let db: DbAdapter;

  beforeEach(() => {
    resetStore();
    db = makeMockAdapter();
  });

  it('returns the role when user has sufficient permission', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-1', role: 'editor', expires_at: null });

    const r = await requireRole('user-1', 'doc-1', 'editor', db);
    expect(r).toBe('editor');
  });

  it('throws DocumentPermissionError(403) when role is insufficient', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    seedDocPerm({ document_id: 'doc-1', user_id: 'user-2', role: 'viewer', expires_at: null });

    await expect(requireRole('user-2', 'doc-1', 'editor', db))
      .rejects.toMatchObject({
        name:       'DocumentPermissionError',
        code:       'document.permission_denied',
        httpStatus: 403,
      });
  });

  it('throws DocumentPermissionError(404) when user has no access at all', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    // user-99 has no rows anywhere

    await expect(requireRole('user-99', 'doc-1', 'viewer', db))
      .rejects.toMatchObject({
        name:       'DocumentPermissionError',
        code:       'document.not_found',
        httpStatus: 404,
      });
  });

  // Bonus: the error is an instance of DocumentPermissionError so callers can
  // catch by class.
  it('throws an instanceof DocumentPermissionError', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1' });
    try {
      await requireRole('user-99', 'doc-1', 'viewer', db);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentPermissionError);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// listAccessibleDocs — 4 cases
// ═══════════════════════════════════════════════════════════════════════════

describe('listAccessibleDocs', () => {
  let db: DbAdapter;

  beforeEach(() => {
    resetStore();
    db = makeMockAdapter();
  });

  it('returns docs the user directly owns', async () => {
    seedDoc({ id: 'doc-own', owner_id: 'user-1', updated_at: 1000 });
    seedDocPerm({ document_id: 'doc-own', user_id: 'user-1', role: 'owner', expires_at: null });

    const docs = await listAccessibleDocs('user-1', db);

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('doc-own');
    expect(docs[0].role).toBe('owner');
    expect(docs[0].via).toBe('document');
  });

  it('returns docs shared with the user via doc-perm grants', async () => {
    seedDoc({ id: 'doc-shared', owner_id: 'user-1', updated_at: 2000 });
    seedDocPerm({ document_id: 'doc-shared', user_id: 'user-2', role: 'editor', expires_at: null });

    const docs = await listAccessibleDocs('user-2', db);

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('doc-shared');
    expect(docs[0].role).toBe('editor');
    expect(docs[0].via).toBe('document');
  });

  it('returns docs accessible via workspace membership only', async () => {
    seedDoc({ id: 'doc-ws-1', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: 3000 });
    seedDoc({ id: 'doc-ws-2', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: 1500 });
    seedWsMember({ workspace_id: 'ws-1', user_id: 'user-2', role: 'viewer' });

    const docs = await listAccessibleDocs('user-2', db);

    expect(docs.map(d => d.id)).toEqual(['doc-ws-1', 'doc-ws-2']);  // updated_at DESC
    expect(docs.every(d => d.role === 'viewer')).toBe(true);
    expect(docs.every(d => d.via === 'workspace')).toBe(true);
  });

  it('returns mixed: workspace + direct perm + ignores no-access docs', async () => {
    // doc-A: workspace-only (user has ws-1 editor)
    seedDoc({ id: 'doc-A', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: 5000 });
    // doc-B: doc-perm only (user has direct viewer grant, no workspace involvement)
    seedDoc({ id: 'doc-B', owner_id: 'user-1', workspace_id: null,  updated_at: 4000 });
    seedDocPerm({ document_id: 'doc-B', user_id: 'user-2', role: 'viewer', expires_at: null });
    // doc-C: both — doc-perm should win (commenter beats workspace viewer? no:
    // doc-perm precedence by design, regardless of relative rank)
    seedDoc({ id: 'doc-C', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: 3000 });
    seedDocPerm({ document_id: 'doc-C', user_id: 'user-2', role: 'commenter', expires_at: null });
    // doc-D: no access (different workspace, no doc-perm)
    seedDoc({ id: 'doc-D', owner_id: 'user-1', workspace_id: 'ws-2', updated_at: 2000 });
    // doc-E: soft-deleted, should be filtered out even if user would otherwise see it
    seedDoc({ id: 'doc-E', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: 1000, deleted_at: Date.now() });

    seedWsMember({ workspace_id: 'ws-1', user_id: 'user-2', role: 'editor' });

    const docs = await listAccessibleDocs('user-2', db);

    // Expected: doc-A (ws editor), doc-B (direct viewer), doc-C (direct commenter).
    // Soft-deleted doc-E and no-access doc-D filtered out.
    expect(docs.map(d => d.id)).toEqual(['doc-A', 'doc-B', 'doc-C']);

    const byId = new Map(docs.map(d => [d.id, d]));
    expect(byId.get('doc-A')?.role).toBe('editor');     // workspace path
    expect(byId.get('doc-A')?.via).toBe('workspace');
    expect(byId.get('doc-B')?.role).toBe('viewer');     // direct path
    expect(byId.get('doc-B')?.via).toBe('document');
    expect(byId.get('doc-C')?.role).toBe('commenter');  // doc-perm wins over ws-editor
    expect(byId.get('doc-C')?.via).toBe('document');
  });

  it('returns empty array for unknown user', async () => {
    seedDoc({ id: 'doc-1', owner_id: 'user-1', workspace_id: 'ws-1' });
    seedWsMember({ workspace_id: 'ws-1', user_id: 'user-1', role: 'owner' });

    expect(await listAccessibleDocs('user-not-here', db)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// roleSatisfies — small sanity coverage on the ordering helper
// ═══════════════════════════════════════════════════════════════════════════

describe('roleSatisfies', () => {
  it('owner satisfies every role', () => {
    expect(roleSatisfies('owner', 'owner')).toBe(true);
    expect(roleSatisfies('owner', 'editor')).toBe(true);
    expect(roleSatisfies('owner', 'commenter')).toBe(true);
    expect(roleSatisfies('owner', 'viewer')).toBe(true);
  });

  it('editor satisfies editor and below, not owner', () => {
    expect(roleSatisfies('editor', 'owner')).toBe(false);
    expect(roleSatisfies('editor', 'editor')).toBe(true);
    expect(roleSatisfies('editor', 'commenter')).toBe(true);
    expect(roleSatisfies('editor', 'viewer')).toBe(true);
  });

  it('viewer satisfies only viewer', () => {
    expect(roleSatisfies('viewer', 'owner')).toBe(false);
    expect(roleSatisfies('viewer', 'editor')).toBe(false);
    expect(roleSatisfies('viewer', 'commenter')).toBe(false);
    expect(roleSatisfies('viewer', 'viewer')).toBe(true);
  });
});
