// ─── Collab API: SSE (server→client) + POST (client→server) ─────────────────
//
//   GET  /api/collab?roomId=xxx&userId=yyy  — open SSE stream
//   POST /api/collab                        — broadcast event to a room
//
// Uses an in-memory room registry. In production, replace with Redis pub/sub.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { rateLimit } from '@/lib/rate-limit';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import type { CollabEventType, CollabEvent } from './types';

// ─── Room ID validation ───────────────────────────────────────────────────────
// Two formats are accepted:
//   1. `project:<projectId>` — server enforces project membership.
//   2. Ad-hoc rooms — alphanumeric + dashes/underscores, 8–128 chars.
// Anything outside these two shapes is rejected outright so a malicious client
// cannot inject log lines, path traversal, or exhaust memory with huge keys.
const PROJECT_PREFIX = 'project:';
const ADHOC_ROOM_RE = /^[A-Za-z0-9_-]{8,128}$/;
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

async function authorizeRoom(roomId: string, userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (typeof roomId !== 'string' || roomId.length === 0) {
    return { ok: false, status: 400, error: 'roomId is required' };
  }
  if (roomId.startsWith(PROJECT_PREFIX)) {
    const projectId = roomId.slice(PROJECT_PREFIX.length);
    if (!PROJECT_ID_RE.test(projectId)) {
      return { ok: false, status: 400, error: 'Invalid project room id' };
    }
    const access = await resolveProjectAccess(getDbAdapter(), projectId, userId);
    if (!access) return { ok: false, status: 403, error: 'Not a member of this project' };
    return { ok: true };
  }
  if (!ADHOC_ROOM_RE.test(roomId)) {
    return { ok: false, status: 400, error: 'Invalid roomId format' };
  }
  return { ok: true };
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SSEClient {
  userId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

// ─── In-memory room registry ─────────────────────────────────────────────────
// Module-level variable so it survives HMR hot-reloads in dev.

const rooms: Map<string, Set<SSEClient>> = new Map();

function getRoom(roomId: string): Set<SSEClient> {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId)!;
}

function removeClient(roomId: string, client: SSEClient): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(client);
  if (room.size === 0) rooms.delete(roomId);
}

function encodeSSE(event: string, data: unknown): Uint8Array {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(line);
}

function broadcast(roomId: string, event: CollabEvent, excludeUserId?: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const dead: SSEClient[] = [];
  for (const client of room) {
    if (client.userId === excludeUserId) continue;
    try {
      client.controller.enqueue(encodeSSE(event.type, event));
    } catch {
      dead.push(client);
    }
  }
  for (const d of dead) removeClient(roomId, d);
}

// ─── GET — open SSE stream ────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
  const authUser = await getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId') ?? '';
  const userId = authUser.userId;

  const auth = await authorizeRoom(roomId, userId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  let thisClient: SSEClient;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      thisClient = { userId, controller };
      const room = getRoom(roomId);
      room.add(thisClient);

      // Send initial connected confirmation
      const joinEvent: CollabEvent = {
        type: 'user_join',
        userId,
        payload: { roomId, usersOnline: room.size },
        ts: Date.now(),
      };
      controller.enqueue(encodeSSE('user_join', joinEvent));

      // Broadcast join to others
      broadcast(
        roomId,
        { type: 'user_join', userId, payload: { roomId }, ts: Date.now() },
        userId,
      );

      // Heartbeat every 25 s to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Clean up when client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        removeClient(roomId, thisClient);
        broadcast(
          roomId,
          { type: 'user_leave', userId, payload: {}, ts: Date.now() },
        );
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ─── POST — receive event, broadcast to room ──────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const authUser = await getAuthUser(request);
  if (!authUser) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 600 events / minute / user is well above any legitimate UI rate (cursor
  // throttling already caps at ~30/s) but blocks accidental tight loops or
  // hostile floods that can DoS the in-memory broadcast.
  const rl = rateLimit(`collab-post:${authUser.userId}`, 600, 60_000);
  if (!rl.allowed) {
    return Response.json({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }, { status: 429 });
  }

  let body: { roomId?: string; event?: Partial<CollabEvent> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { roomId = '', event } = body;
  const userId = authUser.userId;

  const auth = await authorizeRoom(roomId, userId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  if (!event?.type) {
    return Response.json({ error: 'Missing event.type' }, { status: 400 });
  }

  const allowedTypes: CollabEventType[] = [
    'cursor_move',
    'param_change',
    'shape_change',
    'user_join',
    'user_leave',
    // CRDT transport
    'crdt_update',
    'crdt_sync_request',
    'crdt_sync_response',
    'crdt_awareness',
  ];
  if (!allowedTypes.includes(event.type as CollabEventType)) {
    return Response.json({ error: 'Unknown event type' }, { status: 400 });
  }

  const collabEvent: CollabEvent = {
    type: event.type as CollabEventType,
    userId,
    payload: event.payload ?? {},
    ts: Date.now(),
  };

  broadcast(roomId, collabEvent, userId);

  return Response.json({ ok: true, room: roomId, clients: rooms.get(roomId)?.size ?? 0 });
}
