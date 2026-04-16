'use client';

import { useEffect, useState } from 'react';

const i18n: Record<string, { title: string; desc: string; home: string; inquiry: string }> = {
  ko: { title: '페이지를 찾을 수 없습니다', desc: '요청하신 페이지가 존재하지 않거나 이동되었습니다.', home: '홈으로 이동', inquiry: '프로젝트 문의' },
  en: { title: 'Page Not Found', desc: 'The page you are looking for does not exist or has been moved.', home: 'Go to Home', inquiry: 'Project Inquiry' },
  ja: { title: 'ページが見つかりません', desc: 'お探しのページは存在しないか、移動されました。', home: 'ホームへ移動', inquiry: 'プロジェクト相談' },
  cn: { title: '找不到页面', desc: '您查找的页面不存在或已移动。', home: '返回首页', inquiry: '项目咨询' },
  es: { title: 'Pagina No Encontrada', desc: 'La pagina que busca no existe o ha sido movida.', home: 'Ir al Inicio', inquiry: 'Consulta' },
  ar: { title: 'الصفحة غير موجودة', desc: 'الصفحة التي تبحث عنها غير موجودة أو تم نقلها.', home: 'الرئيسية', inquiry: 'استفسار' },
};

const langMap: Record<string, string> = { kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'cn', zh: 'cn', es: 'es', ar: 'ar' };

function detectLang(): { lang: string; code: string } {
  if (typeof window === 'undefined') return { lang: 'en', code: 'en' };
  const seg = window.location.pathname.split('/')[1] || '';
  if (['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(seg)) {
    return { lang: langMap[seg] || 'en', code: seg };
  }
  const nav = navigator.language?.slice(0, 2).toLowerCase() || 'en';
  const mapped = langMap[nav] || 'en';
  const codeMap: Record<string, string> = { ko: 'kr', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
  return { lang: mapped, code: codeMap[mapped] || 'en' };
}

export default function NotFound() {
  const [{ lang, code }, setDetected] = useState({ lang: 'en', code: 'en' });

  useEffect(() => {
    setDetected(detectLang());
  }, []);

  const t = i18n[lang] || i18n.en;

  return (
    <html lang={lang === 'ko' ? 'ko' : lang}>
      <body>
        <main style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center',
          padding: '40px 24px', fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#fafbfc',
        }}>
          <p style={{ fontSize: '14px', color: '#0b5cff', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '12px' }}>
            Nexyfab · 404
          </p>
          <h1 style={{ fontSize: '48px', fontWeight: 800, color: '#1A1F36', margin: '0 0 16px' }}>
            {t.title}
          </h1>
          <p style={{ fontSize: '16px', color: '#64748b', marginBottom: '36px', lineHeight: 1.7 }}>
            {t.desc}
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <a href={`/${code}`} style={{
              padding: '12px 28px', background: '#0b5cff', color: '#fff',
              borderRadius: '8px', fontWeight: 600, textDecoration: 'none', fontSize: '15px',
            }}>
              {t.home}
            </a>
            <a href={`/${code}/project-inquiry`} style={{
              padding: '12px 28px', background: '#fff', color: '#0b5cff',
              border: '2px solid #0b5cff', borderRadius: '8px', fontWeight: 600,
              textDecoration: 'none', fontSize: '15px',
            }}>
              {t.inquiry}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
