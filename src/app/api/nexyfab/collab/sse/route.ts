// Server-Sent-Events transport for Yjs collab updates.
// GET  /api/nexyfab/collab/sse?project=<id>   — subscribe (stream of updates)
// POST /api/nexyfab/collab/sse?project=<id>   — publish Yjs update bytes (base64)
//
// In-memory broadcast channel per project. Replace with Redis pub/sub or
// Durable Objects when horizontal scaling is needed; current single-process
// Railway deployment makes this MVP correct.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';

export const dynamic = 'force-dynamic';

interface Subscriber {
  id: string;
  send: (event: string, payload: string) => void;
  close: () => void;
}

const channels = new Map<string, Set<Subscriber>>();

function broadcast(projectId: string, event: string, payload: string, except?: string) {
  const subs = channels.get(projectId);
  if (!subs) return;
  for (const sub of subs) {
    if (sub.id === except) continue;
    try { sub.send(event, payload); } catch { /* ignore broken pipe */ }
  }
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('project');
  if (!projectId) return NextResponse.json({ error: 'project required' }, { status: 400 });

  // Project-membership gate: only the owner or an invited member may subscribe
  // to a project's collab stream. Without this any authenticated user could
  // read another tenant's live edits (IDOR).
  const access = await resolveProjectAccess(getDbAdapter(), projectId, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const subId = `${authUser.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, payload: string) => {
        const chunk = `event: ${event}\ndata: ${payload}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      const sub: Subscriber = {
        id: subId,
        send,
        close: () => {
          try { controller.close(); } catch { /* ignore */ }
          const set = channels.get(projectId);
          if (set) {
            set.delete(sub);
            if (set.size === 0) channels.delete(projectId);
          }
        },
      };
      let set = channels.get(projectId);
      if (!set) { set = new Set(); channels.set(projectId, set); }
      set.add(sub);

      send('ready', JSON.stringify({ sessionId: subId, peers: set.size - 1 }));

      // Heartbeat every 25s to keep the connection alive through proxies.
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(':\n\n')); } catch { clearInterval(hb); sub.close(); }
      }, 25_000);

      // Cleanup on disconnect.
      req.signal.addEventListener('abort', () => {
        clearInterval(hb);
        sub.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('project');
  if (!projectId) return NextResponse.json({ error: 'project required' }, { status: 400 });

  // Publishing a doc mutation requires edit rights; viewers (and non-members)
  // are rejected so they can't inject updates into a project they can't edit.
  const access = await resolveProjectAccess(getDbAdapter(), projectId, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!access.canEdit) return NextResponse.json({ error: 'Forbidden: viewer cannot publish updates' }, { status: 403 });

  const body = await req.json().catch(() => null) as { sessionId?: string; update?: string; kind?: 'doc' | 'awareness' } | null;
  if (!body?.update) return NextResponse.json({ error: 'update required' }, { status: 400 });

  const kind = body.kind === 'awareness' ? 'awareness' : 'doc';
  broadcast(projectId, kind, JSON.stringify({ from: body.sessionId ?? '', update: body.update }), body.sessionId);
  return NextResponse.json({ ok: true });
}
