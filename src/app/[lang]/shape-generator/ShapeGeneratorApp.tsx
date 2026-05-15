'use client';

import './three-setup';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { ThemeProvider } from './ThemeContext';
import { WorkspaceLoading } from './WorkspaceLoading';
// Shell-v2 (Phase 1) — gated by `?shell=v2`. See plans/shimmering-singing-sun.md
import { ShellPreview } from './_shell';

const ShapeGeneratorInner = dynamic(
  () => import('./ShapeGeneratorInner').then((m) => ({ default: m.ShapeGeneratorInner })),
  { ssr: false, loading: () => <WorkspaceLoading variant="app" /> },
);

// Routes to either the legacy ShapeGeneratorInner monolith or the new shell-v2
// preview based on the `?shell=v2` query flag. useSearchParams must be inside
// the Suspense boundary on the parent.
function ShellGate() {
  const sp = useSearchParams();
  if (sp?.get('shell') === 'v2') {
    return <ShellPreview />;
  }
  return <ShapeGeneratorInner />;
}

export default function ShapeGeneratorApp() {
  return (
    <ThemeProvider>
      <Suspense fallback={<WorkspaceLoading variant="app" />}>
        <ShellGate />
      </Suspense>
    </ThemeProvider>
  );
}

