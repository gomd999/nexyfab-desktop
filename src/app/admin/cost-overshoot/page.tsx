'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAdminI18n } from '../AdminI18nProvider';

interface UserSummary {
  userId: string;
  cents: number;
  calls: number;
  topPromptId: string | null;
  topProvider: string | null;
  over: boolean;
}

interface ApiResponse {
  windowMs: number;
  sampleSize: number;
  truncated: boolean;
  limitUsd: number | null;
  summary: { users: number; over: number; totalCents: number };
  users: UserSummary[];
}

function fmtCents(cents: number) {
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

const AUTO_REFRESH_MS = 30_000;

export default function CostOvershootPage() {
  const { copy } = useAdminI18n();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitOverride, setLimitOverride] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [overChange, setOverChange] = useState<{ delta: number; ts: number } | null>(null);
  const prevOverRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = new URL('/api/nexyfab/admin/cost-overshoot', window.location.origin);
      if (limitOverride.trim()) url.searchParams.set('limitUsd', limitOverride.trim());
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const fresh = await res.json() as ApiResponse;
      setData(fresh);
      setLastUpdated(Date.now());

      // Highlight when the over-budget count changes between refreshes — the
      // most operationally meaningful signal on this page.
      const prev = prevOverRef.current;
      const next = fresh.summary.over;
      if (prev !== null && next !== prev) {
        setOverChange({ delta: next - prev, ts: Date.now() });
        // Auto-clear the badge after 8 seconds.
        setTimeout(() => setOverChange(c => (c && Date.now() - c.ts >= 8_000 ? null : c)), 8_500);
      }
      prevOverRef.current = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [limitOverride]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh polling — 30s. Pauses when the tab is hidden so we don't
  // burn DB queries on background tabs.
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, load]);

  const overUsers = data?.users.filter(u => u.over) ?? [];
  const underUsers = data?.users.filter(u => !u.over) ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">{copy.pageTitles.costOvershoot}</h1>
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1 text-gray-400">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh 30s
            </label>
            <label className="text-gray-400">Limit (USD)</label>
            <input
              type="number"
              step="0.50"
              placeholder={data?.limitUsd != null ? `env: $${data.limitUsd}` : 'no limit'}
              value={limitOverride}
              onChange={e => setLimitOverride(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 w-32"
            />
            <button onClick={() => void load()} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded">
              Reload
            </button>
          </div>
        </div>

        {loading && <p className="text-gray-500">Loading…</p>}
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}
        {lastUpdated && (
          <p className="text-xs text-gray-600">
            Last updated {new Date(lastUpdated).toLocaleTimeString()}
            {overChange && (
              <span className={`ml-3 px-1.5 py-0.5 rounded text-[11px] ${
                overChange.delta > 0 ? 'bg-red-950 text-red-300' : 'bg-emerald-950 text-emerald-300'
              }`}>
                {overChange.delta > 0 ? `+${overChange.delta}` : overChange.delta} over budget
              </span>
            )}
          </p>
        )}

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500">Active users (24h)</div>
              <div className="text-2xl font-semibold">{data.summary.users.toLocaleString()}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500">Over budget</div>
              <div className={`text-2xl font-semibold ${data.summary.over > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {data.summary.over.toLocaleString()}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-500">Total spend</div>
              <div className="text-2xl font-semibold">{fmtCents(data.summary.totalCents)}</div>
            </div>
          </div>
        )}

        {overUsers.length > 0 && (
          <Section title={`Over budget (${overUsers.length})`} accent="red">
            {overUsers.map(u => <UserRow key={u.userId} u={u} limitUsd={data?.limitUsd ?? null} />)}
          </Section>
        )}

        {underUsers.length > 0 && (
          <Section title={`Under budget (${underUsers.length})`} accent="gray">
            {underUsers.slice(0, 50).map(u => <UserRow key={u.userId} u={u} limitUsd={data?.limitUsd ?? null} />)}
            {underUsers.length > 50 && (
              <li className="text-xs text-gray-500 px-3 py-2">… and {underUsers.length - 50} more</li>
            )}
          </Section>
        )}

        {data && data.users.length === 0 && (
          <p className="text-gray-500 text-sm">No prompt_call telemetry in the 24h window.</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: 'red' | 'gray'; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <header className={`px-4 py-2 border-b border-gray-800 text-sm ${accent === 'red' ? 'bg-red-950/40 text-red-200' : 'bg-gray-800/40 text-gray-300'}`}>
        {title}
      </header>
      <ul className="divide-y divide-gray-800">{children}</ul>
    </section>
  );
}

function UserRow({ u, limitUsd }: { u: UserSummary; limitUsd: number | null }) {
  const ratio = limitUsd ? Math.min(1, u.cents / (limitUsd * 100)) : 0;
  return (
    <li className="px-3 py-2 flex items-center gap-3 text-sm font-mono">
      <span className="flex-1 truncate" title={u.userId}>{u.userId}</span>
      <span className="text-xs text-gray-500 w-32 truncate" title={u.topPromptId ?? ''}>{u.topPromptId ?? '—'}</span>
      <span className="text-xs text-gray-500 w-20">{u.topProvider ?? '—'}</span>
      <span className="text-xs text-gray-500 w-16 text-right">{u.calls.toLocaleString()} calls</span>
      <span className={`w-24 text-right ${u.over ? 'text-red-400' : ''}`}>{fmtCents(u.cents)}</span>
      {limitUsd && (
        <div className="w-16 h-2 bg-gray-800 rounded overflow-hidden" title={limitUsd ? `${(ratio * 100).toFixed(0)}% of $${limitUsd}` : undefined}>
          <div
            className={u.over ? 'h-full bg-red-500' : 'h-full bg-emerald-500'}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}
