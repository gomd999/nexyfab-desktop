'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { WorkspaceLoading } from './WorkspaceLoading';
import type { WorkspaceExperienceMode } from './_shell/WorkspaceExperienceSwitcher';

const ShapeGeneratorApp = dynamic(() => import('./ShapeGeneratorApp'), {
  ssr: false,
  loading: () => <WorkspaceLoading variant="page" />,
});
// The AI-guided Studio is the default surface for every user. It can use the
// exact B-rep engine without exposing CAD complexity; the full modeler remains
// an optional direct-editing workspace for experts.
const StudioInner = dynamic(() => import('../studio/StudioInner'), { ssr: false });
const WorkspaceExperienceSwitcher = dynamic(
  () => import('./_shell/WorkspaceExperienceSwitcher').then(mod => mod.WorkspaceExperienceSwitcher),
  { ssr: false },
);

/** Shared entry for `/shape-generator` and focused sub-routes (sketch / 3d-edit / analysis). */
export default function ShapeGeneratorClientPage({ initialMode = 'expert' }: { initialMode?: 'studio' | 'expert' }) {
  // The whole tree is client-only (ssr:false dynamics), so reading window in a
  // lazy initialiser is safe and avoids useSearchParams' Suspense requirement.
  // Land in EXPERT (skip Studio) when a deep link clearly wants the CAD modeler:
  //   - ?mode=expert (Studio handoff)
  //   - a focused sub-route (…/shape-generator/sketch, /drawing, /analysis …)
  //   - ?project=… (opening an existing part)
  //   - ?entry=… that ISN'T the AI Studio (New Part / Assembly / Sketch cards)
  // The free-form Studio shows first only for the AI entry or a bare visit.
  const computeMode = (): 'studio' | 'expert' => {
    if (typeof window === 'undefined') return 'studio';
    const seg = (window.location.pathname.split('/shape-generator')[1] ?? '').replace(/^\/+/, '');
    const sp = new URLSearchParams(window.location.search);
    const entry = sp.get('entry');
    const wantExpert = seg.length > 0
      || sp.get('expert') === '1'
      || sp.get('expert') === 'true'
      || sp.get('mode') === 'expert'
      || !!sp.get('project')
      || (entry !== null && entry !== 'ai'); // entry=assembly/sketch/part → expert
    return wantExpert ? 'expert' : 'studio';
  };
  // The server entry already knows whether an expert route is being opened.
  // Using that same decision for the first client frame avoids rendering the
  // AI Studio and replacing the entire viewport after hydration (a large CLS).
  const [mode, setModeRaw] = useState<'studio' | 'expert'>(initialMode);
  // A user choosing Expert in-app (Studio's "Expert →") must stick; only a real
  // navigation (pathname change) re-derives the mode from the URL. usePathname
  // is reactive, so this fires even when Next reuses the page on a soft nav —
  // fixing "click Expert CAD but Studio still shows".
  const pathname = usePathname();
  const userPicked = useRef(false);
  useEffect(() => { userPicked.current = false; setModeRaw(computeMode()); }, [pathname]);
  const setMode = (m: WorkspaceExperienceMode) => { userPicked.current = true; setModeRaw(m); };
  const lang = pathname.split('/').filter(Boolean)[0] ?? 'en';

  if (mode === 'studio') {
    return (
      <>
        <StudioInner onExpert={() => setMode('expert')} />
        <WorkspaceExperienceSwitcher mode={mode} lang={lang} onChange={setMode} />
      </>
    );
  }
  return (
    <ShapeGeneratorApp />
  );
}
