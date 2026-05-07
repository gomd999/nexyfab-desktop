import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = lang === 'ko';
  return {
    title: isKo ? '제조사 검색 | NexyFab' : 'Find Manufacturers | NexyFab',
    description: isKo
      ? '검증된 한국·중국 제조사를 검색하고 비교하세요. 공정별, 지역별, 인증별 필터로 최적의 파트너를 찾아보세요.'
      : 'Search and compare verified Korean and Chinese manufacturers. Filter by process, region, and certification to find the right partner.',
    openGraph: {
      title: isKo ? '제조사 검색 | NexyFab' : 'Find Manufacturers | NexyFab',
      description: isKo
        ? '검증된 한국·중국 제조사를 검색하고 비교하세요. 공정별, 지역별, 인증별 필터로 최적의 파트너를 찾아보세요.'
        : 'Search and compare verified Korean and Chinese manufacturers. Filter by process, region, and certification to find the right partner.',
      type: 'website',
      locale: lang === 'ko' ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? '제조사 검색 | NexyFab' : 'Find Manufacturers | NexyFab',
      description: isKo
        ? '검증된 한국·중국 제조사를 검색하고 비교하세요. 공정별, 지역별, 인증별 필터로 최적의 파트너를 찾아보세요.'
        : 'Search and compare verified Korean and Chinese manufacturers. Filter by process, region, and certification to find the right partner.',
    },
  };
}

export { default } from '@/app/factories/page';
