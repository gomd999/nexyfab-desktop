'use client';

// O4 — Split-screen + STL export dock.
//
// Bundles three small modals: side-notes split, side-spec split, and the
// STL export options dialog. They're all triggered by toolbar/menu actions
// and have minimal local state.

import React from 'react';
import dynamic from 'next/dynamic';
import type { STLExportChoice } from '../io/STLExportDialog';

const SplitNotesPanel = dynamic(() => import('../split/SplitNotesPanel'), { ssr: false });
const SplitSpecPanel = dynamic(() => import('../split/SplitSpecPanel'), { ssr: false });
const STLExportDialog = dynamic(() => import('../io/STLExportDialog'), { ssr: false });

interface SplitExportDockProps {
  lang: string;
  splitMode: 'off' | 'side-notes' | 'side-spec';
  setSplitMode: (mode: 'off' | 'side-notes' | 'side-spec') => void;
  userId: string | null;

  stlExportDialogOpen: boolean;
  setStlExportDialogOpen: (v: boolean) => void;
  onExportSTL: (choice: STLExportChoice) => void;
}

export default function SplitExportDock({
  lang,
  splitMode, setSplitMode, userId,
  stlExportDialogOpen, setStlExportDialogOpen, onExportSTL,
}: SplitExportDockProps) {
  return (
    <>
      {splitMode === 'side-notes' && (
        <SplitNotesPanel
          userId={userId}
          lang={lang}
          onClose={() => setSplitMode('off')}
        />
      )}
      {splitMode === 'side-spec' && (
        <SplitSpecPanel
          lang={lang}
          onClose={() => setSplitMode('off')}
        />
      )}
      <STLExportDialog
        open={stlExportDialogOpen}
        lang={lang}
        onCancel={() => setStlExportDialogOpen(false)}
        onConfirm={(choice) => {
          setStlExportDialogOpen(false);
          onExportSTL(choice);
        }}
      />
    </>
  );
}
