import type { Metadata } from 'next';
import { isKorean } from '@/lib/i18n/normalize';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = isKorean(lang);
  return {
    title: isKo ? 'AI 기반 제조 플랫폼 | NexyFab' : 'AI-Powered Manufacturing Platform | NexyFab',
    description: isKo
      ? '브라우저에서 3D 설계, AI DFM 분석, 제조사 연결까지 하나의 플랫폼으로 처리하세요.'
      : 'Design 3D parts in the browser, get AI DFM analysis, and connect with manufacturers — all in one platform.',
    openGraph: {
      title: isKo ? 'AI 기반 제조 플랫폼 | NexyFab' : 'AI-Powered Manufacturing Platform | NexyFab',
      description: isKo
        ? '브라우저에서 3D 설계, AI DFM 분석, 제조사 연결까지 하나의 플랫폼으로 처리하세요.'
        : 'Design 3D parts in the browser, get AI DFM analysis, and connect with manufacturers — all in one platform.',
      type: 'website',
      locale: isKo ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? 'AI 기반 제조 플랫폼 | NexyFab' : 'AI-Powered Manufacturing Platform | NexyFab',
      description: isKo
        ? '브라우저에서 3D 설계, AI DFM 분석, 제조사 연결까지 하나의 플랫폼으로 처리하세요.'
        : 'Design 3D parts in the browser, get AI DFM analysis, and connect with manufacturers — all in one platform.',
    },
  };
}

import HomeClient from './HomeClient';
import { homeDict } from './homeDict';

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const validLangs = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
  const langCode = validLangs.includes(lang) ? lang : 'en';
  const langMap: Record<string, keyof typeof homeDict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
  const dict = homeDict[langMap[langCode]];

  return <HomeClient dict={dict as any} langCode={langCode} />;
}
