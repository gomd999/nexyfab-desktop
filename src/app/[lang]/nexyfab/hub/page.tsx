'use client';

// Hub route (Phase 2.1) — dedicated start screen at /[lang]/nexyfab/hub.
// Separated from the operational dashboard at /[lang]/nexyfab/dashboard,
// which keeps RFQ / Orders / Teams / Files management.

import { Suspense, use, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';
import AuthModal from '@/components/nexyfab/AuthModal';
import { HubFrame } from '@/app/[lang]/shape-generator/_shell';

function HubInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const [showAuth, setShowAuth] = useState(false);
  return (
    <>
      <HubFrame lang={lang} isKo={isKorean(lang)} onShowAuth={() => setShowAuth(true)} />
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} lang={lang} />
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
