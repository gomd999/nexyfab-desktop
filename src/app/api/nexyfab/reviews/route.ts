// Save / list 완제품 평가 (Design Review) reports for the signed-in user.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { deleteReview, saveReview, listReviews } from '@/lib/design-reviews';
import { checkOrigin } from '@/lib/csrf';

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
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id || id.length > 128) return NextResponse.json({ error: 'valid id required' }, { status: 400 });
  const deleted = await deleteReview(user.userId, id);
  return deleted > 0
    ? NextResponse.json({ ok: true, deleted })
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
