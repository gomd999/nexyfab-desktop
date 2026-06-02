'use client';

/**
 * /[lang]/shape-generator/assembly/benchmark — solver benchmark dev/debug
 * route (Phase 3.2.3.UI for the assembly solver comparison harness).
 *
 * Thin Next.js wrapper that unwraps the params Promise and hands the
 * `lang` string to SolverBenchmarkPageContent. The actual UI lives in
 * `_content.tsx` so tests can mount it with a plain `lang` prop.
 */

import { use } from 'react';
import { SolverBenchmarkPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
}

export default function SolverBenchmarkPage({
  params,
}: PageProps): React.ReactElement {
  const { lang } = use(params);
  return <SolverBenchmarkPageContent lang={lang} />;
}
