'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface StreamNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export function useNotificationStream(
  onNotification: (n: StreamNotification) => void,
  enabled = true,
) {
  const esRef = useRef<EventSource | null>(null);
  const onNotifRef = useRef(onNotification);
  onNotifRef.current = onNotification;

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource('/api/notifications/stream');
    esRef.current = es;

    es.addEventListener('notification', (e) => {
      try {
        const data = JSON.parse(e.data) as StreamNotification;
        onNotifRef.current(data);
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // Reconnect after 10s on error
      if (enabled) setTimeout(connect, 10_000);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled, connect]);
}
