import type { Metadata } from 'next';
import StudioInner from './StudioInner';
import catalogJson from '@/lib/i18n/studioTranslations.generated.json';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export const metadata: Metadata = {
  title: 'NexyFab Studio — text/image → 3D',
  description: 'Describe or photograph a part and get a parametric 3D model you can tune with sliders, export as STL, or refine in the expert CAD modeler.',
};

export default async function StudioPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = toIsoLang(lang);
  const translations = locale === 'ko' || locale === 'en'
    ? undefined
    : Object.fromEntries(Object.entries(catalogJson).map(([english, values]) => [
        english,
        (values as Record<Exclude<IsoLang, 'ko' | 'en'>, string>)[locale],
      ]));
  return <StudioInner routeLang={lang} translations={translations} />;
}
