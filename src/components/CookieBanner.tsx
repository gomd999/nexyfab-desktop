'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'nf_cookie_consent';

const MESSAGES: Record<string, { text: string; essentialOnly: string; accept: string; detail: string }> = {
  ko: {
    text: '저희는 서비스 개선을 위해 쿠키를 사용합니다.',
    essentialOnly: '필수 쿠키만',
    accept: '모두 동의',
    detail: '자세히 보기 →',
  },
  en: {
    text: 'We use cookies to improve our service.',
    essentialOnly: 'Essential only',
    accept: 'Accept all',
    detail: 'Learn more →',
  },
  ja: {
    text: 'サービス向上のためにCookieを使用しています。',
    essentialOnly: '必須のみ',
    accept: 'すべて同意',
    detail: '詳細 →',
  },
  zh: {
    text: '我们使用 Cookie 以改善服务。',
    essentialOnly: '仅必要',
    accept: '全部同意',
    detail: '了解更多 →',
  },
  es: {
    text: 'Usamos cookies para mejorar nuestro servicio.',
    essentialOnly: 'Solo esenciales',
    accept: 'Aceptar todo',
    detail: 'Más info →',
  },
  ar: {
    text: 'نستخدم ملفات تعريف الارتباط لتحسين خدمتنا.',
    essentialOnly: 'الأساسية فقط',
    accept: 'قبول الكل',
    detail: 'معرفة المزيد →',
  },
};

const LANG_MAP: Record<string, string> = {
  kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'es', ar: 'ar',
};

export default function CookieBanner({ lang: langProp }: { lang?: string }) {
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const handleConsent = (type: 'all' | 'essential') => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ type, timestamp: Date.now() }));
      window.dispatchEvent(new Event('nf:consent-updated'));
    } catch {
      // 무시
    }
    setVisible(false);
  };

  if (!visible) return null;

  // 현재 언어 감지 (prop 우선, 없으면 pathname에서 파싱)
  const parts = pathname?.split('/').filter(Boolean) || [];
  const langCode = langProp || parts[0] || 'en';
  const lang = LANG_MAP[langCode] || 'en';
  const t = MESSAGES[lang] || MESSAGES.en;

  // 개인정보 링크 (언어별 경로)
  const privacyLink = `/${langCode}/privacy-policy/`;
  const isRtl = langCode === 'ar';

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#fff',
        borderTop: '1px solid #e5e7eb',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
        boxShadow: '0 -2px 16px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
        <span style={{ fontSize: '1.2rem' }}>🍪</span>
        <span style={{ color: '#374151', fontSize: '0.875rem', lineHeight: 1.5 }}>
          {t.text}{' '}
          <a
            href={privacyLink}
            style={{ color: '#0b5cff', textDecoration: 'underline', fontWeight: 600 }}
          >
            {t.detail}
          </a>
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={() => handleConsent('essential')}
          style={{
            padding: '7px 16px',
            borderRadius: '8px',
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#374151',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          {t.essentialOnly}
        </button>
        <button
          onClick={() => handleConsent('all')}
          style={{
            padding: '7px 16px',
            borderRadius: '8px',
            border: 'none',
            background: '#0b5cff',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 700,
          }}
        >
          {t.accept}
        </button>
      </div>
    </div>
  );
}
