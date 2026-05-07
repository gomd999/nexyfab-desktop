'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastCtx {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d', icon: '\u2713' },
  error: { bg: '#fef2f2', border: '#ef4444', text: '#dc2626', icon: '\u2717' },
  warning: { bg: '#fffbeb', border: '#f59e0b', text: '#b45309', icon: '\u26A0' },
  info: { bg: '#eff6ff', border: '#3b82f6', text: '#2563eb', icon: '\u2139' },
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 99999,
          display: 'flex', flexDirection: 'column', gap: '8px',
          pointerEvents: 'none',
        }}>
          {toasts.map(t => {
            const c = COLORS[t.type];
            return (
              <div key={t.id} style={{
                pointerEvents: 'auto',
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '12px 20px', borderRadius: '12px',
                background: c.bg, border: `1px solid ${c.border}`,
                color: c.text, fontSize: '14px', fontWeight: 600,
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                animation: 'toast-slide-in 0.3s ease',
                maxWidth: '400px',
              }}>
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{c.icon}</span>
                {t.message}
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}
