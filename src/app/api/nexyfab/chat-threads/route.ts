/**
 * /api/nexyfab/chat-threads — 챗 스레드 서버 저장 (계정 연동 — 사이드바 동기화).
 * GET: 내 스레드 목록(msgs 포함, 최근 50) · POST { thread } 업서트 | { migrate: Thread[] }
 * 게스트 이관(1회 — 클라이언트가 nf_chat_migrated_v1 플래그로 재이관 방지)
 * · DELETE ?id=. 비로그인 401(게스트=localStorage 그대로 — 정직 이원화).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_MSGS_BYTES = 96 * 1024; // 스레드당 96KB(카드 JSON 포함 — 이미지 제외 전제)
const MAX_THREADS = 50;

interface ThreadIn {
  id?: string; title?: string; domain?: string; at?: number; updated?: number;
  pinned?: boolean; badge?: string | null; msgs?: unknown[];
}

let schemaReady = false;
async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const db = getDbAdapter();
  await db.executeRaw(`CREATE TABLE IF NOT EXISTS nf_chat_threads (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    domain TEXT NOT NULL,
    badge TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    msgs TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.executeRaw(`CREATE INDEX IF NOT EXISTS idx_nf_chat_threads_owner ON nf_chat_threads (owner_id, updated_at DESC)`);
  schemaReady = true;
}

function sanitize(t: ThreadIn): { ok: true; row: Required<Pick<ThreadIn, 'id' | 'title' | 'domain'>> & { badge: string | null; pinned: number; msgs: string; at: number; updated: number } } | { ok: false; error: string } {
  const id = String(t.id ?? '').slice(0, 40);
  if (!/^t[a-z0-9]+$/.test(id)) return { ok: false, error: 'invalid id' };
  const msgs = JSON.stringify(Array.isArray(t.msgs) ? t.msgs : []);
  if (msgs.length > MAX_MSGS_BYTES) return { ok: false, error: 'thread too large' };
  return {
    ok: true,
    row: {
      id,
      title: String(t.title ?? 'Chat').slice(0, 80),
      domain: String(t.domain ?? 'mechanical').slice(0, 20),
      badge: t.badge ? String(t.badge).slice(0, 10) : null,
      pinned: t.pinned ? 1 : 0,
      msgs,
      at: Number(t.at) || Date.now(),
      updated: Number(t.updated) || Date.now(),
    },
  };
}

async function upsert(ownerId: string, t: ThreadIn): Promise<boolean> {
  const v = sanitize(t);
  if (!v.ok) return false;
  const db = getDbAdapter();
  const r = v.row;
  const existing = await db.queryOne('SELECT id FROM nf_chat_threads WHERE id = ? AND owner_id = ?', r.id, ownerId);
  if (existing) {
    await db.execute('UPDATE nf_chat_threads SET title = ?, domain = ?, badge = ?, pinned = ?, msgs = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
      r.title, r.domain, r.badge, r.pinned, r.msgs, new Date(r.updated).toISOString(), r.id, ownerId);
  } else {
    const cnt = await db.queryOne('SELECT COUNT(*) as c FROM nf_chat_threads WHERE owner_id = ?', ownerId) as { c?: number } | null;
    if ((cnt?.c ?? 0) >= MAX_THREADS) return false; // 한도 — 오래된 것 정리는 후속(정직 거부)
    await db.execute('INSERT INTO nf_chat_threads (id, owner_id, title, domain, badge, pinned, msgs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      r.id, ownerId, r.title, r.domain, r.badge, r.pinned, r.msgs, new Date(r.at).toISOString(), new Date(r.updated).toISOString());
  }
  return true;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: 401 });
  await ensureSchema();
  const db = getDbAdapter();
  const rows = await db.queryAll('SELECT id, title, domain, badge, pinned, msgs, created_at, updated_at FROM nf_chat_threads WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 50', user.userId) as Array<Record<string, unknown>>;
  const threads = rows.map((r) => ({
    id: r.id, title: r.title, domain: r.domain, badge: r.badge ?? null, pinned: !!r.pinned,
    at: Date.parse(String(r.created_at)) || Date.now(), updated: Date.parse(String(r.updated_at)) || Date.now(),
    msgs: (() => { try { return JSON.parse(String(r.msgs)); } catch { return []; } })(),
  }));
  return NextResponse.json({ ok: true, threads });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getTrustedClientIp(req.headers);
  const rl = rateLimit(`chat-threads:${ip}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ ok: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: 401 });
  await ensureSchema();
  const body = (await req.json().catch(() => ({}))) as { thread?: ThreadIn; migrate?: ThreadIn[] };
  if (Array.isArray(body.migrate)) {
    let okCount = 0;
    for (const t of body.migrate.slice(0, MAX_THREADS)) if (await upsert(user.userId, t)) okCount++;
    return NextResponse.json({ ok: true, migrated: okCount });
  }
  if (body.thread) {
    const done = await upsert(user.userId, body.thread);
    return NextResponse.json(done ? { ok: true } : { ok: false, error: 'invalid or limit' }, { status: done ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: 'thread 또는 migrate 필요' }, { status: 400 });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ ok: false, error: '로그인 필요' }, { status: 401 });
  await ensureSchema();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^t[a-z0-9]+$/.test(id)) return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  const db = getDbAdapter();
  await db.execute('DELETE FROM nf_chat_threads WHERE id = ? AND owner_id = ?', id, user.userId);
  return NextResponse.json({ ok: true });
}
