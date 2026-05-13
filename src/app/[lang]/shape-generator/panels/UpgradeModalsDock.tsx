'use client';

// Centralized mount point for the upgrade modal.
//
// History: ShapeGeneratorInner.tsx originally had 8 near-identical
// UpgradeModal JSX blocks, each driven by its own boolean state. We
// already collapsed those into one component that mapped 8 booleans
// to 8 mounted modal instances. **Item 2 of the usability cleanup**
// goes one further: a single `upgradeGateFeature` field in uiStore
// drives a single rendered modal. The 8 legacy booleans stay as
// back-compat aliases (their setters mirror to upgradeGateFeature),
// so every call site keeps working unchanged while this dock renders
// exactly one modal.
//
// Adding a new gate now means: add a string to the FreemiumFeature
// union and call `openUpgradeGate('new_feature')`. No new state, no
// new JSX, no new setter.

import React from 'react';
import dynamic from 'next/dynamic';
import { useUIStore } from '../store/uiStore';

const UpgradeModal = dynamic(() => import('@/components/nexyfab/UpgradeModal'), {
  ssr: false,
});

interface UpgradeModalsDockProps {
  lang: string;
}

export default function UpgradeModalsDock({ lang }: UpgradeModalsDockProps) {
  const feature = useUIStore(s => s.upgradeGateFeature);
  const closeGate = useUIStore(s => s.closeUpgradeGate);
  return (
    <UpgradeModal
      open={feature !== null}
      // When feature is null we still render the modal closed; the
      // `feature` prop is required even though it's invisible at that
      // moment. Pass a stable placeholder so React doesn't tear it down.
      feature={feature ?? 'cam_export'}
      lang={lang}
      onClose={closeGate}
    />
  );
}
