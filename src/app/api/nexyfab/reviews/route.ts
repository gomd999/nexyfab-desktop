// Save / list 완제품 평가 (Design Review) reports for the signed-in user.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { saveReview, listReviews } from '@/lib/design-reviews';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const rows = await listReviews(user.userId, 20);
    const reviews = rows.map(r => ({
      id: r.id, filename: r.filename, material: r.material, process: r.process,
      created_at: Number(r.created_at),
      report: (() => { try { return JSON.parse(r.report); } catch { return null; } })(),
    }));
    return NextResponse.json({ reviews });
  } catch {
    return NextResponse.json({ reviews: [] });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    filename?: string; material?: string; process?: string; metrics?: unknown; report?: unknown;
  } | null;
  if (!body?.report) return NextResponse.json({ error: 'report required' }, { status: 400 });
  try {
    const id = crypto.randomUUID();
    await saveReview({
      id, userId: user.userId,
      filename: body.filename ?? 'part',
      material: body.material ?? '',
      process: body.process ?? '',
      metrics: body.metrics ?? null,
      report: body.report,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message ?? 'save failed' }, { status: 500 });
  }
}
