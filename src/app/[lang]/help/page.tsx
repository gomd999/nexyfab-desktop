import type { Metadata } from 'next';
import HelpClient from './HelpClient';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = lang === 'ko' || lang === 'kr';
  return {
    title: isKo ? '사용 가이드 | NexyFab' : 'User Guide | NexyFab',
    description: isKo
      ? '첫 설계부터 견적·주문·리뷰까지. NexyFab 전체 흐름을 한눈에 안내합니다.'
      : 'From your first design to quote, order, and review — NexyFab end-to-end in one page.',
    openGraph: {
      title: isKo ? '사용 가이드 | NexyFab' : 'User Guide | NexyFab',
      description: isKo
        ? '첫 설계부터 견적·주문·리뷰까지'
        : 'First design to quote, order, review',
      type: 'website',
      locale: isKo ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
      images: [{
        url: `https://nexyfab.com/api/og?title=${encodeURIComponent(isKo ? '📖 사용 가이드' : '📖 User Guide')}&subtitle=${encodeURIComponent(isKo ? 'NexyFab 전체 흐름 한눈에' : 'NexyFab end-to-end')}`,
        width: 1200, height: 630,
      }],
    },
  };
}

export default HelpClient;
