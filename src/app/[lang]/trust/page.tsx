import type { Metadata } from 'next';
import TrustClient from './TrustClient';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = lang === 'ko';
  return {
    title: isKo ? '신뢰성 | NexyFab' : 'Trust & Reliability | NexyFab',
    description: isKo
      ? 'NexyFab의 기술적 신뢰성 — 테스트 통과율, OCCT 정밀도 검증, 표준 규격 출처를 공개합니다.'
      : 'NexyFab technical reliability — test pass rates, OCCT precision burn-in, standards library citations.',
    openGraph: {
      title: isKo ? '신뢰성 | NexyFab' : 'Trust & Reliability | NexyFab',
      description: isKo
        ? '테스트 통과율, OCCT 정밀도 검증, 표준 출처 공개'
        : 'Test pass rates, OCCT precision burn-in, standards citations.',
      type: 'website',
      locale: lang === 'ko' ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
      images: [{
        url: `https://nexyfab.com/api/og?title=${encodeURIComponent(isKo ? '🔬 기술 신뢰성' : '🔬 Trust & Reliability')}&subtitle=${encodeURIComponent(isKo ? '주장 대신 숫자' : 'Numbers, not claims')}`,
        width: 1200, height: 630,
      }],
    },
  };
}

export default TrustClient;
