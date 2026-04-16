'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { CollabUser, CollabMessage } from './CollabTypes';
import type { CollabEvent, CollabEventType } from '@/app/api/collab/types';

// ─── Demo user presets ───────────────────────────────────────────────────────

const DEMO_USERS: Omit<CollabUser, 'lastSeen'>[] = [
  { id: 'demo-1', name: 'Alice', color: '#f97316', cursor: { x: 15, y: 10, z: 5 } },
  { id: 'demo-2', name: 'Bob', color: '#22d3ee', cursor: { x: -10, y: 5, z: 15 } },
];

const USER_COLORS = [
  '#f97316', '#22d3ee', '#a78bfa', '#34d399', '#f43f5e',
  '#facc15', '#60a5fa', '#fb7185', '#4ade80', '#c084fc',
];

function randomOffset(range: number): number {
  return (Math.random() - 0.5) * range;
}

function generateUserId(): string {
  return `u-${Math.random().toString(36).slice(2, 9)}`;
}

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── Mode type ───────────────────────────────────────────────────────────────

export type CollabMode = 'off' | 'demo' | 'realtime';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useCollab() {
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setModeState] = useState<CollabMode>('off');
  const [roomId, setRoomIdState] = useState<string>(() => generateRoomId());

  // Legacy alias kept for callers that still use demoMode boolean
  const demoMode = mode === 'demo';

  const demoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const userIdRef = useRef<string>(generateUserId());
  const userColorRef = useRef<string>(
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
  );

  // Throttle/debounce refs
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shapeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const postEvent = useCallback(
    (type: CollabEventType, payload: unknown) => {
      fetch('/api/collab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId: userIdRef.current, event: { type, payload } }),
      }).catch(() => {/* best-effort */});
    },
    [roomId],
  );

  // ── Apply an incoming SSE collab event to local state ─────────────────────

  const applyEvent = useCallback((evt: CollabEvent) => {
    const { type, userId, payload } = evt;

    if (type === 'cursor_move') {
      const p = payload as { cursor?: { x: number; y: number; z: number }; name?: string; color?: string };
      setUsers(prev => {
        const idx = prev.findIndex(u => u.id === userId);
        const updated: CollabUser = {
          id: userId,
          name: p.name ?? userId,
          color: p.color ?? '#8b9cf4',
          cursor: p.cursor,
          lastSeen: Date.now(),
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
    } else if (type === 'user_join') {
      const p = payload as { name?: string; color?: string };
      setUsers(prev => {
        if (prev.find(u => u.id === userId)) return prev;
        return [
          ...prev,
          { id: userId, name: p.name ?? userId, color: p.color ?? '#8b9cf4', lastSeen: Date.now() },
        ];
      });
    } else if (type === 'user_leave') {
      setUsers(prev => prev.filter(u => u.id !== userId));
    } else if (type === 'param_change' || type === 'shape_change') {
      // consumers can subscribe to these via additional callbacks if needed
    }
  }, []);

  // ── Demo mode ─────────────────────────────────────────────────────────────

  const startDemo = useCallback(() => {
    const now = Date.now();
    const initial: CollabUser[] = DEMO_USERS.map(u => ({ ...u, lastSeen: now }));
    setUsers(initial);
    setIsConnected(true);
    demoTimerRef.current = setInterval(() => {
      setUsers(prev =>
        prev.map(u => ({
          ...u,
          cursor: u.cursor
            ? {
                x: u.cursor.x + randomOffset(8),
                y: Math.max(0, u.cursor.y + randomOffset(4)),
                z: u.cursor.z + randomOffset(8),
              }
            : undefined,
          lastSeen: Date.now(),
        })),
      );
    }, 2000 + Math.random() * 1000);
  }, []);

  const stopDemo = useCallback(() => {
    if (demoTimerRef.current) {
      clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
    setUsers([]);
    setIsConnected(false);
  }, []);

  // ── Realtime mode (SSE) ───────────────────────────────────────────────────

  const startRealtime = useCallback(
    (targetRoomId: string) => {
      // Close any existing SSE
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }

      const url = `/api/collab?roomId=${encodeURIComponent(targetRoomId)}&userId=${encodeURIComponent(userIdRef.current)}`;
      const sse = new EventSource(url);
      sseRef.current = sse;

      const handleEvent = (rawType: string, data: string) => {
        try {
          const evt = JSON.parse(data) as CollabEvent;
          // Ignore own events
          if (evt.userId === userIdRef.current) return;
          applyEvent({ ...evt, type: rawType as CollabEventType });
        } catch { /* ignore malformed */ }
      };

      const eventTypes: CollabEventType[] = [
        'cursor_move', 'param_change', 'shape_change', 'user_join', 'user_leave',
      ];

      for (const et of eventTypes) {
        sse.addEventListener(et, (e: MessageEvent) => handleEvent(et, e.data));
      }

      sse.addEventListener('user_join', (e: MessageEvent) => {
        try {
          const evt = JSON.parse(e.data) as CollabEvent;
          // If this is our own join echo with usersOnline, we're connected
          if (evt.userId === userIdRef.current) {
            setIsConnected(true);
          } else {
            applyEvent(evt);
          }
        } catch { /* ignore */ }
      });

      sse.onopen = () => setIsConnected(true);
      sse.onerror = () => setIsConnected(false);

      return sse;
    },
    [applyEvent],
  );

  const stopRealtime = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setUsers([]);
    setIsConnected(false);
  }, []);

  // ── setMode ───────────────────────────────────────────────────────────────

  const setMode = useCallback(
    (nextMode: CollabMode) => {
      // Tear down current mode
      if (demoTimerRef.current) { clearInterval(demoTimerRef.current); demoTimerRef.current = null; }
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      setUsers([]);
      setIsConnected(false);
      setModeState(nextMode);

      if (nextMode === 'demo') startDemo();
      if (nextMode === 'realtime') startRealtime(roomId);
    },
    [startDemo, startRealtime, roomId],
  );

  // Legacy alias
  const setDemoMode = useCallback(
    (enabled: boolean) => setMode(enabled ? 'demo' : 'off'),
    [setMode],
  );

  // ── setRoomId ─────────────────────────────────────────────────────────────

  const setRoomId = useCallback(
    (id: string) => {
      setRoomIdState(id);
      if (mode === 'realtime') {
        // Reconnect to new room
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
        startRealtime(id);
      }
    },
    [mode, startRealtime],
  );

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (demoTimerRef.current) clearInterval(demoTimerRef.current);
      if (sseRef.current) sseRef.current.close();
      if (cursorThrottleRef.current) clearTimeout(cursorThrottleRef.current);
      if (paramDebounceRef.current) clearTimeout(paramDebounceRef.current);
      if (shapeDebounceRef.current) clearTimeout(shapeDebounceRef.current);
    };
  }, []);

  // ── Send local cursor position ────────────────────────────────────────────

  const sendCursor = useCallback(
    (pos: { x: number; y: number; z: number }) => {
      // Legacy WebSocket path (kept for backward compatibility)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: CollabMessage = { type: 'cursor', userId: 'local', payload: pos };
        wsRef.current.send(JSON.stringify(msg));
      }

      // Realtime SSE path — throttle to 100 ms
      if (mode === 'realtime') {
        if (cursorThrottleRef.current) return;
        cursorThrottleRef.current = setTimeout(() => {
          cursorThrottleRef.current = null;
        }, 100);
        postEvent('cursor_move', {
          cursor: pos,
          name: `User-${userIdRef.current.slice(-4)}`,
          color: userColorRef.current,
        });
      }
    },
    [mode, postEvent],
  );

  // ── Send param change ─────────────────────────────────────────────────────

  const sendParamChange = useCallback(
    (params: Record<string, unknown>) => {
      if (mode !== 'realtime') return;
      if (paramDebounceRef.current) clearTimeout(paramDebounceRef.current);
      paramDebounceRef.current = setTimeout(() => {
        postEvent('param_change', params);
        paramDebounceRef.current = null;
      }, 300);
    },
    [mode, postEvent],
  );

  // ── Send shape change ─────────────────────────────────────────────────────

  const sendShapeChange = useCallback(
    (shapeId: string) => {
      if (mode !== 'realtime') return;
      if (shapeDebounceRef.current) clearTimeout(shapeDebounceRef.current);
      shapeDebounceRef.current = setTimeout(() => {
        postEvent('shape_change', { shapeId });
        shapeDebounceRef.current = null;
      }, 300);
    },
    [mode, postEvent],
  );

  // ── Legacy WebSocket connect/disconnect (kept for backward compat) ─────────

  const connect = useCallback((url: string) => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => { setIsConnected(false); wsRef.current = null; };
      ws.onmessage = (event) => {
        try {
          const msg: CollabMessage = JSON.parse(event.data);
          if (msg.type === 'cursor') {
            setUsers(prev => {
              const idx = prev.findIndex(u => u.id === msg.userId);
              const updated: CollabUser = {
                id: msg.userId,
                name: msg.payload.name ?? msg.userId,
                color: msg.payload.color ?? '#8b9cf4',
                cursor: msg.payload.cursor,
                cursor2d: msg.payload.cursor2d,
                activeFeature: msg.payload.activeFeature,
                lastSeen: Date.now(),
              };
              if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
              return [...prev, updated];
            });
          } else if (msg.type === 'presence' && msg.payload.action === 'leave') {
            setUsers(prev => prev.filter(u => u.id !== msg.userId));
          }
        } catch { /* ignore */ }
      };
    } catch { /* WebSocket not available */ }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setIsConnected(false);
    setUsers([]);
  }, []);

  return {
    users,
    isConnected,
    demoMode,
    mode,
    setMode,
    setDemoMode,
    roomId,
    setRoomId,
    sendCursor,
    sendParamChange,
    sendShapeChange,
    connect,
    disconnect,
  };
}
