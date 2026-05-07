import { use } from 'react';
import type { Metadata } from 'next';
import NexyfabNav from '@/components/nexyfab/NexyfabNav';
import ToastProvider from '@/components/ToastProvider';
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
      <div
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          background: '#0d1117',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <NexyfabNav lang={lang} />
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
            style={{
              padding: '12px 24px',
              fontSize: '11px',
              color: '#6b7280',
              textAlign: 'center',
              borderTop: '1px solid #1e293b',
              background: '#0d1117',
              lineHeight: 1.6,
              flexShrink: 0,
            }}
          >
            <span>© 2026 Nexysys Lab Co., Ltd.</span>
            {' | '}
            <a href={`/${lang}/terms-of-use`} style={{ color: '#6b7280', textDecoration: 'underline' }}>
              {t.terms}
            </a>
            {' | '}
            <a href={`/${lang}/privacy-policy`} style={{ color: '#6b7280', textDecoration: 'underline' }}>
              {t.privacy}
            </a>
          </footer>
        </main>
      </div>
    </ToastProvider>
  );
}
