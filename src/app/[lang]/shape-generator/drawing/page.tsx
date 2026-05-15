'use client';

// Drawing route (Phase 3). Standalone shell-v2 drafting view.
// Reads `?project=...` for context. Project ID becomes a route segment in Phase 6.

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';
import { ThemeProvider } from '../ThemeContext';
import { DrawingFrame } from '../_shell/DrawingFrame';

function DrawingPageInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const sp = useSearchParams();
  const projectId = sp?.get('project') ?? undefined;
  return <DrawingFrame lang={lang} isKo={isKorean(lang)} projectId={projectId} />;
}

export default function DrawingPage({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <ThemeProvider>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0c0f14' }} />}>
        <DrawingPageInner params={params} />
      </Suspense>
    </ThemeProvider>
  );
}
