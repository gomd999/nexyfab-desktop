/**
 * B2 — Bridge from SCAD agent B-rep handles to the quick-quote flow.
 *
 * The agent's `brep_export_step` produces STEP text but it stays in the
 * OCCT registry server-side. To get the user from "I'm done designing"
 * to "give me a manufacturing quote" with one click, this endpoint
 * stashes the STEP under a short-lived token; the agent panel opens
 * /quick-quote?stepToken=<token>, and quick-quote pulls the bytes via
 * GET on the same endpoint.
 *
 * In-memory stash with a 10-minute TTL — a real shared deployment
 * would want Redis here, but for the single-process Railway target
 * this is enough and keeps the flow zero-cost.
 */

import { NextRequest, NextResponse } from 'next/server';
import { exportOcctStep } from '../../../../[lang]/shape-generator/features/occtEngine';
import { getAuthUser } from '@/lib/auth-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StashEntry {
  step: string;
  bytes: number;
  handle: string;
  expiresAtMs: number;
}

const STASH = new Map<string, StashEntry>();
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

function gc(): void {
  const now = Date.now();
  for (const [k, v] of STASH) if (v.expiresAtMs < now) STASH.delete(k);
  // Hard cap to bound memory in case of attack/abuse.
  while (STASH.size > MAX_ENTRIES) {
    const oldestKey = STASH.keys().next().value;
    if (oldestKey === undefined) break;
    STASH.delete(oldestKey);
  }
}

function newToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  // P2 — auth required: STEP exports may carry IP-sensitive geometry.
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { handle?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const handle = typeof body.handle === 'string' ? body.handle : '';
  if (!handle) {
    return NextResponse.json({ ok: false, error: 'handle is required' }, { status: 400 });
  }

  const step = await exportOcctStep(handle);
  if (!step) {
    return NextResponse.json({ ok: false, error: `handle ${handle} did not produce STEP` }, { status: 404 });
  }

  gc();
  const token = newToken();
  STASH.set(token, {
    step,
    bytes: Buffer.byteLength(step, 'utf8'),
    handle,
    expiresAtMs: Date.now() + TTL_MS,
  });

  return NextResponse.json({
    ok: true,
    token,
    bytes: Buffer.byteLength(step, 'utf8'),
    filename: `${handle.replace(/[^a-z0-9_-]/gi, '_')}.step`,
    expiresInMs: TTL_MS,
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ ok: false, error: 'token is required' }, { status: 400 });
  }
  gc();
  const entry = STASH.get(token);
  if (!entry) {
    return NextResponse.json({ ok: false, error: 'token expired or unknown' }, { status: 404 });
  }
  // One-shot: consume on read so a stash entry can't be replayed.
  STASH.delete(token);

  return new NextResponse(entry.step, {
    status: 200,
    headers: {
      'Content-Type': 'application/step',
      'Content-Disposition': `attachment; filename="${entry.handle.replace(/[^a-z0-9_-]/gi, '_')}.step"`,
      'Cache-Control': 'no-store',
    },
  });
}
