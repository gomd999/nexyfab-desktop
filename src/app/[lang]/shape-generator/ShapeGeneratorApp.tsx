'use client';

import './three-setup';

import React, { Suspense } from 'react';
import { ThemeProvider } from './ThemeContext';
import { ShapeGeneratorInner } from './ShapeGeneratorInner';
import { WorkspaceLoading } from './WorkspaceLoading';

export default function ShapeGeneratorApp() {
  return (
    <ThemeProvider>
      <Suspense fallback={<WorkspaceLoading variant="app" />}>
        <ShapeGeneratorInner />
      </Suspense>
    </ThemeProvider>
  );
}

