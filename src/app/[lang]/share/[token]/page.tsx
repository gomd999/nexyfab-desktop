import { Metadata } from 'next';
import ShareViewer from './ShareViewer';

interface Props {
  params: Promise<{ lang: string; token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    title: 'NexyFab — 공유된 3D 모델',
    description: '설계자가 공유한 3D 모델을 확인하세요.',
    robots: { index: false, follow: false },
  };
}

export default async function SharePage({ params }: Props) {
  const { lang, token } = await params;
  return <ShareViewer token={token} lang={lang} />;
}
