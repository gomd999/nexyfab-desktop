import { Suspense } from 'react';
import ToastProvider from '@/components/ToastProvider';
import PartnerNav from './PartnerNav';
import LegacyMigrationBanner from './LegacyMigrationBanner';

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body
        suppressHydrationWarning
        style={{ margin: 0, fontFamily: 'var(--font-noto-sans-kr), Pretendard, sans-serif' }}
      >
        <ToastProvider>
          <div style={{ display: 'flex', minHeight: '100vh' }}>
            {/* Suspense boundary required because PartnerNav + child pages
                call useSearchParams() via usePartnerLang(); without this,
                static prerender of /partner/* pages bails out. */}
            <Suspense fallback={null}>
              <PartnerNav />
            </Suspense>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Suspense fallback={null}>
                <LegacyMigrationBanner />
              </Suspense>
              <Suspense fallback={null}>{children}</Suspense>
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
