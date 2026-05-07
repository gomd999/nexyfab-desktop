'use client';

import ToastProvider from '@/components/ToastProvider';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
