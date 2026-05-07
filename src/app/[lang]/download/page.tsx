import type { Metadata } from 'next';
import DownloadClient from './DownloadClient';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const isKr = lang === 'kr';

  const title = isKr
    ? 'NexyFab 데스크탑 다운로드'
    : 'Download NexyFab Desktop';
  const description = isKr
    ? '브라우저 없이 로컬에서 3D 설계, DFM 분석, RFQ 전송까지. NexyFab 데스크탑 앱을 무료로 다운로드하세요.'
    : 'Local 3D design, DFM analysis, and RFQ submission without a browser. Download NexyFab Desktop for free.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      locale: isKr ? 'ko_KR' : 'en_US',
      siteName: 'NexyFab',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function DownloadPage() {
  return <DownloadClient />;
}
