'use client';

// Hub route (Phase 2.1) — dedicated start screen at /[lang]/nexyfab/hub.
// Separated from the operational dashboard at /[lang]/nexyfab/dashboard,
// which keeps RFQ / Orders / Teams / Files management.

import { Suspense, use, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AuthModal from '@/components/nexyfab/AuthModal';
import { HubFrame } from '@/app/[lang]/shape-generator/_shell';
import { useAuthStore } from '@/hooks/useAuth';

function HubInner({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const router = useRouter();
  const [showAuth, setShowAuth] = useState(false);

  // Studio-first funnel: a guest's FIRST landing on the Hub goes straight to
  // the free-form Studio (instant "describe → 3D" magic; their Hub is empty
  // anyway). A session flag means if they navigate back to the Hub on purpose
  // it stays put (no loop, Hub still reachable). Logged-in users keep the Hub.
  const decided = useRef(false);
  useEffect(() => {
    const decide = () => {
      if (decided.current) return;
      decided.current = true;
      if (useAuthStore.getState().user) return; // logged in → Hub
      try {
        if (sessionStorage.getItem('nexyfab:hub-visited')) return; // returning → stay
        sessionStorage.setItem('nexyfab:hub-visited', '1');
      } catch { /* ignore */ }
      router.replace(`/${lang}/studio`);
    };
    if (useAuthStore.persist.hasHydrated()) { decide(); return; }
    return useAuthStore.persist.onFinishHydration(decide);
  }, [lang, router]);

  return (
    <>
      <HubFrame lang={lang} onShowAuth={() => setShowAuth(true)} />
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
