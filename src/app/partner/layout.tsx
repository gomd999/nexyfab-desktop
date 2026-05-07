import { Noto_Sans_KR } from 'next/font/google';
import ToastProvider from '@/components/ToastProvider';
import PartnerNav from './PartnerNav';

const notoSansKR = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-noto-sans-kr',
});

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={notoSansKR.variable}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body
        suppressHydrationWarning
        style={{ margin: 0, fontFamily: 'var(--font-noto-sans-kr), Pretendard, sans-serif' }}
      >
        <ToastProvider>
          <div style={{ display: 'flex', minHeight: '100vh' }}>
            <PartnerNav />
            <div style={{ flex: 1, minWidth: 0 }}>
              {children}
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
