import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/metaHelper';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'shape-generator');
}

export default function ShapeGeneratorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        body { overflow: hidden; height: 100dvh; display: flex; flex-direction: column; }
        body > header, body > footer, body > div[data-cookie-banner] { display: none; }
      `}</style>
      {children}
    </>
  );
}
