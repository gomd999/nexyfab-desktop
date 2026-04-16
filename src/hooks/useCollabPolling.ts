// ─── useCollabPolling ─────────────────────────────────────────────────────────
// Polling-based real-time collaboration hook for NexyFab.
// Polls GET /api/nexyfab/collab every 2 s; posts join/ping/leave actions.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from './useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CollabSession {
  sessionId: string;
  userId: string;
  userName: string;
  cursor?: { x: number; y: number; z: number };
  lastPing: number;
  color: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000;
const CURSOR_THROTTLE_MS = 200;

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCollabPolling(
  projectId: string | null,
  enabled: boolean,
): {
  sessions: CollabSession[];
  mySessionId: string;
  updateCursor: (cursor: { x: number; y: number; z: number }) => void;
} {
  const { user } = useAuthStore();

  // Stable session ID for this browser tab's lifetime (always created, even when projectId is null)
  const [mySessionId] = useState(() => generateSessionId());

  const [sessions, setSessions] = useState<CollabSession[]>([]);

  // Pause polling when tab is hidden
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handler = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Pending cursor update (throttled)
  const pendingCursor = useRef<{ x: number; y: number; z: number } | null>(null);
  const cursorThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Core POST helper ────────────────────────────────────────────────────────

  const postAction = useCallback(
    async (
      action: 'join' | 'leave' | 'ping',
      cursor?: { x: number; y: number; z: number },
    ) => {
      if (!projectId || !user) return;
      try {
        await fetch('/api/nexyfab/collab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            sessionId: mySessionId,
            userId: user.id,
            userName: user.name,
            cursor,
            action,
          }),
        });
      } catch {
        // Non-critical — swallow network errors
      }
    },
    [projectId, user, mySessionId],
  );

  // ── Polling ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !projectId || !user) return;

    let stopped = false;

    // Join immediately
    postAction('join');

    const poll = async () => {
      if (stopped) return;
      // Skip ping/fetch when tab is hidden to save bandwidth
      if (!isVisible) return;
      try {
        const res = await fetch(
          `/api/nexyfab/collab?projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(mySessionId)}`,
        );
        if (res.ok) {
          const data: { sessions: CollabSession[] } = await res.json();
          if (!stopped) setSessions(data.sessions ?? []);
        }
      } catch {
        // swallow
      }

      // Send ping alongside poll cursor if pending
      const cursor = pendingCursor.current ?? undefined;
      pendingCursor.current = null;
      postAction('ping', cursor);
    };

    poll(); // immediate first poll
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      // Fire-and-forget leave on unmount (best-effort, keepalive)
      if (navigator.sendBeacon) {
        const payload = JSON.stringify({
          projectId,
          sessionId: mySessionId,
          userId: user.id,
          userName: user.name,
          action: 'leave',
        });
        navigator.sendBeacon('/api/nexyfab/collab', new Blob([payload], { type: 'application/json' }));
      } else {
        // fallback – fire async but don't await
        postAction('leave');
      }
    };
  }, [enabled, projectId, user, mySessionId, postAction, isVisible]);

  // ── Cursor update (throttled 200 ms) ────────────────────────────────────────

  const updateCursor = useCallback(
    (cursor: { x: number; y: number; z: number }) => {
      pendingCursor.current = cursor;
      if (cursorThrottleTimer.current) return; // already scheduled
      cursorThrottleTimer.current = setTimeout(() => {
        cursorThrottleTimer.current = null;
        // The next poll will pick up pendingCursor; nothing extra needed here.
      }, CURSOR_THROTTLE_MS);
    },
    [],
  );

  return { sessions, mySessionId, updateCursor };
}
