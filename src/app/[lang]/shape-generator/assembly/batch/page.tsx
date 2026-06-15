'use client';

/**
 * /[lang]/shape-generator/assembly/batch — solver batch driver dev/debug
 * route (Phase 3.3.UI for the multi-assembly solveBatch panel).
 *
 * Thin Next.js wrapper that unwraps the params Promise and hands the
 * `lang` string to SolverBatchPageContent. The actual UI lives in
 * `_content.tsx` so tests can mount it with a plain `lang` prop.
 */

import { use } from 'react';
import { SolverBatchPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
}

export default function SolverBatchPage({
  params,
}: PageProps): React.ReactElement {
  const { lang } = use(params);
  return <SolverBatchPageContent lang={lang} />;
}
