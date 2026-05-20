'use client';

// Adds `body.nf-app-mode` while any NexyFab SaaS surface (/nexyfab/*) is
// mounted. globals.css uses that class to hide the customer-landing
// <Header> / <Footer> that [lang]/layout.tsx renders for every route —
// the SaaS surface owns its own chrome (NexyfabUnifiedSidebar + page
// footer) so the public marketing nav must not leak into it.

import { useEffect } from 'react';

export default function NfBodyMode() {
  useEffect(() => {
    document.body.classList.add('nf-app-mode');
    return () => { document.body.classList.remove('nf-app-mode'); };
  }, []);
  return null;
}
