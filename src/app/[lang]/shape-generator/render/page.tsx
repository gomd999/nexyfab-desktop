'use client';

// Render route (Phase 4). Standalone shell-v2 photoreal preview screen.
// Reads `?project=...` for context. Project ID becomes a route segment in Phase 6.

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';
import { ThemeProvider } from '../ThemeContext';
import { RenderFrame } from '../_shell/RenderFrame';

function RenderPageInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const sp = useSearchParams();
  const projectId = sp?.get('project') ?? undefined;
  return <RenderFrame lang={lang} isKo={isKorean(lang)} projectId={projectId} />;
}

export default function RenderPage({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <ThemeProvider>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0c0f14' }} />}>
        <RenderPageInner params={params} />
      </Suspense>
    </ThemeProvider>
  );
}
