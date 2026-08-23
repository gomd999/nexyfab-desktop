import { Suspense, use } from 'react';
import type { Metadata } from 'next';
import NexyfabUnifiedSidebar from '@/components/nexyfab/NexyfabUnifiedSidebar';
import ToastProvider from '@/components/ToastProvider';
import NfBodyMode from './NfBodyMode';
import { buildMetadata } from '@/lib/metaHelper';
import { toRouteLang, type RouteLang } from '@/lib/i18n/normalize';

export async function generateMetadata(
  { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'nexyfab');
}

interface NexyfabLayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

const FOOTER_DICT: Record<RouteLang, { terms: string; privacy: string }> = {
  kr: { terms: '이용약관', privacy: '개인정보처리방침' },
  en: { terms: 'Terms', privacy: 'Privacy' },
  ja: { terms: '利用規約', privacy: 'プライバシー' },
  cn: { terms: '服务条款', privacy: '隐私政策' },
  es: { terms: 'Términos', privacy: 'Privacidad' },
  ar: { terms: 'الشروط', privacy: 'الخصوصية' },
};

export default function NexyfabLayout({ children, params }: NexyfabLayoutProps) {
  const { lang } = use(params);
  const routeLang = toRouteLang(lang);
  const t = FOOTER_DICT[routeLang];

  return (
    <ToastProvider>
      <NfBodyMode />
      <div
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          background: 'var(--nx-bg)',
          color: 'var(--nx-text)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <style>{`
          .nf-uni-nav-fallback { width: 220px; min-width: 220px; }
          @media (max-width: 768px) {
            .nf-uni-nav-fallback { width: 56px; min-width: 56px; }
          }
        `}</style>
        <Suspense fallback={<aside className="nf-uni-nav-fallback" aria-hidden="true" style={{ flex: '0 0 auto', background: 'var(--nx-panel)', borderRight: '1px solid var(--nx-border)' }} />}>
          <NexyfabUnifiedSidebar lang={routeLang} />
        </Suspense>
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ flex: 1 }}>{children}</div>
          <footer
            data-shell-v2-hide="nexyfab-footer"
            style={{
              padding: '12px 24px',
              fontSize: '11px',
              color: 'var(--nx-text-3)',
              textAlign: 'center',
              borderTop: '1px solid var(--nx-border)',
              background: 'var(--nx-panel)',
              lineHeight: 1.6,
              flexShrink: 0,
            }}
          >
            <span>© 2026 Nexysys Lab Co., Ltd.</span>
            {' | '}
            <a href={`/${routeLang}/terms-of-use`} style={{ color: 'var(--nx-text-3)', textDecoration: 'underline' }}>
              {t.terms}
            </a>
            {' | '}
            <a href={`/${routeLang}/privacy-policy`} style={{ color: 'var(--nx-text-3)', textDecoration: 'underline' }}>
              {t.privacy}
            </a>
          </footer>
        </main>
      </div>
    </ToastProvider>
  );
}
