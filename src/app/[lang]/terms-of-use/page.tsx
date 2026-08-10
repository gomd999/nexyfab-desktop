'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  GLOBAL_TERMS_EFFECTIVE_DATE,
  GLOBAL_TERMS_VERSION,
  resolveGlobalTerms,
} from '@/content/globalTerms';
import { formatDate } from '@/lib/i18n/format';

const formatEffectiveDate = (date: string, locale: string): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return formatDate(parsed, locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }) ?? date;
};

export default function TermsOfUsePage() {
  const pathname = usePathname() || '/en/terms-of-use';
  const routeLocale = pathname.split('/').filter(Boolean)[0] || 'en';
  const { document, translationNotice } = resolveGlobalTerms(routeLocale);
  const isKorean = routeLocale === 'kr' || routeLocale === 'ko';

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#ffffff',
        color: '#1f2937',
        paddingBottom: '96px',
        fontFamily: 'Pretendard, Inter, system-ui, sans-serif',
      }}
    >
      <header
        style={{
          padding: '104px 20px 56px',
          background: 'linear-gradient(180deg, #f4f7ff 0%, #f8fafc 100%)',
          borderBottom: '1px solid #e5e7eb',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: '0 0 14px', color: '#0b5cff', fontSize: 13, fontWeight: 800, letterSpacing: '0.12em' }}>
          {document.kicker}
        </p>
        <h1 style={{ margin: '0 0 16px', color: '#111827', fontSize: 'clamp(32px, 5vw, 48px)', lineHeight: 1.15, fontWeight: 900 }}>
          {document.title}
        </h1>
        <p style={{ maxWidth: 820, margin: '0 auto', color: '#4b5563', fontSize: 16, lineHeight: 1.7 }}>
          {document.description}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 22 }}>
          <span style={{ padding: '7px 11px', borderRadius: 999, background: '#e8efff', color: '#1746a2', fontSize: 12, fontWeight: 700 }}>
            {document.versionLabel}: {GLOBAL_TERMS_VERSION}
          </span>
          <span style={{ padding: '7px 11px', borderRadius: 999, background: '#eef2f7', color: '#4b5563', fontSize: 12, fontWeight: 700 }}>
            {document.effectiveLabel}: {formatEffectiveDate(GLOBAL_TERMS_EFFECTIVE_DATE, routeLocale)}
          </span>
        </div>
      </header>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px 0' }}>
        {translationNotice && (
          <aside
            dir={routeLocale === 'ar' ? 'rtl' : 'ltr'}
            style={{
              marginBottom: 24,
              padding: '16px 18px',
              border: '1px solid #f5c26b',
              borderRadius: 12,
              background: '#fffbeb',
              color: '#7c4a03',
              fontSize: 14,
              lineHeight: 1.65,
            }}
          >
            {translationNotice}
          </aside>
        )}

        <section
          aria-labelledby="terms-summary"
          style={{
            marginBottom: 32,
            padding: '24px 26px',
            border: '1px solid #bfd1ff',
            borderRadius: 16,
            background: '#f5f8ff',
          }}
        >
          <h2 id="terms-summary" style={{ margin: '0 0 14px', color: '#153e91', fontSize: 20, fontWeight: 850 }}>
            {document.summaryTitle}
          </h2>
          <ul style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 9, lineHeight: 1.65 }}>
            {document.summary.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p style={{ margin: '16px 0 0', color: '#526581', fontSize: 12, lineHeight: 1.55 }}>
            {isKorean
              ? '이 요약은 이해를 돕기 위한 것이며, 아래 약관 본문이 적용됩니다.'
              : 'This summary is for convenience. The complete Terms below govern.'}
          </p>
        </section>

        <nav
          aria-label={isKorean ? '약관 목차' : 'Terms table of contents'}
          style={{ marginBottom: 40, padding: '22px 24px', border: '1px solid #e5e7eb', borderRadius: 14, background: '#fafafa' }}
        >
          <h2 style={{ margin: '0 0 14px', fontSize: 17, color: '#111827' }}>
            {isKorean ? '목차' : 'Contents'}
          </h2>
          <ol style={{ margin: 0, paddingLeft: 22, columns: '260px 2', columnGap: 36, lineHeight: 1.65 }}>
            {document.sections.map((section) => (
              <li key={section.id} style={{ breakInside: 'avoid', marginBottom: 5 }}>
                <a href={`#${section.id}`} style={{ color: '#315a9f', textDecoration: 'none', fontSize: 13 }}>
                  {section.title.replace(/^\d+\.\s*/, '')}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 38 }}>
          {document.sections.map((section) => (
            <section key={section.id} id={section.id} style={{ scrollMarginTop: 96 }}>
              <h2 style={{ margin: '0 0 14px', color: '#111827', fontSize: 22, lineHeight: 1.35, fontWeight: 850 }}>
                {section.title}
              </h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} style={{ margin: '0 0 11px', color: '#374151', fontSize: 15, lineHeight: 1.82 }}>
                  {paragraph}
                </p>
              ))}
              {section.bullets && (
                <ul style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 9, color: '#374151', fontSize: 15, lineHeight: 1.75 }}>
                  {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              )}
              {section.note && (
                <p style={{ margin: '14px 0 0', padding: '12px 14px', borderLeft: '3px solid #0b5cff', background: '#f6f8fb', color: '#4b5563', fontSize: 13, lineHeight: 1.65 }}>
                  {section.note}
                </p>
              )}
            </section>
          ))}
        </article>

        <aside
          style={{
            maxWidth: 860,
            margin: '48px auto 0',
            padding: '20px 22px',
            border: '1px solid #dbe3ef',
            borderRadius: 14,
            background: '#f8fafc',
            color: '#4b5563',
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          <strong style={{ color: '#1f2937' }}>{isKorean ? '관련 정책' : 'Related policies'}</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8 }}>
            <Link href={`/${routeLocale}/privacy-policy/`} style={{ color: '#0b5cff', fontWeight: 700 }}>
              {isKorean ? '개인정보 처리방침' : 'Privacy Policy'}
            </Link>
            <Link href={`/${routeLocale}/security-policy/`} style={{ color: '#0b5cff', fontWeight: 700 }}>
              {isKorean ? '보안 정책' : 'Security Policy'}
            </Link>
            <a href="mailto:nexyfab@nexysys.com" style={{ color: '#0b5cff', fontWeight: 700 }}>
              {isKorean ? '권리침해·법무·보안 신고' : 'IP, legal, or security notice'}
            </a>
          </div>
        </aside>
      </div>
    </main>
  );
}
