'use client';

import ToastProvider from '@/components/ToastProvider';

export default function ViewLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
