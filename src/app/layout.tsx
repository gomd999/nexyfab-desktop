import type { Metadata } from 'next';
import './globals.css';
import './custom.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import LangSetter from '@/components/LangSetter';
import { GoogleAnalytics } from '@next/third-parties/google';
import { getAdminSettings } from '@/lib/adminSettings';

const BASE_URL = 'https://nexyfab.com';

export async function generateMetadata(): Promise<Metadata> {
  const adminSettings = getAdminSettings();

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: 'Nexyfab | AI 3D Modeling & Manufacturing Partner Matching Platform',
      template: '%s | Nexyfab',
    },
    description: 'AI 3D modeling, instant quoting, and manufacturing partner matching — all in your browser. 300,000+ factory database.',
    keywords: [
      '3D modeling', 'AI manufacturing', 'manufacturing partner',
      'CAD online', 'instant quote', 'DFM analysis',
      '3D 모델링', 'AI 견적', '제조 파트너 매칭',
      '온라인 CAD', '제조 설계', 'DFM 분석',
      '3Dモデリング', 'AI見積もり', '製造マッチング',
      '3D建模', 'AI报价', '制造匹配',
    ],
    authors: [{ name: 'Nexyfab', url: BASE_URL }],
    creator: 'Nexyfab',
    publisher: 'Nexyfab',
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    alternates: {
      canonical: BASE_URL,
      languages: {
        'ko': `${BASE_URL}/kr`,
        'en': `${BASE_URL}/en`,
        'ja': `${BASE_URL}/ja`,
        'zh': `${BASE_URL}/cn`,
        'es': `${BASE_URL}/es`,
        'ar': `${BASE_URL}/ar`,
        'x-default': `${BASE_URL}/en`,
      },
    },
    openGraph: {
      type: 'website',
      url: BASE_URL,
      siteName: 'Nexyfab',
      title: 'Nexyfab | AI 3D Modeling & Manufacturing Matching',
      description: 'AI 3D modeling, instant quoting, and manufacturing partner matching — all in your browser. 300,000+ factory database.',
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: 'Nexyfab - AI 3D Modeling & Manufacturing Platform',
        },
      ],
      locale: 'en_US',
      alternateLocale: ['ko_KR', 'ja_JP', 'zh_CN'],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@nexyfab',
      creator: '@nexyfab',
      title: 'Nexyfab | AI 3D Modeling & Manufacturing Matching',
      description: 'AI 3D modeling, instant quoting, and manufacturing partner matching — all in your browser.',
      images: [`${BASE_URL}/og-image.png`],
    },
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
      ],
      shortcut: '/favicon.svg',
    },
    verification: {
      google: adminSettings.googleVerification || 'rrqY5TvvJIAFLzGYpTukJerEWSuINFNbSTJxBSFqDy0',
      other: {
        'msvalidate.01': adminSettings.bingVerification || '',
        'naver-site-verification': adminSettings.naverVerification || '',
      },
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
