import type { Metadata } from 'next';
import { isKorean } from '@/lib/i18n/normalize';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = isKorean(lang);
  return {
    title: isKo ? '3D 설계 & 제조 주문 | NexyFab' : '3D Design & Manufacturing | NexyFab',
    description: isKo
      ? '브라우저에서 3D 설계 후 AI DFM 분석, 비용 추정, 제조사 연결까지. NexyFab으로 제조 워크플로우 전체를 한 곳에서 관리하세요.'
      : 'Design 3D parts in the browser, get AI DFM analysis, cost estimation, and manufacturer connections. Manage your entire manufacturing workflow in one place.',
    openGraph: {
      title: isKo ? '3D 설계 & 제조 주문 | NexyFab' : '3D Design & Manufacturing | NexyFab',
      description: isKo
        ? '브라우저에서 3D 설계 후 AI DFM 분석, 비용 추정, 제조사 연결까지. NexyFab으로 제조 워크플로우 전체를 한 곳에서 관리하세요.'
        : 'Design 3D parts in the browser, get AI DFM analysis, cost estimation, and manufacturer connections. Manage your entire manufacturing workflow in one place.',
      type: 'website',
      locale: isKo ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? '3D 설계 & 제조 주문 | NexyFab' : '3D Design & Manufacturing | NexyFab',
      description: isKo
        ? '브라우저에서 3D 설계 후 AI DFM 분석, 비용 추정, 제조사 연결까지. NexyFab으로 제조 워크플로우 전체를 한 곳에서 관리하세요.'
        : 'Design 3D parts in the browser, get AI DFM analysis, cost estimation, and manufacturer connections. Manage your entire manufacturing workflow in one place.',
    },
  };
}

export { default } from './NexyfabLandingClient';
