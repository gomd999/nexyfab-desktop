'use client';

import ToastProvider from '@/components/ToastProvider';

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
