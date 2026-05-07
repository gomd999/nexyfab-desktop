/**
 * order-events.ts — Append-only timeline for order updates.
 *
 * Used by the partner workflow (photos, notes posted at each production step)
 * and rendered on the customer's order tracking page so they see real progress
 * rather than just a status label.
 *
 * Event kinds:
 *  - status_change      자동 — status 컬럼 전환 시
 *  - note               파트너가 텍스트 메모 추가
 *  - photo              파트너가 사진 첨부 (R2 URL)
 *  - shipment           운송장 번호 등록
 *  - delay              납기 지연 사유 보고
 */
import { getDbAdapter } from './db-adapter';

export type OrderEventKind = 'status_change' | 'note' | 'photo' | 'shipment' | 'delay';

export interface OrderEventInput {
  orderId: string;
  kind: OrderEventKind;
  authorEmail: string;
  authorRole: 'partner' | 'customer' | 'system';
  body?: string;
  photoUrl?: string;
  fromStatus?: string;
  toStatus?: string;
  metadata?: Record<string, unknown>;
}

export interface OrderEventRow {
  id: string;
  orderId: string;
  kind: OrderEventKind;
  authorEmail: string;
  authorRole: string;
  body: string | null;
  photoUrl: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

let ensured = false;

async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      author_email TEXT NOT NULL,
      author_role TEXT NOT NULL,
      body TEXT,
      photo_url TEXT,
      from_status TEXT,
      to_status TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_oev_order ON nf_order_events(order_id, created_at DESC)').catch(() => {});
  ensured = true;
}

export async function recordOrderEvent(ev: OrderEventInput): Promise<string | null> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const id = `oev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(
      `INSERT INTO nf_order_events
        (id, order_id, kind, author_email, author_role,
         body, photo_url, from_status, to_status, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ev.orderId, ev.kind, ev.authorEmail, ev.authorRole,
      ev.body ?? null, ev.photoUrl ?? null,
      ev.fromStatus ?? null, ev.toStatus ?? null,
      ev.metadata ? JSON.stringify(ev.metadata) : null,
      Date.now(),
    );
    return id;
  } catch (err) {
    console.error('[recordOrderEvent] failed:', err);
    return null;
  }
}

export async function listOrderEvents(orderId: string, limit = 50): Promise<OrderEventRow[]> {
  const db = getDbAdapter();
  await ensureTable(db);
  const rows = await db.queryAll<{
    id: string; order_id: string; kind: string;
    author_email: string; author_role: string;
    body: string | null; photo_url: string | null;
    from_status: string | null; to_status: string | null;
    metadata: string | null; created_at: number;
  }>(
    `SELECT id, order_id, kind, author_email, author_role,
            body, photo_url, from_status, to_status, metadata, created_at
       FROM nf_order_events WHERE order_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    orderId, Math.max(1, Math.min(200, limit)),
  );
  return rows.map(r => {
    let metadata: Record<string, unknown> | null = null;
    try { metadata = r.metadata ? JSON.parse(r.metadata) : null; } catch { /* ignore */ }
    return {
      id: r.id,
      orderId: r.order_id,
      kind: r.kind as OrderEventKind,
      authorEmail: r.author_email,
      authorRole: r.author_role,
      body: r.body,
      photoUrl: r.photo_url,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      metadata,
      createdAt: r.created_at,
    };
  });
}
