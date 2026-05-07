import type { Metadata } from 'next';
import Link from 'next/link';
import notices from '@/content/third-party-notices.json';

const TITLES: Record<string, string> = {
  kr: '오픈소스 및 제3자 구성요소',
  ko: '오픈소스 및 제3자 구성요소',
  en: 'Open-source & third-party notices',
  ja: 'オープンソースおよびサードパーティ',
  cn: '开源与第三方组件',
  es: 'Código abierto y avisos de terceros',
  ar: 'البرمجيات مفتوحة المصدر والطرف الثالث',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const title = TITLES[lang] ?? TITLES.en;
  return { title: `${title} · NexyFab`, robots: { index: true, follow: true } };
}

export default async function ThirdPartyNoticesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const title = TITLES[lang] ?? TITLES.en;
  const pkgs = notices.packages as { name: string; license: string; url: string }[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-gray-100">
      <h1 className="text-2xl font-semibold text-white mb-2">{title}</h1>
      <p className="text-sm text-gray-400 mb-8">{notices.notice}</p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-700 text-left text-gray-400">
            <th className="py-2 pr-4">Component</th>
            <th className="py-2 pr-4">License</th>
            <th className="py-2">Link</th>
          </tr>
        </thead>
        <tbody>
          {pkgs.map((p) => (
            <tr key={p.name} className="border-b border-gray-800">
              <td className="py-2 pr-4 align-top">{p.name}</td>
              <td className="py-2 pr-4 align-top text-gray-300">{p.license}</td>
              <td className="py-2 align-top">
                <a href={p.url} className="text-blue-400 hover:underline break-all" target="_blank" rel="noopener noreferrer">
                  {p.url}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-10 text-sm text-gray-500">
        <Link href={`/${lang}/`} className="text-blue-400 hover:underline">
          ← Home
        </Link>
      </p>
    </main>
  );
}
