'use client';

import { useEffect, useRef } from 'react';

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
  
  useEffect(() => {
    onNotifRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (!enabled) return;
    
    let isSubscribed = true;

    const connect = () => {
      if (!isSubscribed) return;
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
        if (enabled && isSubscribed) setTimeout(connect, 10_000);
      };
    };

    connect();

    return () => {
      isSubscribed = false;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled]);
}
