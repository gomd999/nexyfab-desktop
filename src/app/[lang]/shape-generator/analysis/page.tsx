import { redirect } from 'next/navigation';

/** Simulation / FEA-focused workspace (see CadWorkspaceId `simulation`). */
export default async function ShapeGeneratorAnalysisPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/shape-generator?entry=analysis`);
}
