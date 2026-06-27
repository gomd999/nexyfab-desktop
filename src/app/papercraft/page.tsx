import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * Bare `/papercraft` (no locale) is otherwise swallowed by the `[lang]` segment
 * (read as a language code → marketing landing). This static route wins over the
 * dynamic one and forwards to the locale-prefixed papercraft tool, so the URL
 * users naturally type / share just works.
 */
const SUPPORTED = ['ko', 'en', 'ja', 'zh', 'es', 'ar'];

export default async function PapercraftRedirect() {
  const cookieLang = (await cookies()).get('NEXT_LOCALE')?.value;
  let lang = cookieLang && SUPPORTED.includes(cookieLang) ? cookieLang : '';
  if (!lang) {
    const al = (await headers()).get('accept-language') ?? '';
    const first = al.split(',')[0]?.split('-')[0]?.toLowerCase() ?? '';
    lang = SUPPORTED.includes(first) ? first : 'en';
  }
  redirect(`/${lang}/papercraft`);
}
