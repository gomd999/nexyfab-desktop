'use client';

// I3 — Help cluster (shortcut help dialog + alt-hold hint overlay +
// context-aware help panel). Three small surfaces that share the "user is
// learning the UI" theme; pulled out of ShapeGeneratorInner to keep the
// monolith trimmer.

import React from 'react';
import dynamic from 'next/dynamic';
import ShortcutHintOverlay from '../ShortcutHintOverlay';
import type { ContextKey } from '../onboarding/useContextHelp';

const ShortcutHelp = dynamic(() => import('../ShortcutHelp'), { ssr: false });
const ContextHelpPanel = dynamic(() => import('../onboarding/ContextHelpPanel'), {
  ssr: false,
  loading: () => null,
});

// Match the actual useContextHelp() shape — `dismissForever` takes a context
// arg, not the no-arg form. We adapt it here so the wrapper component can
// fire it with the current context implicitly.
interface ContextHelpState {
  visible: boolean;
  context: ContextKey;
  hide: () => void;
  dismissForever: (ctx: ContextKey) => void;
}

interface HelpClusterProps {
  lang: string;
  showShortcuts: boolean;
  setShowShortcuts: (v: boolean) => void;
  contextHelp: ContextHelpState;
  onOpenShortcuts: () => void;
}

const SHORTCUT_HINTS = [
  { targetId: 'btn-zoom-fit',     keys: 'F' },
  { targetId: 'btn-grid-toggle',  keys: 'G' },
  { targetId: 'btn-sketch-mode',  keys: 'S' },
  { targetId: 'btn-undo',         keys: 'Ctrl+Z' },
  { targetId: 'btn-redo',         keys: 'Ctrl+Y' },
];

export default function HelpCluster({
  lang, showShortcuts, setShowShortcuts, contextHelp, onOpenShortcuts,
}: HelpClusterProps) {
  return (
    <>
      <ShortcutHelp
        visible={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        lang={lang}
      />
      <ShortcutHintOverlay hints={SHORTCUT_HINTS} />
      <ContextHelpPanel
        visible={contextHelp.visible}
        context={contextHelp.context}
        lang={lang}
        onClose={contextHelp.hide}
        onDismissForever={() => contextHelp.dismissForever(contextHelp.context)}
        onOpenShortcuts={onOpenShortcuts}
      />
    </>
  );
}
