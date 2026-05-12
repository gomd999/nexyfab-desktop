/**
 * Browser SSE consumer for /api/nexyfab/scad-agent.
 *
 * EventSource doesn't support POST bodies, so we use `fetch` with a
 * streaming response.body and parse the SSE wire format ourselves. The
 * format we receive is exactly `data: <JSON>\n\n` per event — see
 * route.ts. AbortController lets the user cancel a slow run mid-stream.
 */
import type { AgentEvent, AgentSession } from './types';

export interface AgentStreamRequest {
  userPrompt: string;
  /** Continuation session from a previous run, or omit for fresh start. */
  session?: AgentSession | null;
  signal?: AbortSignal;
  onEvent: (ev: AgentEvent) => void;
  /** Fired on transport errors (network, non-200 response). */
  onError?: (err: { status?: number; message: string }) => void;
}

const SSE_BOUNDARY = '\n\n';

export async function streamScadAgent(req: AgentStreamRequest): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch('/api/nexyfab/scad-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPrompt: req.userPrompt,
        session: req.session ?? undefined,
      }),
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    req.onError?.({ message: (e as Error).message });
    return;
  }

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch { /* ignore */ }
    req.onError?.({ status: resp.status, message });
    return;
  }

  if (!resp.body) {
    req.onError?.({ message: 'no response body' });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on \n\n boundaries, leaving any trailing partial chunk in buffer.
      let idx;
      while ((idx = buffer.indexOf(SSE_BOUNDARY)) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + SSE_BOUNDARY.length);
        const ev = parseSseFrame(raw);
        if (ev) {
          try {
            req.onEvent(ev);
          } catch (e) {
            // Listener errors must not break the stream
            console.error('[scad-agent] onEvent threw:', e);
          }
        }
      }
    }
    // Flush any final frame in buffer (some servers omit trailing \n\n).
    if (buffer.trim()) {
      const ev = parseSseFrame(buffer);
      if (ev) req.onEvent(ev);
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      req.onError?.({ message: (e as Error).message });
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

function parseSseFrame(raw: string): AgentEvent | null {
  // Accept `data: {...}` and ignore comment / id lines.
  const lines = raw.split('\n');
  let dataLine = '';
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLine += line.slice(5).trim();
    }
  }
  if (!dataLine) return null;
  try {
    return JSON.parse(dataLine) as AgentEvent;
  } catch {
    return null;
  }
}
