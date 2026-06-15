import type { Metadata } from 'next';
import { isKorean } from '@/lib/i18n/normalize';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = isKorean(lang);
  return {
    title: isKo ? '제조사 검색 | NexyFab' : 'Find Manufacturers | NexyFab',
    description: isKo
      ? '한국·중국 공장 디렉터리를 검색하고 비교하세요. 공정별·지역별 필터로 후보를 좁혀보세요.'
      : 'Search and compare our Korea-China factory directory. Filter by process and region to shortlist candidates.',
    openGraph: {
      title: isKo ? '제조사 검색 | NexyFab' : 'Find Manufacturers | NexyFab',
      description: isKo
        ? '한국·중국 공장 디렉터리를 검색하고 비교하세요. 공정별·지역별 필터로 후보를 좁혀보세요.'
        : 'Search and compare our Korea-China factory directory. Filter by process and region to shortlist candidates.',
      type: 'website',
      locale: isKo ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? '제조사 검색 | NexyFab' : 'Find Manufacturers | NexyFab',
      description: isKo
        ? '한국·중국 공장 디렉터리를 검색하고 비교하세요. 공정별·지역별 필터로 후보를 좁혀보세요.'
        : 'Search and compare our Korea-China factory directory. Filter by process and region to shortlist candidates.',
    },
  };
}

export { default } from '@/app/factories/page';
