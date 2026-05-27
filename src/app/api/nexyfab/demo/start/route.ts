// Guest demo-session bootstrap. Called by Hub before routing to the
// modeler with ?guest=1 so the server has a real `nf_sessions` row
// (httpOnly cookie) that can be claimed at signup time. Without this,
// projects created during guest mode would lack a `session_id` and the
// post-signup `tryClaimDemoOnAuth` would have nothing to migrate.

import { NextRequest, NextResponse } from 'next/server';
import { ensureDemoSession } from '@/lib/demo-session';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  try {
    const session = await ensureDemoSession(req, res);
    return NextResponse.json(
      {
        ok: true,
        sessionId: session.id,
        createdAt: session.createdAt,
        // Hub uses this to show the countdown banner.
        ttlMs: 24 * 60 * 60 * 1000,
      },
      {
        // Carry through the Set-Cookie that ensureDemoSession set on `res`.
        headers: res.headers,
      },
    );
  } catch (err) {
    console.error('[demo/start] failed:', err);
    return NextResponse.json({ ok: false, error: 'demo-session-failed' }, { status: 500 });
  }
}
