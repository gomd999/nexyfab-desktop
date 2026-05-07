import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/metaHelper';
import SgBodyMode from './SgBodyMode';

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
      <SgBodyMode />
      {children}
    </>
  );
}
