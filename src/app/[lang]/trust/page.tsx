import type { Metadata } from 'next';
import TrustClient from './TrustClient';
import { buildMetadata } from '@/lib/metaHelper';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'trust');
}

export default TrustClient;
