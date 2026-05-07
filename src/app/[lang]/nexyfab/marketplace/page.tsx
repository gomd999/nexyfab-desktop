import type { Metadata } from 'next';
import { isKorean } from '@/lib/i18n/normalize';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = isKorean(lang);
  return {
    title: isKo ? '제조사 마켓플레이스 | NexyFab' : 'Manufacturer Marketplace | NexyFab',
    description: isKo
      ? '검증된 글로벌 제조사를 탐색하고 견적을 요청하세요. 공정별·지역별·가격대별 필터로 최적의 제조 파트너를 찾아보세요.'
      : 'Browse verified global manufacturers and request quotes. Filter by process, region, and price level to find the perfect manufacturing partner.',
    openGraph: {
      title: isKo ? '제조사 마켓플레이스 | NexyFab' : 'Manufacturer Marketplace | NexyFab',
      description: isKo
        ? '검증된 글로벌 제조사를 탐색하고 견적을 요청하세요. 공정별·지역별·가격대별 필터로 최적의 제조 파트너를 찾아보세요.'
        : 'Browse verified global manufacturers and request quotes. Filter by process, region, and price level to find the perfect manufacturing partner.',
      type: 'website',
      locale: isKo ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? '제조사 마켓플레이스 | NexyFab' : 'Manufacturer Marketplace | NexyFab',
      description: isKo
        ? '검증된 글로벌 제조사를 탐색하고 견적을 요청하세요. 공정별·지역별·가격대별 필터로 최적의 제조 파트너를 찾아보세요.'
        : 'Browse verified global manufacturers and request quotes. Filter by process, region, and price level to find the perfect manufacturing partner.',
    },
  };
}

export { default } from './MarketplaceClient';
