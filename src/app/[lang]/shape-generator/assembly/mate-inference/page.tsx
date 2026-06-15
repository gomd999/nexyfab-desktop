'use client';

/**
 * /[lang]/shape-generator/assembly/mate-inference — dedicated review page
 * for the STEP-import mate inference pipeline.
 *
 * Mounts the advanced `MateInferenceReviewPanel` (table view) seeded from
 * one of the canned sample assemblies. Lets the user run the inference
 * pass, triage suggestions (accept / reject), and export the accepted set
 * as JSON.
 *
 * The actual UI lives in `_content.tsx` so jsdom tests can mount it with a
 * plain `lang` string instead of unwrapping the params promise via `use()`
 * (matches the sibling /assembly route pattern).
 */

import { use } from 'react';
import { MateInferenceReviewPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
}

export default function MateInferenceReviewPage({
  params,
}: PageProps): React.ReactElement {
  const { lang } = use(params);
  return <MateInferenceReviewPageContent lang={lang} />;
}
