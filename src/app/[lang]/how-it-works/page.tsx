import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const isKo = lang === 'ko';
  return {
    title: isKo ? '이용 방법 | NexyFab' : 'How It Works | NexyFab',
    description: isKo
      ? 'NexyFab의 제조 플랫폼 이용 방법을 알아보세요. 검색부터 납품까지 전 과정을 안내합니다.'
      : 'Learn how NexyFab works — from searching manufacturers to delivery, every step explained.',
    openGraph: {
      title: isKo ? '이용 방법 | NexyFab' : 'How It Works | NexyFab',
      description: isKo
        ? 'NexyFab의 제조 플랫폼 이용 방법을 알아보세요. 검색부터 납품까지 전 과정을 안내합니다.'
        : 'Learn how NexyFab works — from searching manufacturers to delivery, every step explained.',
      type: 'website',
      locale: lang === 'ko' ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title: isKo ? '이용 방법 | NexyFab' : 'How It Works | NexyFab',
      description: isKo
        ? 'NexyFab의 제조 플랫폼 이용 방법을 알아보세요. 검색부터 납품까지 전 과정을 안내합니다.'
        : 'Learn how NexyFab works — from searching manufacturers to delivery, every step explained.',
    },
  };
}

export { default } from './HowItWorksClient';
