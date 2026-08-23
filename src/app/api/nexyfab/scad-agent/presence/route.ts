/**
 * W8 — Lightweight presence ping for the SCAD agent panel.
 *
 * The panel calls this every ~20s while open so the server knows the
 * user is still viewing the session. Returns the current participant
 * list. POST is the registration heartbeat; GET is a read-only peek.
 *
 * Design: this endpoint is intentionally cheap — it has a plan/auth gate but no AI
 * spend after authenticated admission, just a bounded memory map read/write.
 * Participant IDs are untrusted display pseudonyms, never account or CAD
 * ownership identity. Same Node process as the agent
 * (PARTICIPANTS map is module-scoped in serverCollab.ts).
 */
import { NextRequest } from 'next/server';
import { setSessionParticipants } from '@/lib/ai/scad-agent/serverCollab';
import { checkPlan } from '@/lib/plan-guard';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
const MAX_PRESENCE_BODY_BYTES = 64 * 1024;
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_PARTICIPANT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ROOMS = 10_000;
export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}
function noStoreResponse(response: Response): Response {
  response.headers.set('Cache-Control', NO_STORE_HEADERS['Cache-Control']);
  return response;
}

interface ParticipantRow {
  id: string;
  label: string;
  self: boolean;
  ts: number;
}

const ROOMS = new Map<string, Map<string, ParticipantRow>>();
const TTL_MS = 60_000;

function pruneExpiredRooms(): void {
  const now = Date.now();
  for (const [sessionId, room] of ROOMS) {
    for (const [id, row] of room) if (now - row.ts > TTL_MS) room.delete(id);
    if (room.size === 0) ROOMS.delete(sessionId);
  }
}

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
  if (!checkOrigin(req)) return jsonNoStore({ ok: false, error: 'Forbidden', code: 'INVALID_ORIGIN' }, 403);
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return noStoreResponse(plan.response);
  let body: { sessionId?: string; userId?: string; label?: string };
  try {
    body = await readBoundedJson<{ sessionId?: string; userId?: string; label?: string }>(req, MAX_PRESENCE_BODY_BYTES);
  } catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return jsonNoStore({ ok: false, error: 'request too large', code: 'PAYLOAD_TOO_LARGE' }, 413);
    return jsonNoStore({ ok: false, error: 'invalid JSON' }, 400);
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const requestedUserId = typeof body.userId === 'string' ? body.userId : '';
  // This is a tab-scoped participant id, not an account identity. Authentication
  // is owned by checkPlan above; keep the client id bounded and never use it for
  // project authorization, audit attribution, or persistence ownership.
  const userId = requestedUserId;
  const label = typeof body.label === 'string' ? body.label.slice(0, 40) : 'Anonymous';
  if (!sessionId || !requestedUserId) {
    return jsonNoStore({ ok: false, error: 'sessionId and userId required' }, 400);
  }
  if (!SAFE_SESSION_ID.test(sessionId)) {
    return jsonNoStore({ ok: false, error: 'invalid sessionId', code: 'INVALID_SESSION_ID' }, 400);
  }
  if (!SAFE_PARTICIPANT_ID.test(userId)) {
    return jsonNoStore({ ok: false, error: 'invalid participant userId', code: 'INVALID_PARTICIPANT_ID' }, 400);
  }

  if (!ROOMS.has(sessionId) && ROOMS.size >= MAX_ROOMS) {
    pruneExpiredRooms();
    if (ROOMS.size >= MAX_ROOMS) {
      return jsonNoStore({ ok: false, error: 'presence capacity reached', code: 'PRESENCE_CAPACITY' }, 503);
    }
  }

  const room = gcRoom(sessionId);
  room.set(userId, { id: userId, label, self: false, ts: Date.now() });

  // Mirror to the agent's collab adapter so the agent's collab_presence
  // tool reflects the live roster.
  const peers = Array.from(room.values()).map(p => ({ id: p.id, label: p.label, self: false }));
  setSessionParticipants(sessionId, peers);

  return jsonNoStore({
    ok: true,
    peers: peers.map(p => ({ id: p.id, label: p.label })),
    count: peers.length,
  });
}

export async function GET(req: NextRequest) {
  const plan = await checkPlan(req, 'free');
  if (!plan.ok) return noStoreResponse(plan.response);
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return jsonNoStore({ ok: false, error: 'sessionId required' }, 400);
  }
  if (!SAFE_SESSION_ID.test(sessionId)) {
    return jsonNoStore({ ok: false, error: 'invalid sessionId', code: 'INVALID_SESSION_ID' }, 400);
  }
  const room = gcRoom(sessionId);
  const peers = Array.from(room.values()).map(p => ({ id: p.id, label: p.label }));
  return jsonNoStore({ ok: true, peers, count: peers.length });
}
