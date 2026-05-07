import { NextRequest } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { notificationRecipientKeys, sqlPlaceholders } from '@/lib/notificationRecipientKeys';

export const dynamic = 'force-dynamic';

// GET /api/notifications/stream
// Server-Sent Events — streams new notifications to the client
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return new Response('Unauthorized', { status: 401 });
  }

  const recipients = notificationRecipientKeys(authUser);
  let lastCheck = Date.now();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(`event: connected\ndata: ${JSON.stringify({ recipientCount: recipients.length, ts: lastCheck })}\n\n`);

      const poll = async () => {
        if (closed) return;
        try {
          const db = getDbAdapter();
          // Fetch notifications newer than lastCheck
          const rows = await db.queryAll<{
            id: string; type: string; title: string; body: string | null;
            link: string | null; created_at: number; read: number | boolean;
          }>(
            `SELECT id, type, title, body, link, created_at, read
             FROM nf_notifications
             WHERE user_id IN (${sqlPlaceholders(recipients.length)}) AND created_at > ?
             ORDER BY created_at ASC LIMIT 20`,
            ...recipients, lastCheck - 1000,
          );

          if (rows.length > 0) {
            lastCheck = Date.now();
            for (const row of rows) {
              const data = JSON.stringify({
                id: row.id,
                type: row.type,
                title: row.title,
                body: row.body,
                link: row.link,
                createdAt: new Date(row.created_at).toISOString(),
                read: Boolean(row.read),
              });
              controller.enqueue(`event: notification\ndata: ${data}\n\n`);
            }
          } else {
            // Heartbeat every 30s to keep connection alive
            controller.enqueue(`: heartbeat\n\n`);
          }
        } catch {
          controller.enqueue(`: error\n\n`);
        }

        if (!closed) setTimeout(poll, 5000); // poll every 5 seconds
      };

      setTimeout(poll, 1000); // first poll after 1s

      // Handle client disconnect
      req.signal.addEventListener('abort', () => {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  });
}
