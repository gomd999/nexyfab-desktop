'use client';

import './three-setup';

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { ThemeProvider } from './ThemeContext';
import { WorkspaceLoading } from './WorkspaceLoading';

const ShapeGeneratorInner = dynamic(
  () => import('./ShapeGeneratorInner').then((m) => ({ default: m.ShapeGeneratorInner })),
  { ssr: false, loading: () => <WorkspaceLoading variant="app" /> },
);

export default function ShapeGeneratorApp() {
  return (
    <ThemeProvider>
      <Suspense fallback={<WorkspaceLoading variant="app" />}>
        <ShapeGeneratorInner />
      </Suspense>
    </ThemeProvider>
  );
}

