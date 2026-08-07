'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { WorkspaceLoading } from './WorkspaceLoading';

const ShapeGeneratorApp = dynamic(() => import('./ShapeGeneratorApp'), {
  ssr: false,
  loading: () => <WorkspaceLoading variant="page" />,
});
// The free-form Studio is the DEFAULT face — the wide funnel. The heavy B-rep
// modeler is the expert mode you graduate into.
const StudioInner = dynamic(() => import('../studio/StudioInner'), { ssr: false });

/** Shared entry for `/shape-generator` and focused sub-routes (sketch / 3d-edit / analysis). */
export default function ShapeGeneratorClientPage() {
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
  // Keep the server and first client render identical; derive URL mode after
  // mount to avoid a hydration mismatch on expert deep links.
  const [mode, setModeRaw] = useState<'studio' | 'expert'>('studio');
  // A user choosing Expert in-app (Studio's "Expert →") must stick; only a real
  // navigation (pathname change) re-derives the mode from the URL. usePathname
  // is reactive, so this fires even when Next reuses the page on a soft nav —
  // fixing "click Expert CAD but Studio still shows".
  const pathname = usePathname();
  const userPicked = useRef(false);
  useEffect(() => { userPicked.current = false; setModeRaw(computeMode()); }, [pathname]);
  const setMode = (m: 'studio' | 'expert') => { userPicked.current = true; setModeRaw(m); };

  if (mode === 'studio') {
    return <StudioInner onExpert={() => setMode('expert')} />;
  }
  return (
    <>
      <ShapeGeneratorApp />
      <button
        type="button"
        onClick={() => setMode('studio')}
        title="자유형 Studio로 돌아가기 / Back to Studio"
        style={{
          position: 'fixed', bottom: 14, left: 14, zIndex: 9998,
          background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff',
          border: 'none', borderRadius: 14, padding: '8px 14px',
          fontSize: 12, fontWeight: 800, cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(16,185,129,0.35)',
        }}
      >
        ✨ Studio
      </button>
    </>
  );
}
