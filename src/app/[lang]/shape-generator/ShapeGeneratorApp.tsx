'use client';

import './three-setup';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { ThemeProvider } from './ThemeContext';
import { WorkspaceLoading } from './WorkspaceLoading';
// Shell-v2 chrome wraps ShapeGeneratorInner by default. Inner's legacy
// top toolbar + StatusBar are hidden via globals.css `body.sg-shell-v2`.
import { ModelerShell, ShellPreview } from './_shell';

const ShapeGeneratorInner = dynamic(
  () => import('./ShapeGeneratorInner').then((m) => ({ default: m.ShapeGeneratorInner })),
  { ssr: false, loading: () => <WorkspaceLoading variant="app" /> },
);

// Default → ModelerShell (new chrome around the real Inner).
// `?classic=1`     → bare ShapeGeneratorInner (legacy entry, link-only).
// `?dev-shell=v2`  → ShellPreview with mock data (dev visual sandbox).
export function isDevShellAllowed(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'production';
}

function ShellGate() {
  const sp = useSearchParams();
  if (sp?.get('classic') === '1') return <ShapeGeneratorInner />;
  if (isDevShellAllowed(process.env.NODE_ENV) && sp?.get('dev-shell') === 'v2') return <ShellPreview />;
  return <ModelerShell />;
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

