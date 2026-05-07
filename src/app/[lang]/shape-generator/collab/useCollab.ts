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

export interface CollabChatMessage {
  id: string;
  userId: string;
  name: string;
  color: string;
  text: string;
  ts: number;
}

export interface CollabCallbacks {
  onRemoteParamChange?: (params: Record<string, number>) => void;
  onRemoteShapeChange?: (shapeId: string) => void;
  onRemoteCommentAdd?: (comment: unknown) => void;
  onRemoteCommentResolve?: (id: string) => void;
  onRemoteCommentDelete?: (id: string) => void;
  onRemoteCommentReact?: (id: string, emoji: string, userId: string) => void;
  onRemoteCommentReply?: (commentId: string, reply: unknown) => void;
  onChatMessage?: (msg: CollabChatMessage) => void;
  onRemoteFeatureSync?: (history: unknown) => void;
}

export function useCollab(callbacks: CollabCallbacks = {}) {
  const [users, setUsers] = useState<CollabUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({}); // userId → name
  const [isConnected, setIsConnected] = useState(false);
  const [mode, setModeState] = useState<CollabMode>('off');
  const [roomId, setRoomIdState] = useState<string>(() => generateRoomId());
  const callbacksRef = useRef(callbacks);
  useEffect(() => { callbacksRef.current = callbacks; });

  // Legacy alias kept for callers that still use demoMode boolean
  const demoMode = mode === 'demo';

  const demoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  // Reconnect state for SSE with exponential backoff
  const sseReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseReconnectAttemptsRef = useRef(0);
  const sseReconnectEnabledRef = useRef(false);
  const [reconnectState, setReconnectState] = useState<'idle' | 'connecting' | 'connected' | 'retrying' | 'failed'>('idle');
  const [reconnectCountdown, setReconnectCountdown] = useState(0);
  const userIdRef = useRef<string>(generateUserId());
  const userColorRef = useRef<string>(
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
  );

  // Throttle/debounce refs
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shapeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({}); // auto-clear typing after 3s

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
    } else if (type === 'param_change') {
      const p = payload as Record<string, number>;
      callbacksRef.current.onRemoteParamChange?.(p);
    } else if (type === 'shape_change') {
      const p = payload as { shapeId?: string };
      if (p.shapeId) callbacksRef.current.onRemoteShapeChange?.(p.shapeId);
    } else if (type === 'comment_add') {
      callbacksRef.current.onRemoteCommentAdd?.(payload);
    } else if (type === 'comment_resolve') {
      const p = payload as { id: string };
      if (p.id) callbacksRef.current.onRemoteCommentResolve?.(p.id);
    } else if (type === 'comment_delete') {
      const p = payload as { id: string };
      if (p.id) callbacksRef.current.onRemoteCommentDelete?.(p.id);
    } else if (type === 'comment_react') {
      const p = payload as { id: string; emoji: string; userId: string };
      if (p.id) callbacksRef.current.onRemoteCommentReact?.(p.id, p.emoji, p.userId);
    } else if (type === 'comment_reply') {
      const p = payload as { commentId: string; reply: unknown };
      if (p.commentId) callbacksRef.current.onRemoteCommentReply?.(p.commentId, p.reply);
    } else if (type === 'chat_message') {
      const p = payload as CollabChatMessage;
      callbacksRef.current.onChatMessage?.(p);
    } else if (type === 'feature_sync') {
      callbacksRef.current.onRemoteFeatureSync?.(payload);
    } else if (type === 'typing_start') {
      const p = payload as { name: string };
      setTypingUsers(prev => ({ ...prev, [userId]: p.name ?? userId }));
      if (typingTimersRef.current[userId]) clearTimeout(typingTimersRef.current[userId]);
      typingTimersRef.current[userId] = setTimeout(() => {
        setTypingUsers(prev => { const next = { ...prev }; delete next[userId]; return next; });
      }, 3000);
    } else if (type === 'typing_stop') {
      if (typingTimersRef.current[userId]) clearTimeout(typingTimersRef.current[userId]);
      setTypingUsers(prev => { const next = { ...prev }; delete next[userId]; return next; });
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

  const MAX_RECONNECT_ATTEMPTS = 8;
  const INITIAL_RETRY_DELAY = 1000;
  const MAX_RETRY_DELAY = 30_000;

  const scheduleReconnect = useCallback((targetRoomId: string) => {
    if (!sseReconnectEnabledRef.current) return;
    const attempt = sseReconnectAttemptsRef.current + 1;
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      setReconnectState('failed');
      return;
    }
    sseReconnectAttemptsRef.current = attempt;
    const delay = Math.min(INITIAL_RETRY_DELAY * 2 ** (attempt - 1), MAX_RETRY_DELAY);
    setReconnectState('retrying');
    setReconnectCountdown(Math.ceil(delay / 1000));

    let remaining = Math.ceil(delay / 1000);
    const tickTimer = setInterval(() => {
      remaining -= 1;
      setReconnectCountdown(Math.max(0, remaining));
      if (remaining <= 0) clearInterval(tickTimer);
    }, 1000);

    if (sseReconnectTimerRef.current) clearTimeout(sseReconnectTimerRef.current);
    sseReconnectTimerRef.current = setTimeout(() => {
      clearInterval(tickTimer);
      if (!sseReconnectEnabledRef.current) return;
      // Call startRealtime again via ref below (declared next)
      startRealtimeRef.current?.(targetRoomId);
    }, delay);
  }, []);

  const startRealtimeRef = useRef<((id: string) => void) | null>(null);

  const startRealtime = useCallback(
    (targetRoomId: string) => {
      // Close any existing SSE
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      sseReconnectEnabledRef.current = true;
      setReconnectState('connecting');

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
        'cursor_move', 'param_change', 'shape_change', 'user_join', 'user_leave', 'feature_sync'
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

      sse.onopen = () => {
        setIsConnected(true);
        setReconnectState('connected');
        sseReconnectAttemptsRef.current = 0; // reset backoff on successful connect
        if (sseReconnectTimerRef.current) {
          clearTimeout(sseReconnectTimerRef.current);
          sseReconnectTimerRef.current = null;
        }
      };
      sse.onerror = () => {
        setIsConnected(false);
        // EventSource auto-closes on fatal error. Try manual reconnect.
        if (sse.readyState === EventSource.CLOSED) {
          if (sseRef.current === sse) sseRef.current = null;
          scheduleReconnect(targetRoomId);
        }
      };

      return sse;
    },
    [applyEvent, scheduleReconnect],
  );

  // Keep ref in sync for scheduleReconnect callback cycle
  useEffect(() => { startRealtimeRef.current = startRealtime; }, [startRealtime]);

  const manualReconnect = useCallback((targetRoomId?: string) => {
    sseReconnectAttemptsRef.current = 0;
    if (sseReconnectTimerRef.current) { clearTimeout(sseReconnectTimerRef.current); sseReconnectTimerRef.current = null; }
    startRealtime(targetRoomId ?? roomId);
  }, [startRealtime, roomId]);

  const stopRealtime = useCallback(() => {
    sseReconnectEnabledRef.current = false;
    if (sseReconnectTimerRef.current) {
      clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }
    sseReconnectAttemptsRef.current = 0;
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setUsers([]);
    setIsConnected(false);
    setReconnectState('idle');
    setReconnectCountdown(0);
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

  // ── Send comment events ───────────────────────────────────────────────────

  const sendCommentAdd = useCallback(
    (comment: unknown) => {
      if (mode !== 'realtime') return;
      postEvent('comment_add', comment);
    },
    [mode, postEvent],
  );

  const sendFeatureSync = useCallback(
    (history: unknown) => {
      if (mode !== 'realtime') return;
      postEvent('feature_sync', history);
    },
    [mode, postEvent],
  );

  const sendCommentResolve = useCallback(
    (id: string) => {
      if (mode !== 'realtime') return;
      postEvent('comment_resolve', { id });
    },
    [mode, postEvent],
  );

  const sendCommentDelete = useCallback(
    (id: string) => {
      if (mode !== 'realtime') return;
      postEvent('comment_delete', { id });
    },
    [mode, postEvent],
  );

  const sendCommentReact = useCallback(
    (id: string, emoji: string) => {
      if (mode !== 'realtime') return;
      postEvent('comment_react', { id, emoji, userId: userIdRef.current });
    },
    [mode, postEvent],
  );

  const sendCommentReply = useCallback(
    (commentId: string, reply: unknown) => {
      if (mode !== 'realtime') return;
      postEvent('comment_reply', { commentId, reply });
    },
    [mode, postEvent],
  );

  // ── Send typing indicator ─────────────────────────────────────────────────

  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendTyping = useCallback(
    (name?: string) => {
      if (mode !== 'realtime') return;
      postEvent('typing_start', { name: name ?? `User-${userIdRef.current.slice(-4)}` });
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = setTimeout(() => {
        postEvent('typing_stop', {});
        typingStopTimerRef.current = null;
      }, 2500);
    },
    [mode, postEvent],
  );

  // ── Send chat message ─────────────────────────────────────────────────────

  const sendChatMessage = useCallback(
    (text: string, name?: string) => {
      if (mode !== 'realtime') return;
      const msg: CollabChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: userIdRef.current,
        name: name ?? `User-${userIdRef.current.slice(-4)}`,
        color: userColorRef.current,
        text,
        ts: Date.now(),
      };
      postEvent('chat_message', msg);
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
    typingUsers,
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
    sendCommentAdd,
    sendCommentResolve,
    sendCommentDelete,
    sendCommentReact,
    sendCommentReply,
    sendTyping,
    sendChatMessage,
    sendFeatureSync,
    userIdRef,
    userColorRef,
    connect,
    disconnect,
    // Reconnect state (Phase 3 — offline/reconnect UX)
    reconnectState,
    reconnectCountdown,
    manualReconnect,
  };
}
