'use client';

// Hub route (Phase 2.1) — dedicated start screen at /[lang]/nexyfab/hub.
// Separated from the operational dashboard at /[lang]/nexyfab/dashboard,
// which keeps RFQ / Orders / Teams / Files management.

import { Suspense, use, useState } from 'react';
import dynamic from 'next/dynamic';
// Import the leaf module directly. The shell barrel also re-exports the full
// modeler/drawing/render workspaces, which made the lightweight hub inherit
// their client module graph in production builds.
import { HubFrame } from '@/app/[lang]/shape-generator/_shell/HubFrame';

const AuthModal = dynamic(() => import('@/components/nexyfab/AuthModal'), {
  ssr: false,
});

function HubInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const [showAuth, setShowAuth] = useState(false);

  // Hub-first: entering the 3D Modeler lands on the Hub (which offers 자유형
  // Studio / 전문가형 CAD / 종이·레이저컷 / projects). The old "Studio-first"
  // auto-redirect was removed — the Hub is the clear single entry point.

  return (
    <>
      <HubFrame lang={lang} onShowAuth={() => setShowAuth(true)} />
      {showAuth ? (
        <AuthModal open onClose={() => setShowAuth(false)} lang={lang} />
      ) : null}
    </>
  );
}

export default function NexyfabHub({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0c0f14' }} />}>
      <HubInner params={params} />
    </Suspense>
  );
}
