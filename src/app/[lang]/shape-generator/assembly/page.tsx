import { redirect } from 'next/navigation';

/** Assembly/mates — opens design workspace + assembly panel. */
export default async function ShapeGeneratorAssemblyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/shape-generator?entry=assembly`);
}
