'use client';

// API docs viewer — Scalar (apireference) reads /api/docs/openapi at
// runtime. Hosted client-side so we don't bundle the heavy renderer into
// the marketing site's first-paint critical path.

import { useEffect, useRef } from 'react';

export default function ApiDocsPage() {
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    // Inject Scalar's standalone bundle. Configured in data-* attributes
    // on the host script tag. Standalone build = no npm dependency.
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest';
    s.async = true;
    s.dataset.url = '/api/docs/openapi';
    s.id = 'api-reference';
    s.setAttribute(
      'data-configuration',
      JSON.stringify({
        theme: 'kepler',
        layout: 'modern',
        showSidebar: true,
        hideClientButton: false,
      }),
    );
    document.body.appendChild(s);
    scriptRef.current = s;
    return () => {
      try { s.remove(); } catch { /* ignore */ }
    };
  }, []);

  return (
    <main style={{ minHeight: '100vh', background: '#0c0f14', color: '#d8dee5' }}>
      <div id="api-reference-host" />
      <noscript style={{ padding: 24, display: 'block' }}>
        NexyFab API docs require JavaScript. Raw OpenAPI JSON:{' '}
        <a href="/api/docs/openapi" style={{ color: '#60a5fa' }}>
          /api/docs/openapi
        </a>
      </noscript>
    </main>
  );
}
