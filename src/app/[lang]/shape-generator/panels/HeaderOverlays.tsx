'use client';

// A3 — Header overlays cluster.
//
// Bundles the three small chrome overlays that always render at the top of
// the workspace: drag-drop hint, import loading spinner, and the small-screen
// fullscreen prompt. Pulled out of ShapeGeneratorInner so the JSX
// monolith doesn't carry their wiring boilerplate.

import React from 'react';
import DragDropOverlay from '../DragDropOverlay';
import ImportLoadingOverlay from '../ImportLoadingOverlay';
import FullscreenPrompt from '../FullscreenPrompt';

interface LocalLabels {
  dropFileHere?: string;
  loadingFile?: string;
  smallScreenDetected?: string;
  smallScreenHint?: string;
  goFullscreen?: string;
  noThanks?: string;
}

interface HeaderOverlaysProps {
  isDragOver: boolean;
  isImporting: boolean;
  showFullscreenPrompt: boolean;
  /** Same signature as the hook: caller decides whether the dismiss came
   *  via the "Go Fullscreen" CTA (true) or the "× / No thanks" path (false). */
  dismissFullscreenPrompt: (goFullscreen: boolean) => void;
  lt: LocalLabels;
}

export default function HeaderOverlays({
  isDragOver,
  isImporting,
  showFullscreenPrompt,
  dismissFullscreenPrompt,
  lt,
}: HeaderOverlaysProps) {
  return (
    <>
      <DragDropOverlay isDragOver={isDragOver} dropFileHereText={lt.dropFileHere || 'Drop File Here'} />
      <ImportLoadingOverlay isImporting={isImporting} loadingFileText={lt.loadingFile || 'Loading...'} />
      <FullscreenPrompt
        show={showFullscreenPrompt}
        onDismiss={dismissFullscreenPrompt}
        texts={{
          title: lt.smallScreenDetected || 'Small Screen Detected',
          hint: lt.smallScreenHint || 'We recommend using fullscreen mode',
          goFullscreen: lt.goFullscreen || 'Go Fullscreen',
          dismiss: lt.noThanks || 'Dismiss',
        }}
      />
    </>
  );
}
