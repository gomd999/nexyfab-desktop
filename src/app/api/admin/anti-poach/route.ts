/**
 * Admin endpoints for the anti-poach signal queue (created by
 * /api/cron/anti-poach-signals).
 *
 * GET  /api/admin/anti-poach
 *   query: ?status=open|reviewed|all  ?kind=orphan_order|repeat_pair|quick_cancel
 *   → { signals: [...], counts: { open, reviewed } }
 *
 * POST /api/admin/anti-poach
 *   body: { signalId, verdict, notes? }
 *   verdict ∈ { false_positive, warning_sent, enforcement_initiated }
 *   → 200 ok
 *
 * Admin only — these signals are about partner agreement enforcement
 * and contain buyer/partner correlations that ops alone should see.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SignalRow {
  id: string;
  kind: string;
  buyer_id: string | null;
  partner_email: string | null;
  ref_id: string | null;
  severity: string;
  details: string | null;
  detected_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  verdict: string | null;
}

const VALID_VERDICTS = new Set(['false_positive', 'warning_sent', 'enforcement_initiated']);
const VALID_KINDS = new Set(['orphan_order', 'repeat_pair', 'quick_cancel']);

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'open';
  const kind = url.searchParams.get('kind');

  const db = getDbAdapter();

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (status === 'open') {
    where.push('reviewed_at IS NULL');
  } else if (status === 'reviewed') {
    where.push('reviewed_at IS NOT NULL');
  }
  if (kind && VALID_KINDS.has(kind)) {
    where.push('kind = ?');
    params.push(kind);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const signals = await db.queryAll<SignalRow>(
    `SELECT * FROM nf_anti_poach_signals ${whereSql} ORDER BY detected_at DESC LIMIT 200`,
    ...params,
  ).catch((): SignalRow[] => []);

  const [openRow, reviewedRow] = await Promise.all([
    db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM nf_anti_poach_signals WHERE reviewed_at IS NULL`).catch(() => null),
    db.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM nf_anti_poach_signals WHERE reviewed_at IS NOT NULL`).catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    signals: signals.map(s => ({
      id: s.id,
      kind: s.kind,
      buyerId: s.buyer_id,
      partnerEmail: s.partner_email,
      refId: s.ref_id,
      severity: s.severity,
      details: s.details ? JSON.parse(s.details) : null,
      detectedAt: s.detected_at,
      reviewedAt: s.reviewed_at,
      reviewedBy: s.reviewed_by,
      verdict: s.verdict,
    })),
    counts: {
      open: Number(openRow?.c ?? 0),
      reviewed: Number(reviewedRow?.c ?? 0),
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { signalId?: unknown; verdict?: unknown; notes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const signalId = typeof body.signalId === 'string' ? body.signalId : '';
  const verdict = typeof body.verdict === 'string' ? body.verdict : '';
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  if (!signalId || !VALID_VERDICTS.has(verdict)) {
    return NextResponse.json({
      error: `signalId required and verdict must be one of: ${Array.from(VALID_VERDICTS).join(', ')}`,
    }, { status: 400 });
  }

  const db = getDbAdapter();
  const existing = await db.queryOne<{ id: string; details: string | null }>(
    `SELECT id, details FROM nf_anti_poach_signals WHERE id = ?`,
    signalId,
  ).catch(() => null);
  if (!existing) return NextResponse.json({ error: 'signal not found' }, { status: 404 });

  // Merge notes into details JSON so we keep a single audit blob.
  let detailsObj: Record<string, unknown> = {};
  try { detailsObj = existing.details ? JSON.parse(existing.details) : {}; } catch { /* keep empty */ }
  if (notes) detailsObj.reviewNotes = notes;

  await db.execute(
    `UPDATE nf_anti_poach_signals
        SET verdict = ?, reviewed_at = ?, reviewed_by = ?, details = ?
      WHERE id = ?`,
    verdict, Date.now(), auth.userId, JSON.stringify(detailsObj), signalId,
  );

  return NextResponse.json({ ok: true, signalId, verdict });
}
