import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/metaHelper';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'home');
}

import HomeClient from './HomeClient';
import { homeDict } from './homeDict';
import { getAdminSettings } from '@/lib/adminSettings';

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const validLangs = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
  const langCode = validLangs.includes(lang) ? lang : 'en';
  const langMap: Record<string, keyof typeof homeDict> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
  const dict = homeDict[langMap[langCode]];
  // Read admin-configurable factory count so the social-proof headline reflects
  // the operator's verifiable claim rather than a hardcoded marketing number.
  // Defaults to a defensible understatement; admin raises as DB ingestion is
  // verified.
  const settings = getAdminSettings();
  const siteStats = {
    // Honest defaults: the real directory size (~286k listings), no 'verified'
    // qualifier (there are no verified partners). Admin can still override both.
    factoryCount: settings.landingFactoryCount ?? '286,000+',
    factoryQualifier: settings.landingFactoryCountQualifier ?? '',
  };

  return <HomeClient dict={dict} langCode={langCode} siteStats={siteStats} />;
}
