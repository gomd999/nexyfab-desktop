'use client';

import { useState, useCallback, useRef } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration: number;
  /** Optional inline action button */
  action?: { label: string; onClick: () => void };
}

export interface UseToast {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string, duration?: number, action?: Toast['action']) => void;
  removeToast: (id: string) => void;
}

const MAX_TOASTS = 5;

let toastCounter = 0;

export function useToast(): UseToast {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((type: Toast['type'], message: string, duration: number = 3000, action?: Toast['action']) => {
    const id = `toast-${++toastCounter}-${Date.now()}`;
    const toast: Toast = { id, type, message, duration, action };

    setToasts(prev => {
      const next = [...prev, toast];
      // Remove oldest if exceeding max
      if (next.length > MAX_TOASTS) {
        const removed = next.shift()!;
        const timer = timersRef.current.get(removed.id);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(removed.id);
        }
      }
      return next;
    });

    // Auto-remove after duration
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
    timersRef.current.set(id, timer);
  }, []);

  return { toasts, addToast, removeToast };
}
