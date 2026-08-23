import BetterSqlite from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import {
  buildAssemblyDrawingHandoff,
  serializeAssemblyDrawingHandoff,
  type AssemblyDrawingHandoff,
} from '@/app/[lang]/shape-generator/assembly/drawingHandoff';

const state = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/lib/db-adapter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db-adapter')>();
  return { ...actual, getDbAdapter: () => state.getDb() };
});
vi.mock('@/lib/nexysys-sso', () => ({
  verifyNexysysToken: async () => null,
  resolveOrProvisionUser: async () => null,
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { POST } from './route';
import { GET } from './[handoffId]/route';

const projectId = 'project-1';
const revisionHash = 'a'.repeat(64);
const context = { params: Promise.resolve({ id: projectId }) };

let database: BetterSqlite.Database;
let db: DbAdapter;
let tokens: Record<'editor' | 'viewer' | 'outsider', string>;

function adapter(source: BetterSqlite.Database): DbAdapter {
  const value: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).get(...params) as T | undefined; },
    async queryAll<T>(sql: string, ...params: SqlParam[]) { return source.prepare(sql).all(...params) as T[]; },
    async execute(sql: string, ...params: SqlParam[]) { return { changes: source.prepare(sql).run(...params).changes }; },
    async executeRaw(sql: string) { source.exec(sql); },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) {
      source.exec('BEGIN IMMEDIATE');
      try { const result = await fn(value); source.exec('COMMIT'); return result; }
      catch (error) { source.exec('ROLLBACK'); throw error; }
    },
    async close() { source.close(); },
  };
  return value;
}

function requestHeaders(token: string, orgId: string) {
  return {
    authorization: `Bearer ${token}`,
    'x-nexyfab-org-id': orgId,
    origin: 'https://local.test',
    host: 'local.test',
    'content-type': 'application/json',
  };
}

function post(token: string, orgId: string, body: unknown) {
  return new NextRequest(`https://local.test/api/nexyfab/projects/${projectId}/drawing-handoffs`, {
    method: 'POST', headers: requestHeaders(token, orgId), body: JSON.stringify(body),
  });
}

function get(token: string, orgId: string, handoffId: string) {
  return new NextRequest(`https://local.test/api/nexyfab/projects/${projectId}/drawing-handoffs/${handoffId}`, {
    headers: requestHeaders(token, orgId),
  });
}

async function handoff(revision = 4, contentSha256 = revisionHash) {
  return buildAssemblyDrawingHandoff({
    projectId,
    workspaceRevision: revision,
    workspaceContentSha256: contentSha256,
    state: {
      parts: [{
        id: 'part-1', name: 'Bracket', partTemplateId: 'bracket', fixed: true,
        position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT,
      }],
      mates: [],
    },
    featureTrees: {
      'part-1': { nodes: [{
        id: 'extrude-1', name: 'Base', dependencies: [],
        payload: {
          kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }],
          depth: 2, direction: 'one_sided', mode: 'add',
        },
      }] },
    },
  });
}

beforeEach(async () => {
  vi.stubEnv('NEXYFAB_DB_PATH', 'C:\\durable-test\\local-sqlite-integration.db');
  database = new BetterSqlite(':memory:');
  db = adapter(database);
  state.getDb.mockReturnValue(db);
  database.exec(`
    CREATE TABLE nf_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, plan TEXT NOT NULL, role TEXT NOT NULL,
      email_verified INTEGER NOT NULL, locked_until BIGINT, pro_grace_until BIGINT,
      plan_expires_at BIGINT, plan_fallback TEXT
    );
    CREATE TABLE nf_user_roles (user_id TEXT NOT NULL, product TEXT NOT NULL, role TEXT NOT NULL, org_id TEXT);
    CREATE TABLE nf_orgs (id TEXT PRIMARY KEY, plan TEXT NOT NULL);
    CREATE TABLE nf_org_members (org_id TEXT NOT NULL, user_id TEXT NOT NULL);
    CREATE TABLE nf_projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT);
    CREATE TABLE nf_project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY(project_id, user_id));
    CREATE TABLE nf_cad_workspace_heads (project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, content_hash TEXT NOT NULL, updated_at BIGINT NOT NULL);
    INSERT INTO nf_orgs VALUES ('org-1', 'pro'), ('org-2', 'pro');
    INSERT INTO nf_users VALUES
      ('editor', 'editor@test.invalid', 'pro', 'user', 1, NULL, NULL, NULL, NULL),
      ('viewer', 'viewer@test.invalid', 'pro', 'user', 1, NULL, NULL, NULL, NULL),
      ('outsider', 'outsider@test.invalid', 'pro', 'user', 1, NULL, NULL, NULL, NULL);
    INSERT INTO nf_org_members VALUES ('org-1', 'editor'), ('org-1', 'viewer'), ('org-2', 'outsider');
    INSERT INTO nf_projects VALUES ('project-1', 'owner', 'org-1');
    INSERT INTO nf_project_members VALUES ('project-1', 'editor', 'editor', 1), ('project-1', 'viewer', 'viewer', 1);
    INSERT INTO nf_cad_workspace_heads VALUES ('project-1', 4, '${revisionHash}', 1);
  `);
  tokens = {
    editor: await signJWT({ sub: 'editor', email: 'editor@test.invalid', plan: 'pro' }),
    viewer: await signJWT({ sub: 'viewer', email: 'viewer@test.invalid', plan: 'pro' }),
    outsider: await signJWT({ sub: 'outsider', email: 'outsider@test.invalid', plan: 'pro' }),
  };
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (database.open) await db.close();
});

