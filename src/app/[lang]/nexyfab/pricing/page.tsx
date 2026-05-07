import type { Metadata } from 'next';
import { isKorean } from '@/lib/i18n/normalize';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = isKorean(lang);
  return {
    title: isKo ? '요금제 | NexyFab' : 'Pricing | NexyFab',
    description: isKo
      ? 'NexyFab 요금제를 확인하세요. Free, Pro, Team 플랜으로 브라우저 기반 3D 설계 및 AI 제조 분석을 시작해보세요.'
      : 'Explore NexyFab pricing plans. Start free with browser-based 3D design and AI manufacturing analysis, upgrade when ready.',
    openGraph: {
      title: isKo ? '요금제 | NexyFab' : 'Pricing | NexyFab',
      description: isKo
        ? 'NexyFab 요금제를 확인하세요. Free, Pro, Team 플랜으로 브라우저 기반 3D 설계 및 AI 제조 분석을 시작해보세요.'
        : 'Explore NexyFab pricing plans. Start free with browser-based 3D design and AI manufacturing analysis, upgrade when ready.',
      type: 'website',
      locale: isKo ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? '요금제 | NexyFab' : 'Pricing | NexyFab',
      description: isKo
        ? 'NexyFab 요금제를 확인하세요. Free, Pro, Team 플랜으로 브라우저 기반 3D 설계 및 AI 제조 분석을 시작해보세요.'
        : 'Explore NexyFab pricing plans. Start free with browser-based 3D design and AI manufacturing analysis, upgrade when ready.',
    },
  };
}

export { default } from './NexyfabPricingClient';
