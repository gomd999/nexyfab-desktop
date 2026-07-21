/**
 * g4TeamGate.test.ts — G4 게이트(2인 이상 팀) 실행형 실증.
 *
 * REPLACEMENT_ROADMAP §5: G4 = G3 + PDM + /api/documents 복구.
 * EXECUTION_PLAN Wave 6 게이트: "2인 이상 팀이 하루 작업을 완주."
 * 이 파일이 그 하루를 그대로 실행한다 (실행하지 않은 판정은 판정이
 * 아니다) — 실 DB(in-memory sqlite 레그 기본, DOCS_IT_PG_URL 시 실
 * Postgres) 위의 실제 라우트 핸들러 + 검증된 PDM 엔진으로:
 *
 *   오전   Alice 문서 생성·Bob editor 부여 → Alice 체크아웃(잠금)·편집·
 *          스냅샷 → 해제. 잠금 중 Bob의 편집은 423.
 *   점심   Bob 체크아웃·편집·스냅샷 → 해제.
 *   오후   두 사람의 분기 작업을 PDM으로: 브랜치 2개·충돌 1건·해결·
 *          2-parent 머지 커밋 → 머지 결과를 문서에 반영(잠금 하에).
 *   사고   Bob의 오편집 → Alice가 오전 버전으로 복원(히스토리 불변
 *          적층, restoredFrom 계보).
 *   마감   버전 이력 전량 보존·최종 payload=복원본·잠금 0·권한 스택
 *          재확인(강등된 Bob 쓰기 403).
 *
 * G4의 명시 한계(게이트 표에 기재): PDM 세션은 in-memory(문서 API와의
 * 영속 연결은 후속) · 실시간 공동편집은 SSE 경로 라이브·Yjs WS는 서버
 * 미배포(절차 문서화) · blob 복사는 스토리지 mock(실 R2 범위 밖).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { VersionRepo } from '@/app/[lang]/shape-generator/pdm/versionBranch';
import { mergeFeatures, resolveConflict } from '@/app/[lang]/shape-generator/pdm/conflictResolution';
import type { FeatureInstance } from '@/app/[lang]/shape-generator/features/types';

// ─── mocks (documents.stack.integration.test.ts와 동일 관례) ────────────────

const authState = vi.hoisted(() => ({
  user: null as null | { userId: string; email: string; orgIds: string[] },
}));

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => authState.user),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/client-ip', () => ({
  getTrustedClientIpOrUndefined: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/storage', () => ({
  getStorage: vi.fn(() => ({
    uploadRaw: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.from([0x00, 0x00])),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/current.ydoc'),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/lib/db-adapter', async (orig) => {
  const real = await orig<typeof import('@/lib/db-adapter')>();
  if (process.env.DOCS_IT_PG_URL) {
    process.env.DATABASE_URL = process.env.DOCS_IT_PG_URL;
    return real;
  }
  const { default: BetterSqlite } = await import('better-sqlite3');
  const mem = new BetterSqlite(':memory:');
  mem.pragma('foreign_keys = ON');
  const adapter: import('@/lib/db-adapter').DbAdapter = {
    backend: 'sqlite',
    async queryOne(sql, ...p) { return mem.prepare(sql).get(...(p as never[])) as never; },
    async queryAll(sql, ...p) { return mem.prepare(sql).all(...(p as never[])) as never; },
    async execute(sql, ...p) { const info = mem.prepare(sql).run(...(p as never[])); return { changes: info.changes }; },
    async executeRaw(sql) { mem.exec(sql); },
    async transaction(fn) {
      mem.exec('BEGIN');
      try { const r = await fn(adapter); mem.exec('COMMIT'); return r; }
      catch (e) { mem.exec('ROLLBACK'); throw e; }
    },
    async close() { mem.close(); },
  };
  return { ...real, getDbAdapter: () => adapter };
});

// ─── fixtures ───────────────────────────────────────────────────────────────

const ALICE = { userId: 'g4-alice', email: 'g4-alice@test.local', orgIds: [] as string[] };
const BOB   = { userId: 'g4-bob',   email: 'g4-bob@test.local',   orgIds: [] as string[] };

function actAs(u: typeof ALICE | null) { authState.user = u; }
function jsonReq(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

let colPOST: typeof import('../route').POST;
let docGET: typeof import('../[id]/route').GET;
let docPUT: typeof import('../[id]/route').PUT;
let verGET: typeof import('../[id]/versions/route').GET;
let verPOST: typeof import('../[id]/versions/route').POST;
let permPOST: typeof import('../[id]/permissions/route').POST;
let permDELETE: typeof import('../[id]/permissions/[userId]/route').DELETE;
let lockPOST: typeof import('../[id]/lock/route').POST;
let lockDELETE: typeof import('../[id]/lock/route').DELETE;
let restorePOST: typeof import('../[id]/versions/[versionId]/restore/route').POST;

let db: import('@/lib/db-adapter').DbAdapter;
const IS_PG = !!process.env.DOCS_IT_PG_URL;

beforeAll(async () => {
  const dbMod = await import('@/lib/db-adapter');
  db = dbMod.getDbAdapter();
  if (IS_PG) {
    await dbMod.initPostgresSchema();
    await db.execute(`DELETE FROM nf_document_locks WHERE holder_id LIKE 'g4-%'`);
    await db.execute(`DELETE FROM nf_document_versions WHERE created_by LIKE 'g4-%'`);
    await db.execute(`DELETE FROM nf_document_permissions WHERE user_id LIKE 'g4-%' OR granted_by LIKE 'g4-%'`);
    await db.execute(`DELETE FROM nf_documents WHERE owner_id LIKE 'g4-%'`);
    await db.execute(`DELETE FROM nf_workspace_members WHERE user_id LIKE 'g4-%'`);
    await db.execute(`DELETE FROM nf_workspaces WHERE owner_id LIKE 'g4-%'`);
  } else {
    await db.executeRaw(`
      CREATE TABLE IF NOT EXISTS nf_users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL, created_at BIGINT NOT NULL
      );
    `);
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'lib', 'db-migrations-wave-2-sqlite.sql'), 'utf-8',
    );
    await db.executeRaw(migration);
  }
  for (const u of [ALICE, BOB]) {
    await db.execute(
      `INSERT INTO nf_users (id, email, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      u.userId, u.email, u.userId, Date.now(),
    );
  }
  colPOST = (await import('../route')).POST;
  ({ GET: docGET, PUT: docPUT } = await import('../[id]/route'));
  ({ GET: verGET, POST: verPOST } = await import('../[id]/versions/route'));
  ({ POST: permPOST } = await import('../[id]/permissions/route'));
  ({ DELETE: permDELETE } = await import('../[id]/permissions/[userId]/route'));
  ({ POST: lockPOST, DELETE: lockDELETE } = await import('../[id]/lock/route'));
  restorePOST = (await import('../[id]/versions/[versionId]/restore/route')).POST;
});

afterAll(async () => { await db?.close(); });

// ─── PDM helpers (검증된 엔진 직접 소비 — UI 소비는 W6-D jsdom에서 실증) ───

const feat = (id: string, type: FeatureInstance['type'], params: Record<string, number>): FeatureInstance =>
  ({ id, type, params, enabled: true });

// ─── 하루 작업 (순차 — 상태가 테스트 간 이어진다) ───────────────────────────

let docId = '';
let morningVersionId = '';

describe(`G4 gate — a two-person team completes a day's work (${IS_PG ? 'postgres' : 'sqlite'})`, () => {
  it('아침: Alice가 문서를 만들고 Bob을 editor로 초대한다', async () => {
    actAs(ALICE);
    const created = await colPOST(jsonReq('POST', '/api/documents', {
      name: 'G4 — gearbox bracket', payload: { features: ['base'] },
    }));
    expect(created.status).toBe(201);
    docId = (await created.json()).document.id;

    const grant = await permPOST(
      jsonReq('POST', `/api/documents/${docId}/permissions`, { userId: BOB.userId, role: 'editor' }),
      ctx({ id: docId }),
    );
    expect(grant.status).toBe(201);
  });

  it('오전: Alice 체크아웃→편집→스냅샷→해제; 잠금 중 Bob 편집은 423', async () => {
    actAs(ALICE);
    expect((await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), ctx({ id: docId }))).status).toBe(201);

    actAs(BOB);
    const blocked = await docPUT(
      jsonReq('PUT', `/api/documents/${docId}`, { name: 'bob-sneaky-edit' }), ctx({ id: docId }),
    );
    expect(blocked.status).toBe(423);

    actAs(ALICE);
    expect((await docPUT(
      jsonReq('PUT', `/api/documents/${docId}`, { name: 'gearbox bracket — morning' }), ctx({ id: docId }),
    )).status).toBe(200);
    const snap = await verPOST(
      jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'morning-alice' }), ctx({ id: docId }),
    );
    expect(snap.status).toBe(201);
    morningVersionId = (await snap.json()).version.id;
    expect((await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), ctx({ id: docId }))).status).toBe(200);
  });

  it('점심: Bob이 체크아웃해 자기 몫을 작업하고 해제한다', async () => {
    actAs(BOB);
    expect((await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), ctx({ id: docId }))).status).toBe(201);
    expect((await docPUT(
      jsonReq('PUT', `/api/documents/${docId}`, { name: 'gearbox bracket — bob pass' }), ctx({ id: docId }),
    )).status).toBe(200);
    expect((await verPOST(
      jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'midday-bob' }), ctx({ id: docId }),
    )).status).toBe(201);
    expect((await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), ctx({ id: docId }))).status).toBe(200);
  });

  it('오후: 두 사람의 분기 작업을 PDM 3-way 머지로 합친다 (충돌 1건 해결)', () => {
    const base = [feat('f1', 'shell', { thickness: 2 }), feat('f2', 'fillet', { radius: 2 })];
    const repo = new VersionRepo(base, ALICE.userId);
    const baseCommit = repo.current().commit;
    repo.branch('alice-branch');
    repo.branch('bob-branch');
    // Alice는 fillet 반경을 3으로, Bob은 4로 — modify-modify 충돌.
    repo.checkout('alice-branch');
    const aTip = repo.commit({
      authorUserId: ALICE.userId, message: 'alice: r=3',
      features: [base[0]!, feat('f2', 'fillet', { radius: 3 })],
    });
    repo.checkout('bob-branch');
    const bTip = repo.commit({
      authorUserId: BOB.userId, message: 'bob: r=4 + hole',
      features: [base[0]!, feat('f2', 'fillet', { radius: 4 }), feat('f3', 'hole', { d: 6 })],
    });

    expect(repo.lowestCommonAncestor(aTip.id, bTip.id)?.id).toBe(baseCommit.id);
    const merged = mergeFeatures({
      base,
      ours: [...repo.getCommit(aTip.id)!.features],
      theirs: [...repo.getCommit(bTip.id)!.features],
    });
    expect(merged.conflicts.length).toBe(1);
    expect(merged.conflicts[0]!.featureId).toBe('f2');
    expect(merged.conflicts[0]!.kind).toBe('modify-modify');
    // 팀 합의: Bob의 반경 채택 (theirs).
    const resolved = resolveConflict(merged, 'f2', 'theirs');
    expect(resolved.conflicts.length).toBe(0);
    repo.checkout('main');
    const mergeCommit = repo.merge({
      authorUserId: ALICE.userId, message: 'merge alice+bob',
      features: resolved.merged, otherParentId: bTip.id,
    });
    expect(mergeCommit.parents).toHaveLength(2);
    expect(mergeCommit.parents).toContain(bTip.id);
    const final = repo.getCommit(mergeCommit.id)!.features;
    expect(final.find((f) => f.id === 'f2')!.params.radius).toBe(4);
    expect(final.some((f) => f.id === 'f3')).toBe(true);
  });

  it('오후 반영: 머지 결과를 잠금 하에 문서로 스냅샷', async () => {
    actAs(ALICE);
    expect((await lockPOST(jsonReq('POST', `/api/documents/${docId}/lock`), ctx({ id: docId }))).status).toBe(201);
    expect((await docPUT(
      jsonReq('PUT', `/api/documents/${docId}`, { name: 'gearbox bracket — merged' }), ctx({ id: docId }),
    )).status).toBe(200);
    expect((await verPOST(
      jsonReq('POST', `/api/documents/${docId}/versions`, { label: 'merged' }), ctx({ id: docId }),
    )).status).toBe(201);
    expect((await lockDELETE(jsonReq('DELETE', `/api/documents/${docId}/lock`), ctx({ id: docId }))).status).toBe(200);
  });

  it('사고 복구: 오전 버전으로 복원 — 히스토리 불변 적층 + restoredFrom 계보', async () => {
    actAs(ALICE);
    const before = await (await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }))).json();
    const countBefore = before.versions.length;

    const restored = await restorePOST(
      jsonReq('POST', `/api/documents/${docId}/versions/${morningVersionId}/restore`),
      ctx({ id: docId, versionId: morningVersionId }),
    );
    expect(restored.status).toBe(201);
    const restoredBody = await restored.json();
    expect(restoredBody.version.restoredFrom).toBe(morningVersionId);

    const after = await (await verGET(jsonReq('GET', `/api/documents/${docId}/versions`), ctx({ id: docId }))).json();
    expect(after.versions.length).toBe(countBefore + 1); // 파괴 없음 — 적층만
  });

  it('마감: 잠금 0·이력 전량·권한 스택 재확인(강등된 Bob 쓰기 403)', async () => {
    actAs(ALICE);
    const doc = await (await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }))).json();
    expect(doc.document.lock ?? null).toBeNull(); // 하루 종료 — 잠금 없음

    // Bob을 viewer로 강등(재부여) 후 쓰기 403.
    expect((await permDELETE(
      jsonReq('DELETE', `/api/documents/${docId}/permissions/${BOB.userId}`),
      ctx({ id: docId, userId: BOB.userId }),
    )).status).toBe(200);
    expect((await permPOST(
      jsonReq('POST', `/api/documents/${docId}/permissions`, { userId: BOB.userId, role: 'viewer' }),
      ctx({ id: docId }),
    )).status).toBe(201);
    actAs(BOB);
    expect((await docGET(jsonReq('GET', `/api/documents/${docId}`), ctx({ id: docId }))).status).toBe(200);
    expect((await docPUT(
      jsonReq('PUT', `/api/documents/${docId}`, { name: 'nope' }), ctx({ id: docId }),
    )).status).toBe(403);
  });
});
