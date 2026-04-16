import { use } from 'react';
import type { Metadata } from 'next';
import NexyfabNav from '@/components/nexyfab/NexyfabNav';
import { buildMetadata } from '@/lib/metaHelper';

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

export default function NexyfabLayout({ children, params }: NexyfabLayoutProps) {
  const { lang } = use(params);

  return (
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
            {lang === 'kr' ? '이용약관' : lang === 'ja' ? '利用規約' : lang === 'cn' ? '服务条款' : lang === 'es' ? 'Términos' : lang === 'ar' ? 'الشروط' : 'Terms'}
          </a>
          {' | '}
          <a href={`/${lang}/privacy-policy`} style={{ color: '#6b7280', textDecoration: 'underline' }}>
            {lang === 'kr' ? '개인정보처리방침' : lang === 'ja' ? 'プライバシー' : lang === 'cn' ? '隐私政策' : lang === 'es' ? 'Privacidad' : lang === 'ar' ? 'الخصوصية' : 'Privacy'}
          </a>
        </footer>
      </main>
    </div>
  );
}
