'use client';

import { useEffect, useState } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';

const STORAGE_KEY = 'nf_cookie_consent';

interface Props {
  googleAnalyticsId?: string;
  fbPixelId?: string;
}

export default function ConsentScripts({ googleAnalyticsId, fbPixelId }: Props) {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const checkConsent = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored) as { type?: string };
        setConsented(parsed.type === 'all');
      } catch {
        // ignore
      }
    };

    checkConsent();

    // Re-check when localStorage changes (other tabs or CookieBanner accept)
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) checkConsent();
    };
    window.addEventListener('storage', onStorage);

    // Also listen for consent updates within this tab
    const onConsent = () => checkConsent();
    window.addEventListener('nf:consent-updated', onConsent);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('nf:consent-updated', onConsent);
    };
  }, []);

  if (!consented) return null;

  return (
    <>
      {googleAnalyticsId && <GoogleAnalytics gaId={googleAnalyticsId} />}
      {fbPixelId && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${fbPixelId}');
fbq('track', 'PageView');
`,
          }}
        />
      )}
    </>
  );
}
