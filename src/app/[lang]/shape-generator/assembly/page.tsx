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
import dynamic from 'next/dynamic';

const AssemblyBrowserPageContent = dynamic(
  () => import('./_content').then(mod => mod.AssemblyBrowserPageContent),
  {
    ssr: false,
    loading: () => (
      <main aria-busy="true" aria-live="polite" style={{ padding: 24 }}>
        Loading assembly workspace…
      </main>
    ),
  },
);

interface PageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    aiRevision?: string | string[];
    project?: string | string[];
    revision?: string | string[];
    revisionHash?: string | string[];
  }>;
}

export default function AssemblyBrowserPage({ params, searchParams }: PageProps): React.ReactElement {
  const { lang } = use(params);
  const query = use(searchParams);
  const aiRevisionId = typeof query.aiRevision === 'string' ? query.aiRevision : undefined;
  const projectId = typeof query.project === 'string' ? query.project : undefined;
  const rawRevision = typeof query.revision === 'string' ? Number(query.revision) : Number.NaN;
  const projectRevision = Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : undefined;
  const projectRevisionHash = typeof query.revisionHash === 'string' && /^[a-f0-9]{64}$/.test(query.revisionHash)
    ? query.revisionHash
    : undefined;
  return (
    <AssemblyBrowserPageContent
      lang={lang}
      aiRevisionId={aiRevisionId}
      projectId={projectId}
      projectRevision={projectRevision}
      projectRevisionHash={projectRevisionHash}
    />
  );
}
