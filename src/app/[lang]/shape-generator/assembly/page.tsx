'use client';

/**
 * /[lang]/shape-generator/assembly — standalone Assembly Browser route
 * (Phase 3.A first user-facing assembly UI for NexyFab Pro own-CAD).
 *
 * Previously this route was a redirect into the shape-generator workspace
 * with `?entry=assembly`. Phase 3.A replaces it with a dedicated browser
 * that mounts AssemblyBrowserModal directly so users can author parts
 * and mates and POST to /api/assembly-solve without a host editor.
 *
 * The actual UI lives in `_content.tsx` so tests can mount it with a plain
 * `lang` string instead of unwrapping the params promise via `use()`.
 */

import { use } from 'react';
import { AssemblyBrowserPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ aiRevision?: string | string[] }>;
}

export default function AssemblyBrowserPage({ params, searchParams }: PageProps): React.ReactElement {
  const { lang } = use(params);
  const query = use(searchParams);
  const aiRevisionId = typeof query.aiRevision === 'string' ? query.aiRevision : undefined;
  return <AssemblyBrowserPageContent lang={lang} aiRevisionId={aiRevisionId} />;
}
