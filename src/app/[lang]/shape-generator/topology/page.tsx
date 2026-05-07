import { redirect } from 'next/navigation';

/** Generative / topology optimization workspace. */
export default async function ShapeGeneratorTopologyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/shape-generator?entry=topology`);
}
