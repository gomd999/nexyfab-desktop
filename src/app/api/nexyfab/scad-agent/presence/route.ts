/**
 * W8 — Lightweight presence ping for the SCAD agent panel.
 *
 * The panel calls this every ~20s while open so the server knows the
 * user is still viewing the session. Returns the current participant
 * list. POST is the registration heartbeat; GET is a read-only peek.
 *
 * Design: this endpoint is intentionally cheap — no plan gate, no AI
 * spend, just a memory map read/write. Same Node process as the agent
 * (PARTICIPANTS map is module-scoped in serverCollab.ts).
 */
import { NextRequest } from 'next/server';
import { setSessionParticipants } from '@/lib/ai/scad-agent/serverCollab';
import { checkPlan } from '@/lib/plan-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ParticipantRow {
  id: string;
  label: string;
  self: boolean;
  ts: number;
}

const ROOMS = new Map<string, Map<string, ParticipantRow>>();
const TTL_MS = 60_000;

function gcRoom(sessionId: string): Map<string, ParticipantRow> {
  const room = ROOMS.get(sessionId) ?? new Map();
  const now = Date.now();
  for (const [id, row] of room) {
    if (now - row.ts > TTL_MS) room.delete(id);
  }
  ROOMS.set(sessionId, room);
  return room;
}

export async function POST(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;
  let body: { sessionId?: string; userId?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const label = typeof body.label === 'string' ? body.label.slice(0, 40) : 'Anonymous';
  if (!sessionId || !userId) {
    return Response.json({ ok: false, error: 'sessionId and userId required' }, { status: 400 });
  }

  const room = gcRoom(sessionId);
  room.set(userId, { id: userId, label, self: false, ts: Date.now() });

  // Mirror to the agent's collab adapter so the agent's collab_presence
  // tool reflects the live roster.
  const peers = Array.from(room.values()).map(p => ({ id: p.id, label: p.label, self: false }));
  setSessionParticipants(sessionId, peers);

  return Response.json({
    ok: true,
    peers: peers.map(p => ({ id: p.id, label: p.label })),
    count: peers.length,
  });
}

export async function GET(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return plan.response;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ ok: false, error: 'sessionId required' }, { status: 400 });
  }
  const room = gcRoom(sessionId);
  const peers = Array.from(room.values()).map(p => ({ id: p.id, label: p.label }));
  return Response.json({ ok: true, peers, count: peers.length });
}
