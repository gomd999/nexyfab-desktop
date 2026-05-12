'use client';

import Link from 'next/link';

/**
 * Site-wide notice when `NEXT_PUBLIC_PAID_BETA=1` at build time.
 * Korean copy for `kr`; other `[lang]` routes use English for the banner.
 */
export function PaidBetaBanner({ lang }: { lang: string }) {
  if (process.env.NEXT_PUBLIC_PAID_BETA !== '1') return null;

  const isKo = lang === 'kr';
  const contactHref = `/${lang}/contact`;
  const refundHref = `/${lang}/refund-policy`;

  return (
    <div
      role="region"
      aria-label="Paid beta notice"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        fontSize: 13,
        lineHeight: 1.55,
        borderBottom: '1px solid rgba(56,139,253,0.35)',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(90deg, #0d1f3c 0%, #132a4a 50%, #0d1f3c 100%)',
          color: '#e6edf3',
          padding: '10px 16px',
          textAlign: 'center',
        }}
      >
        {isKo ? (
          <>
            현재 NexyFab은 <strong style={{ color: '#79c0ff' }}>유료 베타</strong> 단계입니다. 서비스 안정화 과정에서 일부 기능이 제한될 수
            있으며, 모든 피드백은{' '}
            <Link href={contactHref} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>
              공식 지원 채널
            </Link>
            을 통해 우선 처리됩니다.
          </>
        ) : (
          <>
            NexyFab is in a <strong style={{ color: '#79c0ff' }}>paid beta</strong>. Some features may be limited while we stabilize the service;
            feedback is prioritized through{' '}
            <Link href={contactHref} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'underline' }}>
              official support
            </Link>
            .
          </>
        )}
      </div>
      <div
        style={{
          background: '#161b22',
          color: '#8b949e',
          padding: '8px 16px',
          textAlign: 'center',
          fontSize: 12,
        }}
      >
        {isKo ? (
          <>
            베타 기간 중 대량 주문 시 관리자 확인 절차가 추가될 수 있습니다. 급한 용건은{' '}
            <Link href={contactHref} prefetch={false} style={{ color: '#58a6ff', fontWeight: 600 }}>
              지원 티켓(문의)
            </Link>
            을 이용해 주세요. ·{' '}
            <Link href={refundHref} prefetch={false} style={{ color: '#8b949e', textDecoration: 'underline' }}>
              환불 안내
            </Link>
          </>
        ) : (
          <>
            Large orders may require extra admin verification during beta. For urgent issues, use the{' '}
            <Link href={contactHref} prefetch={false} style={{ color: '#58a6ff', fontWeight: 600 }}>
              support ticket
            </Link>
            {' form. · '}
            <Link href={refundHref} prefetch={false} style={{ color: '#8b949e', textDecoration: 'underline' }}>
              Refund policy
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
