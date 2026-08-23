'use client';

import { useEffect, useState } from 'react';

type Health = { status?: string; build?: string; timestamp?: string };

const timeoutMs = 3_000;

export default function PlatformStatusClient() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const origin = process.env.NEXT_PUBLIC_CORE_API_URL?.replace(/\/$/, '') ?? '';
    fetch(`${origin}/api/health/live`, { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<Health> : Promise.reject(new Error('health')))
      .then(setHealth)
      .catch(() => setError(true))
      .finally(() => window.clearTimeout(timer));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Platform status</h1>
      {error ? <p role="status">Core API is unavailable.</p> : null}
      {!error && !health ? <p role="status">Checking Core API…</p> : null}
      {health ? (
        <dl>
          <dt>Status</dt><dd>{health.status ?? 'unknown'}</dd>
          <dt>Build</dt><dd>{health.build ?? 'unknown'}</dd>
          <dt>Checked</dt><dd>{health.timestamp ?? 'unknown'}</dd>
        </dl>
      ) : null}
    </main>
  );
}
