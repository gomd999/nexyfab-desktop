import type { Metadata } from 'next';
import HelpClient from './HelpClient';
import { buildMetadata } from '@/lib/metaHelper';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'help');
}

export default HelpClient;
