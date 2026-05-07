import { redirect } from 'next/navigation';

/**
 * Bookmark-friendly entry: same app as /shape-generator with sketch-first UX.
 */
export default async function ShapeGeneratorSketchPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/shape-generator?entry=sketch`);
}