describe('drawing handoff route -> auth/access -> SQLite store integration', () => {
  it('persists once, returns an idempotent receipt, and lets an authorized viewer read', async () => {
    const payload = { expectedRevision: 4, expectedContentSha256: revisionHash, handoff: await handoff() };
    const first = await POST(post(tokens.editor, 'org-1', payload), context);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as {
      handoffId: string;
      idempotent: boolean;
      payloadSha256: string;
      exactSinglePartStatus: string;
    };
    expect(firstBody).toMatchObject({ idempotent: false, exactSinglePartStatus: 'PASS' });
    const retry = await POST(post(tokens.editor, 'org-1', payload), context);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      handoffId: firstBody.handoffId,
      payloadSha256: firstBody.payloadSha256,
      exactSinglePartStatus: 'PASS',
      idempotent: true,
    });
    const read = await GET(get(tokens.viewer, 'org-1', firstBody.handoffId), {
      params: Promise.resolve({ id: projectId, handoffId: firstBody.handoffId }),
    });
    expect(read.status).toBe(200);
    const readBody = await read.json() as {
      payloadSha256: string;
      byteLength: number;
      persistence: string;
      handoff: AssemblyDrawingHandoff;
    };
    expect(readBody).toMatchObject({
      persistence: 'SERVER_OWNED_IMMUTABLE',
      payloadSha256: firstBody.payloadSha256,
      handoff: {
        source: { workspaceRevision: 4 },
        exactSinglePart: {
          step: { units: 'mm' },
          drawing: { method: 'OCCT_HLR', views: [{ name: 'front' }, { name: 'top' }, { name: 'right' }] },
          dimensions: { scope: 'OVERALL_BBOX_ONLY', units: 'mm' },
          bom: { itemCount: 1, totalQuantity: 1 },
          claimBoundary: { gdt: 'NOT_RUN', pmi: 'NOT_RUN', humanApproval: 'NOT_RUN', manufacturingRelease: 'BLOCKED' },
        },
        artifacts: {
          exactBrepStep: { status: 'PASS' }, drawing: { status: 'PASS' }, bom: { status: 'PASS' },
          gdtPmi: { status: 'NOT_RUN' }, manufacturingPackage: { status: 'BLOCKED' },
        },
      },
    });
    const storedBytes = serializeAssemblyDrawingHandoff(readBody.handoff);
    expect(readBody.byteLength).toBe(Buffer.byteLength(storedBytes, 'utf8'));
    expect(readBody.payloadSha256).toBe(createHash('sha256').update(storedBytes, 'utf8').digest('hex'));
    expect((database.prepare('SELECT COUNT(*) AS count FROM nf_assembly_drawing_handoffs').get() as { count: number }).count).toBe(1);
  });

  it('rejects tampered authentication, tenant context, and viewer mutation before writes', async () => {
    const payload = { expectedRevision: 4, expectedContentSha256: revisionHash, handoff: await handoff() };
    expect((await POST(post(`${tokens.editor}tampered`, 'org-1', payload), context)).status).toBe(401);
    expect((await POST(post(tokens.outsider, 'org-2', payload), context)).status).toBe(404);
    expect((await POST(post(tokens.viewer, 'org-1', payload), context)).status).toBe(403);
    expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='nf_assembly_drawing_handoffs'").get())
      .toEqual({ count: 0 });
  });

  it('rejects stale revision/hash and mutated payload bytes without persisting', async () => {
    const staleRevision = { expectedRevision: 3, expectedContentSha256: revisionHash, handoff: await handoff(3) };
    expect((await POST(post(tokens.editor, 'org-1', staleRevision), context)).status).toBe(409);
    const staleHash = { expectedRevision: 4, expectedContentSha256: 'b'.repeat(64), handoff: await handoff(4, 'b'.repeat(64)) };
    expect((await POST(post(tokens.editor, 'org-1', staleHash), context)).status).toBe(409);
    const forged = await handoff();
    forged.assembly.state.parts[0]!.name = 'Payload changed after hashing';
    expect((await POST(post(tokens.editor, 'org-1', { expectedRevision: 4, expectedContentSha256: revisionHash, handoff: forged }), context)).status).toBe(422);
    expect((database.prepare('SELECT COUNT(*) AS count FROM nf_assembly_drawing_handoffs').get() as { count: number }).count).toBe(0);
  });

  it('fails closed when immutable stored bytes are altered or expired', async () => {
    const response = await POST(post(tokens.editor, 'org-1', {
      expectedRevision: 4, expectedContentSha256: revisionHash, handoff: await handoff(),
    }), context);
    const body = await response.json() as { handoffId: string };
    database.prepare('UPDATE nf_assembly_drawing_handoffs SET payload_json = payload_json || ? WHERE id = ?').run(' ', body.handoffId);
    expect((await GET(get(tokens.viewer, 'org-1', body.handoffId), {
      params: Promise.resolve({ id: projectId, handoffId: body.handoffId }),
    })).status).toBe(500);
    database.prepare('UPDATE nf_assembly_drawing_handoffs SET expires_at = ? WHERE id = ?').run(0, body.handoffId);
    expect((await GET(get(tokens.viewer, 'org-1', body.handoffId), {
      params: Promise.resolve({ id: projectId, handoffId: body.handoffId }),
    })).status).toBe(410);
  });
});
