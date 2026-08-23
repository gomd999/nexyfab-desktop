import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ToastProvider from '@/components/ToastProvider';
import LangSetter from '@/components/LangSetter';
import { Suspense } from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body suppressHydrationWarning style={{ margin: 0, fontFamily: 'var(--font-noto-sans-kr), Pretendard, sans-serif' }}>
        <ToastProvider>
          <LangSetter />
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          <main><Suspense fallback={null}>{children}</Suspense></main>
          <Footer />
        </ToastProvider>
      </body>
    </html>
  );
}
