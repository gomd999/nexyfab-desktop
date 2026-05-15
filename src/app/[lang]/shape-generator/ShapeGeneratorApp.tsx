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

// The 3D modeler is always the real ShapeGeneratorInner. The shell-v2 chrome
// preview is kept behind `?dev-shell=v2` (NOT `?shell=v2`) so it's only
// reachable by direct dev links — accidental users land on the real modeler.
// Phase 6 will wire ShapeGeneratorInner into <Shell> for real; until then,
// ShellPreview is mock data and should not be promoted.
function ShellGate() {
  const sp = useSearchParams();
  if (sp?.get('dev-shell') === 'v2') {
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

