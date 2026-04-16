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
import type { CollabEventType, CollabEvent } from './types';

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
  const roomId = url.searchParams.get('roomId') ?? 'default';
  const userId = authUser.userId;

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

  let body: { roomId?: string; event?: Partial<CollabEvent> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { roomId = 'default', event } = body;
  const userId = authUser.userId;

  if (!event?.type) {
    return Response.json({ error: 'Missing event.type' }, { status: 400 });
  }

  const allowedTypes: CollabEventType[] = [
    'cursor_move',
    'param_change',
    'shape_change',
    'user_join',
    'user_leave',
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
